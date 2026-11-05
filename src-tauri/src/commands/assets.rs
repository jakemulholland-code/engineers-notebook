//! Pasted and inserted images, stored as `<notes>/assets/<sha256>.png`.

use base64::Engine;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

use super::fs::atomic_write;

const PNG_MAGIC: &[u8] = b"\x89PNG\r\n\x1a\n";

/// Resolves `assets/<name>` inside a notes folder, rejecting anything that could escape it.
pub fn asset_path(notes: &Path, rel: &str) -> Result<PathBuf, String> {
    let name = rel
        .strip_prefix("assets/")
        .ok_or("Asset path must start with assets/")?;
    let ok = !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
        && !name.starts_with('.');
    if !ok {
        return Err(format!("Invalid asset name: {rel}"));
    }
    Ok(notes.join("assets").join(name))
}

/// Writes PNG bytes de-duplicated by hash. Returns the page-relative path.
pub fn save_png(notes: &Path, bytes: &[u8]) -> Result<String, String> {
    if !bytes.starts_with(PNG_MAGIC) {
        return Err("Images must be PNG".into());
    }
    let dir = notes.join("assets");
    if !dir.is_dir() {
        return Err(format!("Folder not found: {}", dir.display()));
    }
    let hash = Sha256::digest(bytes);
    let hex: String = hash.iter().map(|b| format!("{b:02x}")).collect();
    let rel = format!("assets/{hex}.png");
    let path = dir.join(format!("{hex}.png"));
    if !path.exists() {
        atomic_write(&path, bytes)?;
    }
    Ok(rel)
}

#[tauri::command]
pub fn save_asset(notes_path: String, data_base64: String) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| e.to_string())?;
    save_png(Path::new(&notes_path), &bytes)
}

#[tauri::command]
pub fn read_asset(notes_path: String, rel: String) -> Result<tauri::ipc::Response, String> {
    let path = asset_path(Path::new(&notes_path), &rel)?;
    let bytes = fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(extra: u8) -> Vec<u8> {
        let mut v = PNG_MAGIC.to_vec();
        v.push(extra);
        v
    }

    #[test]
    fn dedupes_by_hash() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("assets")).unwrap();
        let a = save_png(dir.path(), &png(1)).unwrap();
        let b = save_png(dir.path(), &png(1)).unwrap();
        let c = save_png(dir.path(), &png(2)).unwrap();
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert!(a.starts_with("assets/") && a.ends_with(".png"));
        assert_eq!(fs::read_dir(dir.path().join("assets")).unwrap().count(), 2);
    }

    #[test]
    fn rejects_non_png_and_missing_folder() {
        let dir = tempfile::tempdir().unwrap();
        assert!(save_png(dir.path(), &png(1)).is_err());
        fs::create_dir_all(dir.path().join("assets")).unwrap();
        assert!(save_png(dir.path(), b"GIF89a").is_err());
    }

    #[test]
    fn rejects_escaping_paths() {
        let n = Path::new("C:/n");
        assert!(asset_path(n, "assets/../secret.png").is_err());
        assert!(asset_path(n, "assets/a/b.png").is_err());
        assert!(asset_path(n, "pages/x.png").is_err());
        assert!(asset_path(n, "assets/..").is_err());
        assert!(asset_path(n, "assets/abc123.png").is_ok());
    }
}
