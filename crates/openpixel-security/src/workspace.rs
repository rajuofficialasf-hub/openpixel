//! Isolated temp workspace: one directory per job, removed on drop.
//!
//! Every engine that writes intermediate files (PDF page renders,
//! OCR preprocessed images, Office conversion inputs) must do it
//! inside a [`TempWorkspace`], never in a shared or caller-chosen
//! directory. The directory name is `openpixel-{prefix}-{pid}-{n}`
//! under the OS temp dir; `n` is a process-wide counter so two
//! workspaces in one process never collide. `Drop` removes the
//! whole tree; a failure to remove is ignored (the OS temp dir is
//! cleaned by the system), never an error the caller must handle.

use crate::error::SecurityError;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static COUNTER: AtomicU64 = AtomicU64::new(0);

/// An isolated temp directory, removed automatically on drop.
pub struct TempWorkspace {
    path: PathBuf,
}

impl TempWorkspace {
    /// Create a new workspace. `prefix` is part of the directory
    /// name (letters, digits, `-` and `_` only — anything else is
    /// rejected so a caller cannot smuggle a path separator in).
    pub fn new(prefix: &str) -> Result<Self, SecurityError> {
        if prefix.is_empty()
            || !prefix
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err(SecurityError::UnsafePath(format!(
                "invalid workspace prefix '{prefix}'"
            )));
        }
        let base = std::env::temp_dir();
        for _ in 0..100 {
            let n = COUNTER.fetch_add(1, Ordering::SeqCst);
            let path = base.join(format!("openpixel-{prefix}-{}-{n}", std::process::id()));
            match fs::create_dir(&path) {
                Ok(()) => return Ok(Self { path }),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(SecurityError::Io(e)),
            }
        }
        Err(SecurityError::UnsafePath(
            "could not allocate a unique temp workspace".to_string(),
        ))
    }

    /// The workspace directory.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Resolve `name` inside the workspace. `name` must be a plain
    /// file name — no separators, no `..`, no absolute path.
    /// Returns the full path; the file is not created.
    pub fn file_path(&self, name: &str) -> Result<PathBuf, SecurityError> {
        if name.is_empty()
            || name.contains('/')
            || name.contains('\\')
            || name.contains('\0')
            || name == "."
            || name == ".."
        {
            return Err(SecurityError::UnsafePath(format!(
                "unsafe workspace file name '{name}'"
            )));
        }
        let path = self.path.join(name);
        // Defence in depth: the joined path must stay inside the
        // workspace even if the checks above missed something.
        if !path.starts_with(&self.path) {
            return Err(SecurityError::UnsafePath(format!(
                "workspace file name '{name}' escapes the workspace"
            )));
        }
        Ok(path)
    }

    /// Write `bytes` to `name` inside the workspace and return the
    /// full path.
    pub fn write_file(&self, name: &str, bytes: &[u8]) -> Result<PathBuf, SecurityError> {
        let path = self.file_path(name)?;
        fs::write(&path, bytes)?;
        Ok(path)
    }
}

impl Drop for TempWorkspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_is_created_and_removed_on_drop() {
        let path = {
            let ws = TempWorkspace::new("test").unwrap();
            assert!(ws.path().is_dir());
            assert!(ws.path().to_string_lossy().contains("openpixel-test-"));
            let f = ws.write_file("page-1.png", b"fake png").unwrap();
            assert!(f.is_file());
            ws.path().to_path_buf()
        };
        assert!(!path.exists(), "workspace must be gone after drop");
    }

    #[test]
    fn two_workspaces_never_collide() {
        let a = TempWorkspace::new("a").unwrap();
        let b = TempWorkspace::new("a").unwrap();
        assert_ne!(a.path(), b.path());
    }

    #[test]
    fn traversal_and_bad_prefixes_are_rejected() {
        assert!(TempWorkspace::new("").is_err());
        assert!(TempWorkspace::new("../evil").is_err());
        assert!(TempWorkspace::new("a/b").is_err());
        let ws = TempWorkspace::new("ok").unwrap();
        assert!(ws.file_path("../evil.png").is_err());
        assert!(ws.file_path("/etc/passwd").is_err());
        assert!(ws.file_path("sub/dir.png").is_err());
        assert!(ws.file_path("plain.png").is_ok());
    }
}
