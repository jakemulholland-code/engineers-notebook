//! File-system helpers for client notes folders and the app config.
//!
//! Rules (see SPEC.md "Saving rules"):
//! - Writes are atomic: write a temp file, then rename over the target.
//! - The previous version of a file is kept as `<name>.bak`.
//! - A missing client folder is reported, never silently recreated.

use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const APP_MARKER: &str = "engineers-notebook";

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// `%APPDATA%/engineers-notebook` on Windows, the platform config dir elsewhere.
/// `ENGINEERS_NOTEBOOK_APP_DIR` overrides it (dev runs and end-to-end tests use
/// a folder under `test-fixtures/`).
fn app_dir() -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("ENGINEERS_NOTEBOOK_APP_DIR") {
        if !dir.is_empty() {
            return Ok(PathBuf::from(dir));
        }
    }
    let base = dirs::config_dir().ok_or("Could not find the app data folder")?;
    Ok(base.join(APP_MARKER))
}

/// Atomic write with one `.bak` of the previous version.
pub fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Path has no parent folder")?;
    if !parent.exists() {
        return Err(format!("Folder not found: {}", parent.display()));
    }
    let file_name = path
        .file_name()
        .ok_or("Path has no file name")?
        .to_string_lossy()
        .to_string();
    let tmp = parent.join(format!(".{file_name}.tmp"));
    {
        let mut f = fs::File::create(&tmp).map_err(err)?;
        f.write_all(contents).map_err(err)?;
        f.sync_all().map_err(err)?;
    }
    if path.exists() {
        let bak = parent.join(format!("{file_name}.bak"));
        fs::copy(path, &bak).map_err(err)?;
    }
    // On Windows std::fs::rename replaces an existing target (MOVEFILE_REPLACE_EXISTING).
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        err(e)
    })
}

#[tauri::command]
pub fn app_config_path() -> Result<String, String> {
    Ok(app_dir()?.join("config.json").to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_app_config() -> Result<Option<String>, String> {
    let path = app_dir()?.join("config.json");
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path).map(Some).map_err(err)
}

#[tauri::command]
pub fn write_app_config(contents: String) -> Result<(), String> {
    let dir = app_dir()?;
    fs::create_dir_all(&dir).map_err(err)?;
    atomic_write(&dir.join("config.json"), contents.as_bytes())
}

/// Only plain names like `reminders-cache.json` are allowed in the app data folder.
fn app_file(name: &str) -> Result<PathBuf, String> {
    let ok = !name.is_empty()
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.');
    if !ok || name == "config.json" {
        return Err(format!("Invalid app file name: {name}"));
    }
    Ok(app_dir()?.join(name))
}

#[tauri::command]
pub fn read_app_file(name: String) -> Result<Option<String>, String> {
    let path = app_file(&name)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path).map(Some).map_err(err)
}

#[tauri::command]
pub fn write_app_file(name: String, contents: String) -> Result<(), String> {
    let path = app_file(&name)?;
    fs::create_dir_all(app_dir()?).map_err(err)?;
    atomic_write(&path, contents.as_bytes())
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrepareResult {
    /// "created" (new notes folder), "existing" (this app's notes folder, loaded as is),
    /// or "foreign" (an unrelated `notes` folder; nothing was written).
    pub status: String,
    pub notes_path: String,
}

fn is_our_notebook(notes: &Path) -> bool {
    let Ok(text) = fs::read_to_string(notes.join("notebook.json")) else {
        return false;
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
        return false;
    };
    v.get("app").and_then(|a| a.as_str()) == Some(APP_MARKER)
}

pub fn prepare_folder(
    folder: &Path,
    name: &str,
    colour: &str,
    allow_foreign: bool,
) -> Result<PrepareResult, String> {
    if !folder.is_dir() {
        return Err(format!("Folder not found: {}", folder.display()));
    }
    let notes = folder.join("notes");
    let notes_path = notes.to_string_lossy().to_string();

    if notes.exists() {
        if is_our_notebook(&notes) {
            // Make sure subfolders exist, but never touch existing files.
            fs::create_dir_all(notes.join("pages")).map_err(err)?;
            fs::create_dir_all(notes.join("assets")).map_err(err)?;
            return Ok(PrepareResult { status: "existing".into(), notes_path });
        }
        if !allow_foreign {
            return Ok(PrepareResult { status: "foreign".into(), notes_path });
        }
        if notes.join("notebook.json").exists() {
            return Err("This notes folder already has a notebook.json from another app. Choose a different folder.".into());
        }
    }

    fs::create_dir_all(notes.join("pages")).map_err(err)?;
    fs::create_dir_all(notes.join("assets")).map_err(err)?;
    let notebook = serde_json::json!({
        "app": APP_MARKER,
        "schemaVersion": 1,
        "name": name,
        "colour": colour,
        "pageOrder": [],
    });
    let text = serde_json::to_string_pretty(&notebook).map_err(err)?;
    atomic_write(&notes.join("notebook.json"), text.as_bytes())?;
    Ok(PrepareResult { status: "created".into(), notes_path })
}

#[tauri::command]
pub fn prepare_client_folder(
    folder: String,
    name: String,
    colour: String,
    allow_foreign: bool,
) -> Result<PrepareResult, String> {
    prepare_folder(Path::new(&folder), &name, &colour, allow_foreign)
}

/// File names (not paths) of every `*.page.json` in `<notes>/pages`.
#[tauri::command]
pub fn list_page_files(notes_path: String) -> Result<Vec<String>, String> {
    let pages = Path::new(&notes_path).join("pages");
    if !pages.is_dir() {
        return Err(format!("Folder not found: {}", pages.display()));
    }
    let mut out: Vec<String> = fs::read_dir(&pages)
        .map_err(err)?
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.ends_with(".page.json"))
        .collect();
    out.sort();
    Ok(out)
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(err)
}

#[tauri::command]
pub fn write_text_atomic(path: String, contents: String) -> Result<(), String> {
    atomic_write(Path::new(&path), contents.as_bytes())
}

/// Renames a file, refusing to overwrite. Moves its `.bak` along with it.
pub fn rename_no_clobber(from: &Path, to: &Path) -> Result<(), String> {
    if to.exists() {
        return Err(format!("A file named {} already exists", to.display()));
    }
    fs::rename(from, to).map_err(err)?;
    let bak_from = PathBuf::from(format!("{}.bak", from.display()));
    let bak_to = PathBuf::from(format!("{}.bak", to.display()));
    if bak_from.exists() && !bak_to.exists() {
        let _ = fs::rename(bak_from, bak_to);
    }
    Ok(())
}

#[tauri::command]
pub fn rename_file(from: String, to: String) -> Result<(), String> {
    rename_no_clobber(Path::new(&from), Path::new(&to))
}

#[tauri::command]
pub fn open_in_explorer(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if !Path::new(&path).exists() {
        return Err(format!("Folder not found: {path}"));
    }
    app.opener().open_path(path, None::<&str>).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_keeps_one_backup() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.page.json");
        atomic_write(&p, b"one").unwrap();
        assert!(!dir.path().join("a.page.json.bak").exists());
        atomic_write(&p, b"two").unwrap();
        atomic_write(&p, b"three").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "three");
        assert_eq!(fs::read_to_string(dir.path().join("a.page.json.bak")).unwrap(), "two");
        assert!(!dir.path().join(".a.page.json.tmp").exists());
    }

    #[test]
    fn atomic_write_refuses_missing_folder() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("gone").join("x.json");
        assert!(atomic_write(&p, b"x").is_err());
        assert!(!dir.path().join("gone").exists());
    }

    #[test]
    fn prepare_creates_then_reuses() {
        let dir = tempfile::tempdir().unwrap();
        let r = prepare_folder(dir.path(), "Grade A", "#01C6A3", false).unwrap();
        assert_eq!(r.status, "created");
        assert!(dir.path().join("notes/pages").is_dir());
        assert!(dir.path().join("notes/assets").is_dir());
        assert!(dir.path().join("notes/notebook.json").is_file());
        let r2 = prepare_folder(dir.path(), "Renamed", "#fff", false).unwrap();
        assert_eq!(r2.status, "existing");
        let nb = fs::read_to_string(dir.path().join("notes/notebook.json")).unwrap();
        assert!(nb.contains("Grade A"), "existing notebook.json must not be overwritten");
    }

    #[test]
    fn prepare_flags_foreign_notes_without_writing() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("notes")).unwrap();
        fs::write(dir.path().join("notes/todo.txt"), "mine").unwrap();
        let r = prepare_folder(dir.path(), "X", "#fff", false).unwrap();
        assert_eq!(r.status, "foreign");
        assert!(!dir.path().join("notes/notebook.json").exists());
        let r2 = prepare_folder(dir.path(), "X", "#fff", true).unwrap();
        assert_eq!(r2.status, "created");
        assert_eq!(fs::read_to_string(dir.path().join("notes/todo.txt")).unwrap(), "mine");
    }

    #[test]
    fn rename_refuses_to_clobber_and_moves_bak() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.page.json");
        let b = dir.path().join("b.page.json");
        atomic_write(&a, b"1").unwrap();
        atomic_write(&a, b"2").unwrap();
        rename_no_clobber(&a, &b).unwrap();
        assert!(!a.exists());
        assert_eq!(fs::read_to_string(&b).unwrap(), "2");
        assert!(dir.path().join("b.page.json.bak").exists());
        fs::write(&a, "other").unwrap();
        assert!(rename_no_clobber(&a, &b).is_err());
        assert_eq!(fs::read_to_string(&b).unwrap(), "2");
    }

    #[test]
    fn app_file_names_are_restricted() {
        assert!(app_file("reminders-cache.json").is_ok());
        assert!(app_file("../evil.json").is_err());
        assert!(app_file("a/b.json").is_err());
        assert!(app_file(".hidden").is_err());
        assert!(app_file("config.json").is_err());
    }

    #[test]
    fn prepare_never_creates_missing_folder() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("unplugged");
        assert!(prepare_folder(&missing, "X", "#fff", false).is_err());
        assert!(!missing.exists());
    }
}
