//! API keys live in the OS credential store (Windows Credential Manager), never
//! in a file. The web view can save, remove and see the last four characters,
//! but can never read a key back.

use keyring::Entry;

pub const PROVIDERS: [&str; 5] = ["openrouter", "openai", "anthropic", "gemini", "custom"];

fn service() -> String {
    // Dev and test runs keep their keys apart from the real ones.
    if cfg!(debug_assertions) {
        if let Ok(s) = std::env::var("ENGINEERS_NOTEBOOK_KEYRING_SERVICE") {
            if !s.is_empty() {
                return s;
            }
        }
    }
    "engineers-notebook".to_string()
}

fn entry(provider: &str) -> Result<Entry, String> {
    if !PROVIDERS.contains(&provider) {
        return Err(format!("Unknown provider: {provider}"));
    }
    Entry::new(&service(), provider).map_err(|e| e.to_string())
}

fn last4(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    chars[chars.len().saturating_sub(4)..].iter().collect()
}

/// Reads a key for use inside Rust only. Never exposed as a command.
pub fn read_key(provider: &str) -> Result<Option<String>, String> {
    match entry(provider)?.get_password() {
        Ok(k) => Ok(Some(k)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Could not read the key from Credential Manager: {e}")),
    }
}

/// The last four characters of the saved key, or nothing.
#[tauri::command]
pub fn key_status(provider: String) -> Result<Option<String>, String> {
    Ok(read_key(&provider)?.map(|k| last4(&k)))
}

#[tauri::command]
pub fn save_key(provider: String, key: String) -> Result<String, String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("The key is empty".into());
    }
    entry(&provider)?
        .set_password(key)
        .map_err(|e| format!("Could not save the key to Credential Manager: {e}"))?;
    Ok(last4(key))
}

#[tauri::command]
pub fn remove_key(provider: String) -> Result<(), String> {
    match entry(&provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not remove the key: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn last4_handles_short_and_unicode_keys() {
        assert_eq!(last4("sk-or-v1-abcdef1234"), "1234");
        assert_eq!(last4("ab"), "ab");
        assert_eq!(last4("ké€y"), "ké€y");
    }

    #[test]
    fn rejects_unknown_providers() {
        assert!(entry("not-a-provider").is_err());
    }
}
