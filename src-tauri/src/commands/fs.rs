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

/// Opens the app data folder (config, caches) in Explorer.
#[tauri::command]
pub fn open_app_dir(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = app_dir()?;
    fs::create_dir_all(&dir).map_err(err)?;
    let path = dir.to_string_lossy().to_string();
    app.opener().open_path(path.clone(), None::<&str>).map_err(err)?;
    Ok(path)
}

/// Copies config.json into `folder` as `engineers-notebook-config-<date>.json`
/// so the setup can move to another PC. Keys are never in it. Never overwrites.
pub fn backup_config_to(src: &Path, folder: &Path, date: &str) -> Result<PathBuf, String> {
    if !folder.is_dir() {
        return Err(format!("Folder not found: {}", folder.display()));
    }
    if !date.chars().all(|c| c.is_ascii_digit() || c == '-') {
        return Err("Invalid date".into());
    }
    let text = fs::read_to_string(src).unwrap_or_else(|_| "{}".into());
    for n in 1..100 {
        let name = if n == 1 {
            format!("engineers-notebook-config-{date}.json")
        } else {
            format!("engineers-notebook-config-{date}-{n}.json")
        };
        let target = folder.join(name);
        if !target.exists() {
            atomic_write(&target, text.as_bytes())?;
            return Ok(target);
        }
    }
    Err("Too many backups for one day in that folder".into())
}

#[tauri::command]
pub fn backup_config(folder: String, date: String) -> Result<String, String> {
    backup_config_to(&app_dir()?.join("config.json"), Path::new(&folder), &date)
        .map(|p| p.to_string_lossy().to_string())
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

pub fn is_our_notebook(notes: &Path) -> bool {
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

/// Keeps the tab name and colour in this app's `notebook.json` in step with the app config.
/// Leaves any other app's file, and every other key, alone.
pub fn update_notebook_meta_in(notes: &Path, name: &str, colour: &str) -> Result<(), String> {
    if !is_our_notebook(notes) {
        return Ok(());
    }
    let path = notes.join("notebook.json");
    let text = fs::read_to_string(&path).map_err(err)?;
    let mut v: serde_json::Value = serde_json::from_str(&text).map_err(err)?;
    let Some(obj) = v.as_object_mut() else {
        return Ok(());
    };
    obj.insert("name".into(), serde_json::Value::String(name.into()));
    obj.insert("colour".into(), serde_json::Value::String(colour.into()));
    let out = serde_json::to_string_pretty(&v).map_err(err)?;
    if out != text {
        atomic_write(&path, out.as_bytes())?;
    }
    Ok(())
}

#[tauri::command]
pub fn update_notebook_meta(notes_path: String, name: String, colour: String) -> Result<(), String> {
    update_notebook_meta_in(Path::new(&notes_path), &name, &colour)
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

/// File names of every `*.md` in `<notes>/meetings`; none if the folder does not exist yet.
#[tauri::command]
pub fn list_meeting_files(notes_path: String) -> Result<Vec<String>, String> {
    let meetings = Path::new(&notes_path).join("meetings");
    if !meetings.is_dir() {
        return Ok(vec![]);
    }
    let mut out: Vec<String> = fs::read_dir(&meetings)
        .map_err(err)?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.to_lowercase().ends_with(".md") && !n.starts_with('.'))
        .collect();
    out.sort();
    Ok(out)
}

/// A plain `name.md`: no folders, no leading dot.
fn is_meeting_name(name: &str) -> bool {
    !name.is_empty()
        && name.to_lowercase().ends_with(".md")
        && !name.starts_with('.')
        && !name.contains(['/', '\\', ':'])
}

/// Writes a meeting file into this app's `<notes>/meetings`, creating that folder if needed.
pub fn write_meeting_in(notes: &Path, file_name: &str, contents: &str) -> Result<(), String> {
    if !is_meeting_name(file_name) {
        return Err(format!("Not a meeting file name: {file_name}"));
    }
    if !is_our_notebook(notes) {
        return Err(format!("{} is not a notes folder made by this app.", notes.display()));
    }
    let dir = notes.join("meetings");
    fs::create_dir_all(&dir).map_err(err)?;
    atomic_write(&dir.join(file_name), contents.as_bytes())
}

#[tauri::command]
pub fn write_meeting_file(notes_path: String, file_name: String, contents: String) -> Result<(), String> {
    write_meeting_in(Path::new(&notes_path), &file_name, &contents)
}

/// Renames a meeting file inside `<notes>/meetings`, never overwriting.
#[tauri::command]
pub fn rename_meeting_file(notes_path: String, from: String, to: String) -> Result<(), String> {
    if !is_meeting_name(&from) || !is_meeting_name(&to) {
        return Err("Not a meeting file name.".into());
    }
    let dir = Path::new(&notes_path).join("meetings");
    rename_no_clobber(&dir.join(from), &dir.join(to))
}

/// Deletes a meeting by moving its file (and `.bak`) to the Recycle Bin.
#[tauri::command]
pub fn trash_meeting_file(notes_path: String, file_name: String) -> Result<(), String> {
    if !is_meeting_name(&file_name) {
        return Err(format!("Not a meeting file name: {file_name}"));
    }
    let path = Path::new(&notes_path).join("meetings").join(&file_name);
    if !path.is_file() {
        return Err(format!("File not found: {}", path.display()));
    }
    trash::delete(&path).map_err(|e| format!("Could not move the meeting to the Recycle Bin: {e}"))?;
    let bak = PathBuf::from(format!("{}.bak", path.display()));
    if bak.is_file() {
        let _ = trash::delete(&bak);
    }
    Ok(())
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

/// Only a `*.page.json` file directly inside `<notes>/pages` may be moved to the bin.
pub fn check_page_file(path: &Path) -> Result<(), String> {
    use std::path::Component;
    let bad = || format!("Not a page file: {}", path.display());
    if path.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir)) {
        return Err(bad());
    }
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let pages = path.parent();
    let notes = pages.and_then(Path::parent);
    let named = |p: Option<&Path>, want: &str| {
        p.and_then(Path::file_name).map(|n| n == want).unwrap_or(false)
    };
    if !name.ends_with(".page.json") || !named(pages, "pages") || !named(notes, "notes") {
        return Err(bad());
    }
    if !path.is_file() {
        return Err(format!("File not found: {}", path.display()));
    }
    Ok(())
}

/// Deletes a page by moving it, and its `.bak`, to the Recycle Bin. Never a hard delete.
#[tauri::command]
pub fn trash_page_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    check_page_file(p)?;
    trash::delete(p).map_err(|e| format!("Could not move the page to the Recycle Bin: {e}"))?;
    let bak = PathBuf::from(format!("{}.bak", p.display()));
    if bak.is_file() {
        let _ = trash::delete(&bak);
    }
    Ok(())
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
    fn meeting_files_stay_in_our_meetings_folder() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("Client");
        fs::create_dir_all(&folder).unwrap();
        prepare_folder(&folder, "Client", "#01C6A3", false).unwrap();
        let notes = folder.join("notes");
        let np = notes.to_string_lossy().to_string();

        assert_eq!(list_meeting_files(np.clone()).unwrap(), Vec::<String>::new());
        write_meeting_in(&notes, "2026-11-05-sync.md", "---\nid: \"a\"\n---\n\nHi\n").unwrap();
        write_meeting_in(&notes, "2026-11-05-sync.md", "second").unwrap();
        assert_eq!(fs::read_to_string(notes.join("meetings/2026-11-05-sync.md")).unwrap(), "second");
        assert!(notes.join("meetings/2026-11-05-sync.md.bak").exists());
        fs::write(notes.join("meetings/notes.txt"), "x").unwrap();
        assert_eq!(list_meeting_files(np.clone()).unwrap(), vec!["2026-11-05-sync.md"]);

        for bad in ["../x.md", "sub/x.md", "x.txt", ".hidden.md", "C:x.md", ""] {
            assert!(write_meeting_in(&notes, bad, "x").is_err(), "{bad}");
        }
        let foreign = dir.path().join("Other").join("notes");
        fs::create_dir_all(&foreign).unwrap();
        assert!(write_meeting_in(&foreign, "a.md", "x").is_err());
        assert!(!foreign.join("meetings").exists());

        rename_meeting_file(np.clone(), "2026-11-05-sync.md".into(), "2026-11-05-weekly.md".into()).unwrap();
        assert!(notes.join("meetings/2026-11-05-weekly.md").exists());
        assert!(rename_meeting_file(np, "2026-11-05-weekly.md".into(), "../x.md".into()).is_err());
    }

    #[test]
    fn notebook_meta_updates_only_our_file() {
        let dir = tempfile::tempdir().unwrap();
        let ours = dir.path().join("a");
        fs::create_dir_all(&ours).unwrap();
        prepare_folder(&ours, "Old name", "#01C6A3", false).unwrap();
        let notes = ours.join("notes");
        update_notebook_meta_in(&notes, "New name", "#E8A828").unwrap();
        let v: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(notes.join("notebook.json")).unwrap()).unwrap();
        assert_eq!(v["name"], "New name");
        assert_eq!(v["colour"], "#E8A828");
        assert_eq!(v["app"], APP_MARKER);
        assert!(v["pageOrder"].is_array());

        let other = dir.path().join("b").join("notes");
        fs::create_dir_all(&other).unwrap();
        fs::write(other.join("notebook.json"), r#"{"name":"Theirs"}"#).unwrap();
        update_notebook_meta_in(&other, "New name", "#E8A828").unwrap();
        assert_eq!(fs::read_to_string(other.join("notebook.json")).unwrap(), r#"{"name":"Theirs"}"#);
    }

    #[test]
    fn only_page_files_in_notes_pages_can_be_binned() {
        let dir = tempfile::tempdir().unwrap();
        let pages = dir.path().join("Client").join("notes").join("pages");
        fs::create_dir_all(&pages).unwrap();
        let page = pages.join("2026-11-06-plan.page.json");
        fs::write(&page, "{}").unwrap();
        let other = pages.join("notes.txt");
        fs::write(&other, "x").unwrap();
        let loose = dir.path().join("Client").join("a.page.json");
        fs::write(&loose, "{}").unwrap();

        assert!(check_page_file(&page).is_ok());
        assert!(check_page_file(&other).is_err());
        assert!(check_page_file(&loose).is_err());
        assert!(check_page_file(&pages.join("missing.page.json")).is_err());
        assert!(check_page_file(&pages.join("..").join("pages").join("2026-11-06-plan.page.json")).is_err());
        assert!(check_page_file(&dir.path().join("notes").join("pages")).is_err());
    }

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
    fn config_backup_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("config.json");
        fs::write(&src, "{\"tabs\":[]}").unwrap();
        let out = dir.path().join("out");
        fs::create_dir(&out).unwrap();
        let a = backup_config_to(&src, &out, "2026-11-05").unwrap();
        let b = backup_config_to(&src, &out, "2026-11-05").unwrap();
        assert!(a.ends_with("engineers-notebook-config-2026-11-05.json"));
        assert!(b.ends_with("engineers-notebook-config-2026-11-05-2.json"));
        assert_eq!(fs::read_to_string(a).unwrap(), "{\"tabs\":[]}");
        assert!(backup_config_to(&src, &dir.path().join("missing"), "2026-11-05").is_err());
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
