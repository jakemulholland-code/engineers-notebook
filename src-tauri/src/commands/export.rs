//! Export writes. Every export goes into a fresh `notebook-export-<date>` folder
//! inside the chosen destination; files are never overwritten and paths can
//! never step outside that folder.

use base64::Engine;
use std::fs;
use std::path::{Component, Path, PathBuf};

use super::assets::asset_path;
use super::fs::atomic_write;

const EXPORT_PREFIX: &str = "notebook-export-";

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// A relative path made only of ordinary names (no `..`, no drive, no root).
fn safe_rel(rel: &str) -> Result<PathBuf, String> {
    let p = Path::new(rel);
    if rel.is_empty() || !p.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(format!("Invalid export path: {rel}"));
    }
    Ok(p.to_path_buf())
}

/// The export root must be a folder this command created.
fn export_root(root: &str) -> Result<PathBuf, String> {
    let r = PathBuf::from(root);
    let name = r.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    if !name.starts_with(EXPORT_PREFIX) || !r.is_dir() {
        return Err(format!("Not an export folder: {root}"));
    }
    Ok(r)
}

fn target(root: &str, rel: &str) -> Result<PathBuf, String> {
    let path = export_root(root)?.join(safe_rel(rel)?);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    Ok(path)
}

/// Creates `<dest>/notebook-export-<date>` (or `-2`, `-3`, ... if taken) and returns its path.
pub fn prepare_dir(dest: &Path, date: &str) -> Result<PathBuf, String> {
    if !dest.is_dir() {
        return Err(format!("Folder not found: {}", dest.display()));
    }
    if !date.chars().all(|c| c.is_ascii_digit() || c == '-') {
        return Err("Invalid export date".into());
    }
    for n in 1..1000 {
        let name = if n == 1 { format!("{EXPORT_PREFIX}{date}") } else { format!("{EXPORT_PREFIX}{date}-{n}") };
        let p = dest.join(name);
        if !p.exists() {
            fs::create_dir(&p).map_err(err)?;
            return Ok(p);
        }
    }
    Err("Too many exports for one day in that folder".into())
}

#[tauri::command]
pub fn export_prepare_dir(dest: String, date: String) -> Result<String, String> {
    prepare_dir(Path::new(&dest), &date).map(|p| p.to_string_lossy().to_string())
}

pub fn write_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if path.exists() {
        return Err(format!("{} already exists", path.display()));
    }
    atomic_write(path, bytes)
}

#[tauri::command]
pub fn export_write(root: String, rel: String, data_base64: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(data_base64.as_bytes()).map_err(err)?;
    write_new(&target(&root, &rel)?, &bytes)
}

#[tauri::command]
pub fn export_write_text(root: String, rel: String, text: String) -> Result<(), String> {
    write_new(&target(&root, &rel)?, text.as_bytes())
}

/// Copies a pasted image from a notes folder. Skips it if already copied.
#[tauri::command]
pub fn export_copy_asset(notes_path: String, asset: String, root: String, rel: String) -> Result<(), String> {
    let from = asset_path(Path::new(&notes_path), &asset)?;
    let to = target(&root, &rel)?;
    if to.exists() {
        return Ok(());
    }
    fs::copy(&from, &to).map_err(|e| format!("{}: {e}", from.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rel_paths_cannot_escape() {
        assert!(safe_rel("Grade A/page.md").is_ok());
        assert!(safe_rel("../evil.md").is_err());
        assert!(safe_rel("a/../../b").is_err());
        assert!(safe_rel("C:/Windows/x").is_err());
        assert!(safe_rel("/etc/x").is_err());
        assert!(safe_rel("").is_err());
    }

    #[test]
    fn prepare_makes_unique_folders_and_never_reuses() {
        let dir = tempfile::tempdir().unwrap();
        let a = prepare_dir(dir.path(), "2026-11-05").unwrap();
        let b = prepare_dir(dir.path(), "2026-11-05").unwrap();
        assert!(a.ends_with("notebook-export-2026-11-05"));
        assert!(b.ends_with("notebook-export-2026-11-05-2"));
        assert!(prepare_dir(&dir.path().join("missing"), "2026-11-05").is_err());
        assert!(prepare_dir(dir.path(), "../x").is_err());
    }

    #[test]
    fn writes_only_inside_an_export_folder_and_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let root = prepare_dir(dir.path(), "2026-11-05").unwrap().to_string_lossy().to_string();
        export_write_text(root.clone(), "Tab/page.md".into(), "hello".into()).unwrap();
        assert_eq!(fs::read_to_string(Path::new(&root).join("Tab/page.md")).unwrap(), "hello");
        assert!(export_write_text(root.clone(), "Tab/page.md".into(), "again".into()).is_err());
        assert!(export_write_text(dir.path().to_string_lossy().to_string(), "x.md".into(), "x".into()).is_err());
    }
}
