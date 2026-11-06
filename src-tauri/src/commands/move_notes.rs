//! "Move existing notes" when a client's folder changes (SPEC: Settings, Change folder):
//! copy the notes folder, verify every file, then remove the old copy.
//!
//! The old copy goes to the Recycle Bin rather than being deleted outright, so a move can
//! always be undone by hand. If anything fails before that point the original is untouched
//! and the partial copy (which this command created) is removed.

use crate::commands::fs::is_our_notebook;
use crate::commands::watch::WatchState;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::State;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MoveResult {
    /// `<new folder>/notes`
    pub notes_path: String,
    /// Number of files copied and verified.
    pub files: usize,
    /// Why the old notes folder could not be moved to the Recycle Bin, if it could not.
    pub old_left_behind: Option<String>,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Every file under `dir`, as paths relative to it. Links are refused rather than followed.
fn list_files(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut out = Vec::new();
    let mut stack = vec![PathBuf::new()];
    while let Some(rel) = stack.pop() {
        for entry in fs::read_dir(dir.join(&rel)).map_err(err)? {
            let entry = entry.map_err(err)?;
            let kind = entry.file_type().map_err(err)?;
            let child = rel.join(entry.file_name());
            if kind.is_symlink() {
                return Err(format!(
                    "The notes folder contains a link ({}), which the app will not move. Move it by hand instead.",
                    child.display()
                ));
            } else if kind.is_dir() {
                stack.push(child);
            } else {
                out.push(child);
            }
        }
    }
    out.sort();
    Ok(out)
}

fn file_hash(path: &Path) -> Result<(u64, [u8; 32]), String> {
    let mut f = fs::File::open(path).map_err(err)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    let mut len = 0u64;
    loop {
        let n = f.read(&mut buf).map_err(err)?;
        if n == 0 {
            break;
        }
        len += n as u64;
        hasher.update(&buf[..n]);
    }
    Ok((len, hasher.finalize().into()))
}

fn copy_tree(from: &Path, to: &Path, files: &[PathBuf]) -> Result<(), String> {
    fs::create_dir_all(to).map_err(err)?;
    // Recreate empty folders too (for example an empty `assets`).
    let mut stack = vec![PathBuf::new()];
    while let Some(rel) = stack.pop() {
        for entry in fs::read_dir(from.join(&rel)).map_err(err)? {
            let entry = entry.map_err(err)?;
            if entry.file_type().map_err(err)?.is_dir() {
                let child = rel.join(entry.file_name());
                fs::create_dir_all(to.join(&child)).map_err(err)?;
                stack.push(child);
            }
        }
    }
    for rel in files {
        fs::copy(from.join(rel), to.join(rel))
            .map_err(|e| format!("Could not copy {}: {e}", rel.display()))?;
    }
    Ok(())
}

fn verify(from: &Path, to: &Path, files: &[PathBuf]) -> Result<(), String> {
    for rel in files {
        let a = file_hash(&from.join(rel))?;
        let b = file_hash(&to.join(rel))
            .map_err(|e| format!("{} is missing from the copy: {e}", rel.display()))?;
        if a != b {
            return Err(format!("{} did not copy correctly.", rel.display()));
        }
    }
    Ok(())
}

/// Same folder, or one inside the other, after resolving `..` and links.
fn overlaps(a: &Path, b: &Path) -> bool {
    let (Ok(a), Ok(b)) = (a.canonicalize(), b.canonicalize()) else {
        return false;
    };
    a.starts_with(&b) || b.starts_with(&a)
}

/// The move itself, with the final "remove the old copy" step passed in so tests can run it
/// without touching the real Recycle Bin.
pub fn move_notes_with(
    from_notes: &Path,
    to_folder: &Path,
    remove_old: impl Fn(&Path) -> Result<(), String>,
) -> Result<MoveResult, String> {
    if !is_our_notebook(from_notes) {
        return Err(format!(
            "{} is not a notes folder made by this app, so it will not be moved.",
            from_notes.display()
        ));
    }
    if !to_folder.is_dir() {
        return Err(format!("Folder not found: {}", to_folder.display()));
    }
    let to_notes = to_folder.join("notes");
    if overlaps(from_notes, to_folder) {
        return Err("Choose a folder outside the current notes folder.".into());
    }
    let existed = to_notes.exists();
    if existed && fs::read_dir(&to_notes).map_err(err)?.next().is_some() {
        return Err(format!(
            "{} already exists and is not empty. Choose another folder, or point the tab at this folder without moving.",
            to_notes.display()
        ));
    }

    let files = list_files(from_notes)?;
    let copied = copy_tree(from_notes, &to_notes, &files)
        .and_then(|_| verify(from_notes, &to_notes, &files));
    if let Err(e) = copied {
        // Only ever clean up what this command created.
        if existed {
            for entry in fs::read_dir(&to_notes).into_iter().flatten().flatten() {
                let p = entry.path();
                let _ = if p.is_dir() {
                    fs::remove_dir_all(&p)
                } else {
                    fs::remove_file(&p)
                };
            }
        } else {
            let _ = fs::remove_dir_all(&to_notes);
        }
        return Err(format!(
            "The notes were not moved: {e} The original folder is untouched."
        ));
    }

    let old_left_behind = remove_old(from_notes).err();
    Ok(MoveResult {
        notes_path: to_notes.to_string_lossy().to_string(),
        files: files.len(),
        old_left_behind,
    })
}

#[tauri::command]
pub fn move_notes(
    watch: State<'_, WatchState>,
    from_notes: String,
    to_folder: String,
) -> Result<MoveResult, String> {
    // A watched folder cannot be moved on Windows; the app watches the new one once it loads.
    watch.stop(&from_notes);
    move_notes_with(Path::new(&from_notes), Path::new(&to_folder), |old| {
        trash::delete(old).map_err(|e| e.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::fs::prepare_folder;
    use std::cell::RefCell;

    fn client(root: &Path, name: &str) -> PathBuf {
        let folder = root.join(name);
        fs::create_dir_all(&folder).unwrap();
        prepare_folder(&folder, name, "#01C6A3", false).unwrap();
        let notes = folder.join("notes");
        fs::write(
            notes.join("pages").join("2026-11-01-a.page.json"),
            "{\"a\":1}",
        )
        .unwrap();
        fs::write(
            notes.join("pages").join("2026-11-01-a.page.json.bak"),
            "{\"a\":0}",
        )
        .unwrap();
        fs::write(notes.join("assets").join("abc.png"), [0u8, 1, 2, 3, 255]).unwrap();
        notes
    }

    #[test]
    fn copies_verifies_then_removes_old() {
        let dir = tempfile::tempdir().unwrap();
        let from = client(dir.path(), "Old");
        let to = dir.path().join("New");
        fs::create_dir_all(&to).unwrap();
        let removed = RefCell::new(None);
        let r = move_notes_with(&from, &to, |p| {
            *removed.borrow_mut() = Some(p.to_path_buf());
            Ok(())
        })
        .unwrap();
        assert_eq!(r.files, 4); // notebook.json, page, .bak, asset
        assert_eq!(r.old_left_behind, None);
        assert_eq!(removed.borrow().as_deref(), Some(from.as_path()));
        let to_notes = to.join("notes");
        assert_eq!(
            fs::read(to_notes.join("assets/abc.png")).unwrap(),
            vec![0u8, 1, 2, 3, 255]
        );
        assert_eq!(
            fs::read_to_string(to_notes.join("pages/2026-11-01-a.page.json.bak")).unwrap(),
            "{\"a\":0}"
        );
        assert!(is_our_notebook(&to_notes));
    }

    #[test]
    fn reports_an_old_copy_it_could_not_remove() {
        let dir = tempfile::tempdir().unwrap();
        let from = client(dir.path(), "Old");
        let to = dir.path().join("New");
        fs::create_dir_all(&to).unwrap();
        let r = move_notes_with(&from, &to, |_| Err("in use".into())).unwrap();
        assert_eq!(r.old_left_behind.as_deref(), Some("in use"));
        assert!(from.join("notebook.json").exists());
    }

    #[test]
    fn accepts_an_empty_notes_folder_at_the_destination() {
        let dir = tempfile::tempdir().unwrap();
        let from = client(dir.path(), "Old");
        let to = dir.path().join("New");
        fs::create_dir_all(to.join("notes")).unwrap();
        assert!(move_notes_with(&from, &to, |_| Ok(())).is_ok());
    }

    #[test]
    fn refuses_unsafe_moves_and_never_removes_the_original() {
        let dir = tempfile::tempdir().unwrap();
        let from = client(dir.path(), "Old");
        let never = |_: &Path| -> Result<(), String> { panic!("must not remove the original") };

        // Destination already has notes.
        let busy = dir.path().join("Busy");
        fs::create_dir_all(busy.join("notes")).unwrap();
        fs::write(busy.join("notes").join("mine.txt"), "x").unwrap();
        assert!(move_notes_with(&from, &busy, never)
            .unwrap_err()
            .contains("not empty"));
        assert_eq!(
            fs::read_to_string(busy.join("notes/mine.txt")).unwrap(),
            "x"
        );

        // Destination inside the notes folder.
        let inside = from.join("pages");
        assert!(move_notes_with(&from, &inside, never)
            .unwrap_err()
            .contains("outside"));

        // Missing destination, or a source this app did not make.
        assert!(move_notes_with(&from, &dir.path().join("Nope"), never).is_err());
        let foreign = dir.path().join("Foreign").join("notes");
        fs::create_dir_all(&foreign).unwrap();
        let to = dir.path().join("New");
        fs::create_dir_all(&to).unwrap();
        assert!(move_notes_with(&foreign, &to, never)
            .unwrap_err()
            .contains("not a notes folder"));
        assert!(!to.join("notes").exists());

        assert!(from.join("pages/2026-11-01-a.page.json").exists());
    }

    #[test]
    fn verify_catches_a_bad_copy() {
        let dir = tempfile::tempdir().unwrap();
        let from = client(dir.path(), "Old");
        let to = dir.path().join("copy");
        let files = list_files(&from).unwrap();
        copy_tree(&from, &to, &files).unwrap();
        assert!(verify(&from, &to, &files).is_ok());
        fs::write(to.join("assets/abc.png"), [9u8]).unwrap();
        assert!(verify(&from, &to, &files).unwrap_err().contains("abc.png"));
        fs::remove_file(to.join("pages/2026-11-01-a.page.json")).unwrap();
        assert!(verify(&from, &to, &files).is_err());
    }
}
