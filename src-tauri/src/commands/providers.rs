//! Provider adapters: request building, streaming parsers, model lists and
//! error mapping. Pure functions, so every wire format is unit tested.
//!
//! Checked against the providers' docs on 5 Nov 2026:
//! - OpenRouter and OpenAI: chat completions (OpenAI format), SSE ending `data: [DONE]`.
//!   OpenAI's newer models take `max_completion_tokens` instead of `max_tokens`.
//! - Anthropic: `/v1/messages`, `anthropic-version: 2026-10-21` (that version
//!   rejects `temperature`, so it is never sent), named SSE events.
//! - Gemini: `models/{model}:streamGenerateContent?alt=sse`, `x-goog-api-key`.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const ANTHROPIC_VERSION: &str = "2026-10-21";
pub const APP_TITLE: &str = "Engineer's Notebook";
pub const APP_REFERER: &str = "https://github.com/jakemulholland-code/engineers-notebook";

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    /// Base64 PNGs, for models that accept images.
    #[serde(default)]
    pub images: Vec<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CompleteRequest {
    pub request_id: String,
    pub provider: String,
    #[serde(default)]
    pub base_url: Option<String>,
    pub model: String,
    pub system: String,
    pub messages: Vec<ChatMessage>,
    pub max_tokens: u32,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub json: bool,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub context_length: Option<u64>,
    pub vision: bool,
}

/// A plain-English error for the front end. Never contains a key.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiError {
    /// bad_key, no_key, no_credit, rate_limited, model_not_found, network,
    /// busy, cancelled, bad_config or provider_error.
    pub kind: String,
    pub message: String,
    pub retry_after_secs: Option<u64>,
}

impl AiError {
    pub fn new(kind: &str, message: impl Into<String>) -> Self {
        AiError { kind: kind.into(), message: message.into(), retry_after_secs: None }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Family {
    OpenAi,
    Anthropic,
    Gemini,
}

pub fn family(provider: &str) -> Result<Family, AiError> {
    match provider {
        "openrouter" | "openai" | "custom" => Ok(Family::OpenAi),
        "anthropic" => Ok(Family::Anthropic),
        "gemini" => Ok(Family::Gemini),
        _ => Err(AiError::new("bad_config", format!("Unknown provider: {provider}"))),
    }
}

pub fn label(provider: &str) -> &'static str {
    match provider {
        "openrouter" => "OpenRouter",
        "openai" => "OpenAI",
        "anthropic" => "Anthropic",
        "gemini" => "Google Gemini",
        _ => "the custom provider",
    }
}

fn host(provider: &str) -> &'static str {
    match provider {
        "openrouter" => "https://openrouter.ai",
        "openai" => "https://api.openai.com",
        "anthropic" => "https://api.anthropic.com",
        _ => "https://generativelanguage.googleapis.com",
    }
}

/// API root for a provider. `host_override` (dev and test builds only) swaps
/// the scheme and host so the end-to-end tests can use a local mock.
pub fn api_root(provider: &str, custom_base: Option<&str>, host_override: Option<&str>) -> Result<String, AiError> {
    if provider == "custom" {
        let base = custom_base.unwrap_or("").trim().trim_end_matches('/');
        if !(base.starts_with("http://") || base.starts_with("https://")) {
            return Err(AiError::new("bad_config", "Set a base URL for the custom provider in Settings, for example http://localhost:1234/v1"));
        }
        return Ok(base.to_string());
    }
    let h = host_override.map(|s| s.trim_end_matches('/')).unwrap_or(host(provider));
    let path = match provider {
        "openrouter" => "/api/v1",
        "gemini" => "/v1beta",
        _ => "/v1",
    };
    Ok(format!("{h}{path}"))
}

pub struct HttpRequest {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Value,
}

fn auth_headers(provider: &str, key: Option<&str>) -> Vec<(String, String)> {
    let mut h = Vec::new();
    match provider {
        "anthropic" => {
            if let Some(k) = key {
                h.push(("x-api-key".into(), k.into()));
            }
            h.push(("anthropic-version".into(), ANTHROPIC_VERSION.into()));
        }
        "gemini" => {
            if let Some(k) = key {
                h.push(("x-goog-api-key".into(), k.into()));
            }
        }
        _ => {
            if let Some(k) = key {
                h.push(("Authorization".into(), format!("Bearer {k}")));
            }
            if provider == "openrouter" {
                h.push(("HTTP-Referer".into(), APP_REFERER.into()));
                h.push(("X-Title".into(), APP_TITLE.into()));
            }
        }
    }
    h
}

fn gemini_model(model: &str) -> &str {
    model.strip_prefix("models/").unwrap_or(model)
}

/// Builds the streaming request. `with_temperature` is false on the one retry
/// after a model rejects the parameter.
pub fn build_complete(req: &CompleteRequest, root: &str, key: Option<&str>, with_temperature: bool) -> Result<HttpRequest, AiError> {
    let provider = req.provider.as_str();
    let mut headers = auth_headers(provider, key);
    headers.push(("content-type".into(), "application/json".into()));
    let temperature = if with_temperature { req.temperature } else { None };

    match family(provider)? {
        Family::OpenAi => {
            let mut messages = vec![json!({ "role": "system", "content": req.system })];
            for m in &req.messages {
                if m.images.is_empty() {
                    messages.push(json!({ "role": m.role, "content": m.content }));
                } else {
                    let mut parts = vec![json!({ "type": "text", "text": m.content })];
                    for img in &m.images {
                        parts.push(json!({ "type": "image_url", "image_url": { "url": format!("data:image/png;base64,{img}") } }));
                    }
                    messages.push(json!({ "role": m.role, "content": parts }));
                }
            }
            let mut body = json!({ "model": req.model, "messages": messages, "stream": true });
            let tokens_key = if provider == "openai" { "max_completion_tokens" } else { "max_tokens" };
            body[tokens_key] = json!(req.max_tokens);
            if let Some(t) = temperature {
                body["temperature"] = json!(t);
            }
            if req.json && provider == "openai" {
                body["response_format"] = json!({ "type": "json_object" });
            }
            Ok(HttpRequest { url: format!("{root}/chat/completions"), headers, body })
        }
        Family::Anthropic => {
            let messages: Vec<Value> = req
                .messages
                .iter()
                .map(|m| {
                    let mut content = vec![json!({ "type": "text", "text": m.content })];
                    for img in &m.images {
                        content.push(json!({ "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": img } }));
                    }
                    json!({ "role": m.role, "content": content })
                })
                .collect();
            let body = json!({
                "model": req.model,
                "system": req.system,
                "messages": messages,
                "max_tokens": req.max_tokens,
                "stream": true,
            });
            Ok(HttpRequest { url: format!("{root}/messages"), headers, body })
        }
        Family::Gemini => {
            let contents: Vec<Value> = req
                .messages
                .iter()
                .map(|m| {
                    let role = if m.role == "assistant" { "model" } else { "user" };
                    let mut parts = vec![json!({ "text": m.content })];
                    for img in &m.images {
                        parts.push(json!({ "inlineData": { "mimeType": "image/png", "data": img } }));
                    }
                    json!({ "role": role, "parts": parts })
                })
                .collect();
            let mut config = json!({ "maxOutputTokens": req.max_tokens });
            if let Some(t) = temperature {
                config["temperature"] = json!(t);
            }
            if req.json {
                config["responseMimeType"] = json!("application/json");
            }
            let body = json!({
                "systemInstruction": { "parts": [{ "text": req.system }] },
                "contents": contents,
                "generationConfig": config,
            });
            Ok(HttpRequest {
                url: format!("{root}/models/{}:streamGenerateContent?alt=sse", gemini_model(&req.model)),
                headers,
                body,
            })
        }
    }
}

pub fn build_list_models(provider: &str, root: &str, key: Option<&str>) -> HttpRequest {
    let url = match provider {
        "anthropic" => format!("{root}/models?limit=1000"),
        "gemini" => format!("{root}/models?pageSize=1000"),
        _ => format!("{root}/models"),
    };
    HttpRequest { url, headers: auth_headers(provider, key), body: Value::Null }
}

/// OpenAI's /v1/models has no capability data: keep chat models, guess vision by family.
fn openai_is_chat(id: &str) -> bool {
    let bad = ["embedding", "tts", "whisper", "dall-e", "moderation", "image", "audio", "realtime", "transcribe", "search", "davinci", "babbage", "sora"];
    !bad.iter().any(|b| id.contains(b))
}

fn openai_vision(id: &str) -> bool {
    ["gpt-4o", "gpt-4.1", "gpt-4-turbo", "gpt-5", "o1", "o3", "o4", "chatgpt-4o"].iter().any(|p| id.starts_with(p))
}

pub fn parse_models(provider: &str, v: &Value) -> Vec<ModelInfo> {
    let s = |x: &Value| x.as_str().unwrap_or("").to_string();
    let mut out: Vec<ModelInfo> = match provider {
        "openrouter" => v["data"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|m| ModelInfo {
                        id: s(&m["id"]),
                        name: m["name"].as_str().map(String::from).unwrap_or_else(|| s(&m["id"])),
                        context_length: m["context_length"].as_u64(),
                        vision: m["architecture"]["input_modalities"]
                            .as_array()
                            .is_some_and(|mods| mods.iter().any(|x| x == "image")),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        "anthropic" => v["data"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter(|m| m["lifecycle"].as_str() != Some("retired"))
                    .map(|m| ModelInfo {
                        id: s(&m["id"]),
                        name: m["display_name"].as_str().map(String::from).unwrap_or_else(|| s(&m["id"])),
                        context_length: m["max_input_tokens"].as_u64().filter(|n| *n > 0),
                        vision: m["capabilities"]["image_input"]["supported"].as_bool().unwrap_or(true),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        "gemini" => v["models"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter(|m| {
                        m["supportedGenerationMethods"]
                            .as_array()
                            .is_some_and(|ms| ms.iter().any(|x| x == "generateContent"))
                    })
                    .map(|m| {
                        let id = gemini_model(m["name"].as_str().unwrap_or("")).to_string();
                        ModelInfo {
                            name: m["displayName"].as_str().map(String::from).unwrap_or_else(|| id.clone()),
                            context_length: m["inputTokenLimit"].as_u64(),
                            vision: true,
                            id,
                        }
                    })
                    .collect()
            })
            .unwrap_or_default(),
        _ => v["data"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|m| s(&m["id"]))
                    .filter(|id| provider != "openai" || openai_is_chat(id))
                    .map(|id| ModelInfo {
                        vision: provider == "openai" && openai_vision(&id),
                        name: id.clone(),
                        context_length: None,
                        id,
                    })
                    .collect()
            })
            .unwrap_or_default(),
    };
    out.retain(|m| !m.id.is_empty());
    out
}

#[derive(Debug, PartialEq)]
pub enum StreamEvent {
    Text(String),
    Done,
    Error(String),
    Ignore,
}

/// Interprets one SSE event from a provider's stream.
pub fn parse_event(fam: Family, event: Option<&str>, data: &str) -> StreamEvent {
    let data = data.trim();
    if data.is_empty() {
        return StreamEvent::Ignore;
    }
    if fam == Family::OpenAi && data == "[DONE]" {
        return StreamEvent::Done;
    }
    let Ok(v) = serde_json::from_str::<Value>(data) else {
        return StreamEvent::Ignore;
    };
    if let Some(e) = error_text(&v) {
        return StreamEvent::Error(e);
    }
    match fam {
        Family::OpenAi => match v["choices"][0]["delta"]["content"].as_str() {
            Some(t) if !t.is_empty() => StreamEvent::Text(t.to_string()),
            _ => StreamEvent::Ignore,
        },
        Family::Anthropic => {
            let ty = v["type"].as_str().or(event).unwrap_or("");
            match ty {
                "content_block_delta" if v["delta"]["type"] == "text_delta" => {
                    StreamEvent::Text(v["delta"]["text"].as_str().unwrap_or("").to_string())
                }
                "message_stop" => StreamEvent::Done,
                _ => StreamEvent::Ignore,
            }
        }
        Family::Gemini => {
            let text: String = v["candidates"][0]["content"]["parts"]
                .as_array()
                .map(|parts| {
                    parts
                        .iter()
                        .filter(|p| p["thought"] != true)
                        .filter_map(|p| p["text"].as_str())
                        .collect()
                })
                .unwrap_or_default();
            if text.is_empty() {
                StreamEvent::Ignore
            } else {
                StreamEvent::Text(text)
            }
        }
    }
}

fn error_text(v: &Value) -> Option<String> {
    let e = v.get("error")?;
    if e.is_null() {
        return None;
    }
    let msg = e["message"].as_str().or_else(|| e.as_str()).unwrap_or("Unknown error");
    let ty = e["type"].as_str().or_else(|| e["status"].as_str()).or_else(|| e["code"].as_str());
    Some(match ty {
        Some(t) => format!("{t}: {msg}"),
        None => msg.to_string(),
    })
}

/// Collects `(event, data)` pairs from a byte stream, however it is chunked.
#[derive(Default)]
pub struct SseParser {
    buf: Vec<u8>,
}

impl SseParser {
    pub fn feed(&mut self, chunk: &[u8]) -> Vec<(Option<String>, String)> {
        self.buf.extend(chunk.iter().filter(|b| **b != b'\r'));
        let mut out = Vec::new();
        while let Some(pos) = self.buf.windows(2).position(|w| w == b"\n\n") {
            let block: Vec<u8> = self.buf.drain(..pos + 2).collect();
            let text = String::from_utf8_lossy(&block);
            let mut event = None;
            let mut data: Vec<&str> = Vec::new();
            for line in text.lines() {
                if line.starts_with(':') {
                    continue; // comment, e.g. ": OPENROUTER PROCESSING"
                }
                if let Some(rest) = line.strip_prefix("event:") {
                    event = Some(rest.trim().to_string());
                } else if let Some(rest) = line.strip_prefix("data:") {
                    data.push(rest.strip_prefix(' ').unwrap_or(rest));
                }
            }
            if !data.is_empty() {
                out.push((event, data.join("\n")));
            }
        }
        out
    }

    /// Whatever is left when the stream closes without a final blank line.
    pub fn finish(&mut self) -> Vec<(Option<String>, String)> {
        if self.buf.is_empty() {
            return Vec::new();
        }
        let mut tail = std::mem::take(&mut self.buf);
        tail.extend_from_slice(b"\n\n");
        self.feed(&tail)
    }
}

fn short(s: &str) -> String {
    let s = s.trim();
    if s.chars().count() > 240 {
        format!("{}…", s.chars().take(240).collect::<String>())
    } else {
        s.to_string()
    }
}

/// Turns a failed HTTP response into a plain message (SPEC: map errors to plain messages).
pub fn map_http_error(provider: &str, model: &str, status: u16, retry_after: Option<u64>, body: &str) -> AiError {
    let who = label(provider);
    let lower = body.to_lowercase();
    let detail = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| error_text(&v))
        .unwrap_or_else(|| short(body));
    let mentions_model = lower.contains("model")
        && ["not found", "not_found", "does not exist", "not a valid model", "no endpoints found", "unknown model"]
            .iter()
            .any(|p| lower.contains(p));

    if status == 401 || status == 403 || lower.contains("api key not valid") || lower.contains("invalid api key") || lower.contains("invalid x-api-key") || lower.contains("incorrect api key") {
        return AiError::new("bad_key", format!("{who} did not accept the API key. Check it in Settings."));
    }
    if status == 402 || lower.contains("insufficient_quota") || lower.contains("credit balance") || lower.contains("insufficient credits") || lower.contains("billing") {
        return AiError::new("no_credit", format!("Your {who} account has no credit left, or billing is not set up."));
    }
    if status == 429 {
        let mut e = AiError::new(
            "rate_limited",
            match retry_after {
                Some(s) => format!("{who} is rate limiting requests. Try again in {s} seconds."),
                None => format!("{who} is rate limiting requests. Try again in a minute."),
            },
        );
        e.retry_after_secs = retry_after;
        return e;
    }
    if status == 404 || mentions_model {
        return AiError::new("model_not_found", format!("{who} could not find the model \"{model}\". Pick another in Settings."));
    }
    if status == 529 || status == 503 || lower.contains("overloaded") {
        return AiError::new("busy", format!("{who} is busy right now. Try again shortly."));
    }
    AiError::new("provider_error", format!("{who} returned an error ({status}): {}", short(&detail)))
}

/// True when a 400 says the model does not take `temperature`, so one retry without it may work.
pub fn rejects_temperature(status: u16, body: &str) -> bool {
    status == 400 && body.to_lowercase().contains("temperature")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(provider: &str) -> CompleteRequest {
        CompleteRequest {
            request_id: "r".into(),
            provider: provider.into(),
            base_url: Some("http://localhost:1234/v1/".into()),
            model: "m-1".into(),
            system: "Be brief".into(),
            messages: vec![ChatMessage { role: "user".into(), content: "Hello".into(), images: vec![] }],
            max_tokens: 100,
            temperature: Some(0.3),
            json: true,
        }
    }

    fn header<'a>(r: &'a HttpRequest, name: &str) -> Option<&'a str> {
        r.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }

    #[test]
    fn roots_and_overrides() {
        assert_eq!(api_root("openrouter", None, None).unwrap(), "https://openrouter.ai/api/v1");
        assert_eq!(api_root("gemini", None, None).unwrap(), "https://generativelanguage.googleapis.com/v1beta");
        assert_eq!(api_root("openai", None, Some("http://127.0.0.1:9/")).unwrap(), "http://127.0.0.1:9/v1");
        assert_eq!(api_root("custom", Some("http://localhost:1234/v1/"), None).unwrap(), "http://localhost:1234/v1");
        assert_eq!(api_root("custom", Some("localhost"), None).unwrap_err().kind, "bad_config");
    }

    #[test]
    fn openrouter_request() {
        let r = build_complete(&req("openrouter"), "https://openrouter.ai/api/v1", Some("sk-or"), true).unwrap();
        assert_eq!(r.url, "https://openrouter.ai/api/v1/chat/completions");
        assert_eq!(header(&r, "Authorization"), Some("Bearer sk-or"));
        assert_eq!(header(&r, "X-Title"), Some(APP_TITLE));
        assert!(header(&r, "HTTP-Referer").is_some());
        assert_eq!(r.body["messages"][0]["role"], "system");
        assert_eq!(r.body["max_tokens"], 100);
        assert!(r.body.get("response_format").is_none());
        assert_eq!(r.body["stream"], true);
    }

    #[test]
    fn openai_request_uses_completion_tokens_and_json_mode() {
        let r = build_complete(&req("openai"), "https://api.openai.com/v1", Some("sk"), true).unwrap();
        assert_eq!(r.body["max_completion_tokens"], 100);
        assert!(r.body.get("max_tokens").is_none());
        assert_eq!(r.body["response_format"]["type"], "json_object");
        assert!((r.body["temperature"].as_f64().unwrap() - 0.3).abs() < 1e-6);
        let without = build_complete(&req("openai"), "https://api.openai.com/v1", Some("sk"), false).unwrap();
        assert!(without.body.get("temperature").is_none());
    }

    #[test]
    fn anthropic_request() {
        let mut q = req("anthropic");
        q.messages[0].images = vec!["AAAA".into()];
        let r = build_complete(&q, "https://api.anthropic.com/v1", Some("sk-ant"), true).unwrap();
        assert_eq!(r.url, "https://api.anthropic.com/v1/messages");
        assert_eq!(header(&r, "x-api-key"), Some("sk-ant"));
        assert_eq!(header(&r, "anthropic-version"), Some(ANTHROPIC_VERSION));
        assert_eq!(r.body["system"], "Be brief");
        assert!(r.body.get("temperature").is_none(), "API version 2026-10-21 rejects temperature");
        assert_eq!(r.body["messages"][0]["content"][1]["source"]["data"], "AAAA");
    }

    #[test]
    fn gemini_request() {
        let mut q = req("gemini");
        q.model = "models/gemini-2.5-flash".into();
        q.messages.push(ChatMessage { role: "assistant".into(), content: "Hi".into(), images: vec![] });
        let r = build_complete(&q, "https://generativelanguage.googleapis.com/v1beta", Some("g"), true).unwrap();
        assert_eq!(r.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse");
        assert_eq!(header(&r, "x-goog-api-key"), Some("g"));
        assert_eq!(r.body["systemInstruction"]["parts"][0]["text"], "Be brief");
        assert_eq!(r.body["contents"][1]["role"], "model");
        assert_eq!(r.body["generationConfig"]["responseMimeType"], "application/json");
        assert_eq!(r.body["generationConfig"]["maxOutputTokens"], 100);
    }

    #[test]
    fn custom_without_key_sends_no_auth() {
        let r = build_complete(&req("custom"), "http://localhost:1234/v1", None, true).unwrap();
        assert!(header(&r, "Authorization").is_none());
        assert_eq!(r.url, "http://localhost:1234/v1/chat/completions");
    }

    #[test]
    fn sse_parser_handles_split_chunks_comments_and_crlf() {
        let mut p = SseParser::default();
        let mut got = p.feed(b": OPENROUTER PROCESSING\r\n\r\ndata: {\"a\":");
        assert!(got.is_empty());
        got = p.feed("1}\r\n\r\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\ndata: caf\u{e9}".as_bytes());
        assert_eq!(got, vec![(None, "{\"a\":1}".into()), (Some("message_stop".into()), "{\"type\":\"message_stop\"}".into())]);
        assert_eq!(p.finish(), vec![(None, "café".into())]);
    }

    #[test]
    fn openai_stream_events() {
        let f = Family::OpenAi;
        assert_eq!(parse_event(f, None, r#"{"choices":[{"delta":{"content":"Hi"}}]}"#), StreamEvent::Text("Hi".into()));
        assert_eq!(parse_event(f, None, r#"{"choices":[{"delta":{"role":"assistant"}}]}"#), StreamEvent::Ignore);
        assert_eq!(parse_event(f, None, "[DONE]"), StreamEvent::Done);
        assert!(matches!(parse_event(f, None, r#"{"error":{"message":"boom","code":502}}"#), StreamEvent::Error(_)));
    }

    #[test]
    fn anthropic_stream_events() {
        let f = Family::Anthropic;
        assert_eq!(
            parse_event(f, Some("content_block_delta"), r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ello"}}"#),
            StreamEvent::Text("ello".into())
        );
        assert_eq!(parse_event(f, Some("ping"), r#"{"type":"ping"}"#), StreamEvent::Ignore);
        assert_eq!(
            parse_event(f, Some("content_block_delta"), r#"{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hmm"}}"#),
            StreamEvent::Ignore
        );
        assert_eq!(parse_event(f, Some("message_stop"), r#"{"type":"message_stop"}"#), StreamEvent::Done);
        assert_eq!(
            parse_event(f, Some("error"), r#"{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#),
            StreamEvent::Error("overloaded_error: Overloaded".into())
        );
    }

    #[test]
    fn gemini_stream_events_skip_thoughts() {
        let f = Family::Gemini;
        let d = r#"{"candidates":[{"content":{"role":"model","parts":[{"text":"plan","thought":true},{"text":"Hi "},{"text":"there"}]}}]}"#;
        assert_eq!(parse_event(f, None, d), StreamEvent::Text("Hi there".into()));
        assert_eq!(parse_event(f, None, r#"{"candidates":[{"finishReason":"STOP"}]}"#), StreamEvent::Ignore);
    }

    #[test]
    fn model_lists() {
        let or = json!({"data":[
            {"id":"anthropic/claude-sonnet-5-5","name":"Claude Sonnet 5.5","context_length":200000,"architecture":{"input_modalities":["text","image"]}},
            {"id":"meta/llama","name":"Llama","context_length":8192,"architecture":{"input_modalities":["text"]}}
        ]});
        let m = parse_models("openrouter", &or);
        assert_eq!(m[0], ModelInfo { id: "anthropic/claude-sonnet-5-5".into(), name: "Claude Sonnet 5.5".into(), context_length: Some(200000), vision: true });
        assert!(!m[1].vision);

        let an = json!({"data":[
            {"id":"claude-opus-5-5","display_name":"Claude Opus 5.5","max_input_tokens":200000,"lifecycle":"active","capabilities":{"image_input":{"supported":true}}},
            {"id":"claude-old","display_name":"Old","lifecycle":"retired"}
        ]});
        let m = parse_models("anthropic", &an);
        assert_eq!(m.len(), 1);
        assert!(m[0].vision);

        let ge = json!({"models":[
            {"name":"models/gemini-2.5-flash","displayName":"Gemini 2.5 Flash","inputTokenLimit":1048576,"supportedGenerationMethods":["generateContent","countTokens"]},
            {"name":"models/text-embedding-004","supportedGenerationMethods":["embedContent"]}
        ]});
        let m = parse_models("gemini", &ge);
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].id, "gemini-2.5-flash");

        let oa = json!({"data":[{"id":"gpt-5-mini"},{"id":"text-embedding-3-small"},{"id":"whisper-1"},{"id":"gpt-3.5-turbo"}]});
        let m = parse_models("openai", &oa);
        assert_eq!(m.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), vec!["gpt-5-mini", "gpt-3.5-turbo"]);
        assert!(m[0].vision && !m[1].vision);
    }

    #[test]
    fn error_mapping() {
        assert_eq!(map_http_error("openai", "m", 401, None, "{}").kind, "bad_key");
        assert_eq!(map_http_error("gemini", "m", 400, None, r#"{"error":{"message":"API key not valid. Please pass a valid API key."}}"#).kind, "bad_key");
        assert_eq!(map_http_error("openrouter", "m", 402, None, "{}").kind, "no_credit");
        assert_eq!(map_http_error("openai", "m", 429, None, r#"{"error":{"code":"insufficient_quota"}}"#).kind, "no_credit");
        assert_eq!(map_http_error("anthropic", "m", 400, None, r#"{"error":{"message":"Your credit balance is too low"}}"#).kind, "no_credit");
        let rl = map_http_error("anthropic", "m", 429, Some(30), "{}");
        assert_eq!((rl.kind.as_str(), rl.retry_after_secs), ("rate_limited", Some(30)));
        assert!(rl.message.contains("30 seconds"));
        assert_eq!(map_http_error("openai", "gpt-x", 404, None, "{}").kind, "model_not_found");
        assert_eq!(map_http_error("openrouter", "x", 400, None, r#"{"error":{"message":"x is not a valid model ID"}}"#).kind, "model_not_found");
        assert_eq!(map_http_error("anthropic", "m", 529, None, "{}").kind, "busy");
        let other = map_http_error("openai", "m", 400, None, r#"{"error":{"message":"bad thing"}}"#);
        assert_eq!(other.kind, "provider_error");
        assert!(other.message.contains("bad thing"));
        assert!(rejects_temperature(400, r#"{"error":{"message":"Unsupported parameter: 'temperature'"}}"#));
    }
}
