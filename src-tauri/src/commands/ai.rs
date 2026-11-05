//! AI requests are made here, not in the web view, so keys never leave Rust and
//! provider CORS rules do not apply. Replies stream to the front end as
//! `ai-chunk` events; `ai_cancel` stops a request (the Stop button).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Notify;

use super::keychain::read_key;
use super::providers::{
    api_root, build_complete, build_list_models, family, label, map_http_error, parse_event, parse_models,
    rejects_temperature, AiError, CompleteRequest, Family, HttpRequest, ModelInfo, SseParser, StreamEvent,
};

pub struct AiState {
    client: reqwest::Client,
    cancels: Mutex<HashMap<String, Arc<Notify>>>,
}

impl Default for AiState {
    fn default() -> Self {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(120))
            .user_agent("EngineersNotebook/0.1")
            .build()
            .expect("HTTP client");
        AiState { client, cancels: Mutex::new(HashMap::new()) }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Chunk<'a> {
    request_id: &'a str,
    text: &'a str,
}

/// Dev and test builds only: point the four hosted providers at a local mock.
fn host_override() -> Option<String> {
    if cfg!(debug_assertions) {
        std::env::var("ENGINEERS_NOTEBOOK_AI_HOST").ok().filter(|s| !s.is_empty())
    } else {
        None
    }
}

fn key_for(provider: &str) -> Result<Option<String>, AiError> {
    let key = read_key(provider).map_err(|e| AiError::new("bad_config", e))?;
    if key.is_none() && provider != "custom" {
        return Err(AiError::new("no_key", format!("Add your {} API key in Settings.", label(provider))));
    }
    Ok(key)
}

fn network_error(provider: &str, e: &reqwest::Error) -> AiError {
    let who = label(provider);
    if e.is_timeout() {
        AiError::new("network", format!("{who} took too long to answer. Check your connection and try again."))
    } else {
        AiError::new("network", format!("Could not reach {who}. Check your internet connection."))
    }
}

async fn send(state: &AiState, provider: &str, req: &HttpRequest, post: bool) -> Result<reqwest::Response, AiError> {
    let mut b = if post { state.client.post(&req.url).json(&req.body) } else { state.client.get(&req.url) };
    for (k, v) in &req.headers {
        b = b.header(k, v);
    }
    b.send().await.map_err(|e| network_error(provider, &e))
}

fn retry_after(resp: &reqwest::Response) -> Option<u64> {
    resp.headers().get("retry-after")?.to_str().ok()?.trim().parse::<f64>().ok().map(|s| s.ceil() as u64)
}

#[tauri::command]
pub async fn ai_list_models(
    state: State<'_, AiState>,
    provider: String,
    base_url: Option<String>,
) -> Result<Vec<ModelInfo>, AiError> {
    family(&provider)?;
    let key = key_for(&provider)?;
    let root = api_root(&provider, base_url.as_deref(), host_override().as_deref())?;
    let req = build_list_models(&provider, &root, key.as_deref());
    let resp = send(&state, &provider, &req, false).await?;
    let status = resp.status().as_u16();
    let ra = retry_after(&resp);
    let body = resp.text().await.map_err(|e| network_error(&provider, &e))?;
    if !(200..300).contains(&status) {
        return Err(map_http_error(&provider, "", status, ra, &body));
    }
    let v: serde_json::Value = serde_json::from_str(&body)
        .map_err(|_| AiError::new("provider_error", format!("{} sent a model list we could not read.", label(&provider))))?;
    let mut models = parse_models(&provider, &v);
    models.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(models)
}

#[tauri::command]
pub fn ai_cancel(state: State<'_, AiState>, request_id: String) {
    if let Some(n) = state.cancels.lock().expect("cancel map").get(&request_id) {
        n.notify_one();
    }
}

#[tauri::command]
pub async fn ai_complete(app: AppHandle, state: State<'_, AiState>, request: CompleteRequest) -> Result<String, AiError> {
    let notify = Arc::new(Notify::new());
    state.cancels.lock().expect("cancel map").insert(request.request_id.clone(), notify.clone());
    let result = run_complete(&app, &state, &request, &notify).await;
    state.cancels.lock().expect("cancel map").remove(&request.request_id);
    result
}

fn cancelled() -> AiError {
    AiError::new("cancelled", "Stopped.")
}

async fn run_complete(app: &AppHandle, state: &AiState, request: &CompleteRequest, notify: &Notify) -> Result<String, AiError> {
    let provider = request.provider.as_str();
    let fam = family(provider)?;
    let key = key_for(provider)?;
    let root = api_root(provider, request.base_url.as_deref(), host_override().as_deref())?;

    // At most two attempts: the second only drops `temperature` for a model that refused it.
    let mut with_temperature = request.temperature.is_some();
    let resp = loop {
        let http = build_complete(request, &root, key.as_deref(), with_temperature)?;
        let resp = tokio::select! {
            _ = notify.notified() => return Err(cancelled()),
            r = send(state, provider, &http, true) => r?,
        };
        let status = resp.status().as_u16();
        if (200..300).contains(&status) {
            break resp;
        }
        let ra = retry_after(&resp);
        let body = resp.text().await.unwrap_or_default();
        if with_temperature && fam != Family::Anthropic && rejects_temperature(status, &body) {
            with_temperature = false;
            continue;
        }
        return Err(map_http_error(provider, &request.model, status, ra, &body));
    };

    let mut stream = resp.bytes_stream();
    let mut parser = SseParser::default();
    let mut full = String::new();
    let handle = |events: Vec<(Option<String>, String)>, full: &mut String| -> Result<bool, AiError> {
        for (event, data) in events {
            match parse_event(fam, event.as_deref(), &data) {
                StreamEvent::Text(t) => {
                    full.push_str(&t);
                    let _ = app.emit("ai-chunk", Chunk { request_id: &request.request_id, text: &t });
                }
                StreamEvent::Done => return Ok(true),
                StreamEvent::Error(msg) => return Err(map_http_error(provider, &request.model, 0, None, &msg)),
                StreamEvent::Ignore => {}
            }
        }
        Ok(false)
    };

    loop {
        tokio::select! {
            _ = notify.notified() => return Err(cancelled()),
            next = stream.next() => match next {
                None => {
                    handle(parser.finish(), &mut full)?;
                    break;
                }
                Some(Err(e)) => {
                    let mut err = network_error(provider, &e);
                    err.message = format!("The connection dropped while {} was replying.", label(provider));
                    return Err(err);
                }
                Some(Ok(bytes)) => {
                    if handle(parser.feed(&bytes), &mut full)? {
                        break;
                    }
                }
            }
        }
    }
    Ok(full)
}
