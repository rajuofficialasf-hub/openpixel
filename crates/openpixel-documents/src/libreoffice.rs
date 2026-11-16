//! LibreOffice headless adapter (Studio Phase 3).
//!
//! LibreOffice is a **system dependency**, not a library: the
//! adapter shells out to `soffice --headless --convert-to`.
//! That is why document conversion is CLI/desktop only — there is
//! no LibreOffice in a browser, and no conversion API is ever
//! called. See `docs/PDF.md` for install notes.
//!
//! Two honesty rules, both learned the hard way (16 Nov 2026):
//! * **Never trust exit code 0.** LibreOffice exits 0 even when
//!   it refuses a conversion ("no export filter") — the adapter
//!   verifies the output file exists and is non-empty, and
//!   surfaces soffice's own log line on failure.
//! * **Fresh profile per conversion.** A profile directory shared
//!   across rapid sequential conversions once produced a spurious
//!   "no output" failure; every call gets its own profile inside
//!   a [`TempWorkspace`], which is deleted on drop.

use crate::error::{DocumentError, Result};
use openpixel_formats::libreoffice_filter;
use openpixel_security::TempWorkspace;
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// How long a single LibreOffice conversion may run.
pub const DEFAULT_TIMEOUT_SECS: u64 = 120;

/// A found `soffice` binary.
#[derive(Debug, Clone)]
pub struct LibreOffice {
    path: PathBuf,
}

impl LibreOffice {
    /// Find LibreOffice: `OPENPIXEL_SOFFICE_PATH` first, then
    /// `soffice`, then `libreoffice` on `PATH`. `None` when it is
    /// not installed — the caller reports that honestly instead of
    /// failing obscurely.
    pub fn discover() -> Option<Self> {
        if let Ok(p) = std::env::var("OPENPIXEL_SOFFICE_PATH") {
            let p = PathBuf::from(p);
            if p.is_file() {
                return Some(Self { path: p });
            }
        }
        for name in ["soffice", "libreoffice"] {
            if let Some(p) = which(name) {
                return Some(Self { path: p });
            }
        }
        None
    }

    pub fn is_available() -> bool {
        Self::discover().is_some()
    }

    /// `soffice --version`, e.g. `"LibreOffice 24.2.7.2 ..."`.
    pub fn version(&self) -> Result<String> {
        let out = Command::new(&self.path)
            .arg("--version")
            .output()
            .map_err(DocumentError::Io)?;
        let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if text.is_empty() {
            return Err(DocumentError::NotAvailable(
                "soffice --version printed nothing".to_string(),
            ));
        }
        Ok(text)
    }

    /// Convert `input` (a document of `source_ext`, e.g. `"docx"`)
    /// to `target` (e.g. `"pdf"`). Returns the output bytes.
    ///
    /// The input is written to a temp file (LibreOffice converts
    /// files, not stdin), converted with a fresh user profile, and
    /// the output file is verified to exist and be non-empty
    /// before it is read back. On timeout the soffice process is
    /// killed.
    pub fn convert(
        &self,
        input: &[u8],
        source_ext: &str,
        target: &str,
        timeout: Duration,
    ) -> Result<Vec<u8>> {
        let filter =
            libreoffice_filter(target).ok_or_else(|| DocumentError::UnsupportedConversion {
                src: source_ext.to_string(),
                dst: target.to_string(),
                reason: "LibreOffice has no export filter for this target".to_string(),
            })?;
        let target_ext = filter;
        let ws = TempWorkspace::new("openpixel-doc")?;
        let profile = ws.path().join("profile");
        let out_dir = ws.path().join("out");
        fs::create_dir(&profile).map_err(DocumentError::Io)?;
        fs::create_dir(&out_dir).map_err(DocumentError::Io)?;
        let input_name = format!("input.{source_ext}");
        let input_path = ws.write_file(&input_name, input)?;
        let stdout_log = ws.path().join("soffice-stdout.log");
        let stderr_log = ws.path().join("soffice-stderr.log");
        let stdout_file = fs::File::create(&stdout_log).map_err(DocumentError::Io)?;
        let stderr_file = fs::File::create(&stderr_log).map_err(DocumentError::Io)?;
        let profile_arg = format!("-env:UserInstallation=file://{}", profile.to_string_lossy());
        let mut child: Child = Command::new(&self.path)
            .args([
                "--headless",
                "--invisible",
                "--norestore",
                &profile_arg,
                "--convert-to",
                filter,
                "--outdir",
            ])
            .arg(&out_dir)
            .arg(&input_path)
            .stdout(Stdio::from(stdout_file))
            .stderr(Stdio::from(stderr_file))
            .spawn()
            .map_err(DocumentError::Io)?;
        // Poll for exit; kill on timeout. Output goes to files,
        // so there is no pipe to deadlock on.
        let started = Instant::now();
        loop {
            match child.try_wait().map_err(DocumentError::Io)? {
                Some(_status) => break,
                None => {
                    if started.elapsed() >= timeout {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err(DocumentError::Timeout(timeout.as_secs()));
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
            }
        }
        let expected = out_dir.join(format!("input.{target_ext}"));
        match fs::read(&expected) {
            Ok(bytes) if !bytes.is_empty() => Ok(bytes),
            _ => Err(DocumentError::ConversionFailed {
                src: source_ext.to_string(),
                dst: target.to_string(),
                detail: soffice_failure_detail(&stdout_log, &stderr_log),
            }),
        }
    }
}

/// The last few lines of soffice's logs, so a failure says *why*
/// ("no export filter", file not found, …) instead of just
/// "conversion failed".
fn soffice_failure_detail(stdout_log: &std::path::Path, stderr_log: &std::path::Path) -> String {
    let mut lines: Vec<String> = Vec::new();
    for log in [stderr_log, stdout_log] {
        if let Ok(mut f) = fs::File::open(log) {
            let mut text = String::new();
            if f.read_to_string(&mut text).is_ok() {
                lines.extend(
                    text.lines()
                        .map(str::trim)
                        .filter(|l| !l.is_empty())
                        .map(str::to_string),
                );
            }
        }
    }
    // Keep the most informative lines: errors first, then the
    // tail. Cap at 5 lines so the message stays readable.
    let mut errors: Vec<String> = lines
        .iter()
        .filter(|l| l.to_ascii_lowercase().contains("error"))
        .cloned()
        .collect();
    if errors.is_empty() {
        errors = lines.iter().rev().take(3).cloned().collect();
        errors.reverse();
    }
    errors.truncate(5);
    if errors.is_empty() {
        "LibreOffice produced no output file (and logged nothing)".to_string()
    } else {
        errors.join(" | ")
    }
}

/// Minimal `which`: search `PATH` for an executable file.
fn which(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        if candidate.is_file() && is_executable(&candidate) {
            return Some(candidate);
        }
    }
    None
}

#[cfg(unix)]
fn is_executable(path: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(path)
        .map(|m| m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &std::path::Path) -> bool {
    path.is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discover_finds_soffice_when_installed() {
        // This VM has LibreOffice 24.2.7.2; CI does not. The
        // test asserts the honest answer in each case instead
        // of assuming the binary is there.
        match LibreOffice::discover() {
            Some(lo) => {
                let v = lo.version().unwrap();
                assert!(v.contains("LibreOffice"), "unexpected version string: {v}");
            }
            None => {
                assert!(!LibreOffice::is_available());
            }
        }
    }

    #[test]
    fn convert_without_libreoffice_is_an_honest_error() {
        if LibreOffice::discover().is_some() {
            // Installed here: covered by the engine tests.
            return;
        }
        let lo = LibreOffice {
            path: PathBuf::from("/nonexistent/soffice"),
        };
        let err = lo
            .convert(b"hello", "txt", "pdf", Duration::from_secs(5))
            .unwrap_err();
        // Either spawn fails (Io) or the binary is missing — both
        // are errors, never a fake success.
        assert!(matches!(err, DocumentError::Io(_)));
    }
}
