//! Application logging for the desktop app (Phase 8).
//!
//! Plain-text, append-only log in the app data directory
//! (`<app_data_dir>/openpixel-desktop.log`). No external crate: the
//! timestamp is a small civil-date conversion from Unix time, and
//! writes are a single `OpenOptions::append` per line. A failed write
//! is swallowed — logging must never fail a conversion.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Log file name inside the app data directory.
pub const LOG_FILE_NAME: &str = "openpixel-desktop.log";

/// Full path of the log file for a given app data directory.
pub fn log_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(LOG_FILE_NAME)
}

/// Append one line (`<UTC timestamp> [LEVEL] message`). Creates the
/// directory and the file on first use. Never panics, never errors.
pub fn append(app_data_dir: &Path, level: &str, message: &str) {
    if std::fs::create_dir_all(app_data_dir).is_err() {
        return;
    }
    let path = log_path(app_data_dir);
    let line = format!("{} [{level}] {message}\n", utc_now());
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = file.write_all(line.as_bytes());
    }
}

/// Read the last `max_lines` lines of the log file (oldest first).
/// A missing log file reads as zero lines, not an error.
pub fn read_tail(app_data_dir: &Path, max_lines: usize) -> Vec<String> {
    let Ok(content) = std::fs::read_to_string(log_path(app_data_dir)) else {
        return Vec::new();
    };
    let lines: Vec<String> = content.lines().map(str::to_string).collect();
    if lines.len() <= max_lines {
        lines
    } else {
        lines[lines.len() - max_lines..].to_vec()
    }
}

/// Current UTC time as `YYYY-MM-DDTHH:MM:SSZ`, converted from Unix
/// time with the days-from-civil algorithm (Howard Hinnant's).
/// Pure arithmetic — no date crate.
pub fn utc_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format_utc(secs)
}

/// Same conversion as [`utc_now`], but for an explicit Unix timestamp
/// (kept separate so tests can pin the input).
pub fn format_utc(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let tod = secs % 86_400;
    let (hour, minute, second) = (tod / 3600, (tod % 3600) / 60, tod % 60);
    // days-from-civil: shift the epoch so March is month 0.
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utc_epoch_is_1970_01_01() {
        assert_eq!(format_utc(0), "1970-01-01T00:00:00Z");
    }

    #[test]
    fn utc_known_date() {
        // 2026-11-16T00:00:00Z
        assert_eq!(format_utc(1_794_787_200), "2026-11-16T00:00:00Z");
    }

    #[test]
    fn log_round_trip_and_tail() {
        let dir = tempfile::tempdir().expect("tempdir");
        append(dir.path(), "INFO", "first");
        append(dir.path(), "ERROR", "second");
        let lines = read_tail(dir.path(), 10);
        assert_eq!(lines.len(), 2);
        assert!(lines[0].ends_with("[INFO] first"));
        assert!(lines[1].ends_with("[ERROR] second"));
        assert_eq!(read_tail(dir.path(), 1).len(), 1);
        assert!(read_tail(dir.path(), 1)[0].ends_with("[ERROR] second"));
    }

    #[test]
    fn missing_log_reads_empty() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(read_tail(dir.path(), 10).is_empty());
    }
}
