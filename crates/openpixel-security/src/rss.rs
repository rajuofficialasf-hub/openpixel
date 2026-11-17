//! RSS cap (closes Phase 9 accepted risk A9, as a pre-flight check).
//!
//! Pixel limits bound decoded buffers, but nothing bounded the
//! process's resident memory. [`check_rss_cap`] refuses to *start*
//! work when the process is already over the cap. It cannot stop a
//! call that is already running and it is not a cgroup: a
//! deployment that needs a hard cap should use `ulimit` / cgroup
//! limits. On non-Linux platforms the RSS cannot be read from
//! `/proc`, so the check is a no-op there — callers must not treat
//! "no reading" as "under the cap", only as "unknown".

use crate::error::SecurityError;

/// Peak resident set size of this process in bytes, read from
/// `/proc/self/status` (`VmHWM`, Linux only). Returns `None` on
/// non-Linux platforms or when the field cannot be read.
pub fn peak_rss_bytes() -> Option<u64> {
    #[cfg(target_os = "linux")]
    {
        read_status_kib("VmHWM").map(|kib| kib * 1024)
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

/// Current resident set size of this process in bytes (Linux only,
/// `/proc/self/status` `VmRSS`). Returns `None` on non-Linux
/// platforms or when the field cannot be read.
pub fn current_rss_bytes() -> Option<u64> {
    #[cfg(target_os = "linux")]
    {
        read_status_kib("VmRSS").map(|kib| kib * 1024)
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

/// Current resident set size of an arbitrary process in bytes
/// (Linux only, `/proc/<pid>/status` `VmRSS`). Returns `None` on
/// non-Linux platforms, for an unknown / already-reaped pid, or
/// when the field cannot be read. This is the reader the
/// process-isolation monitor (Phase 8, [`crate::isolated`]) polls
/// while a child runs: the same parser as [`current_rss_bytes`],
/// pointed at another pid.
pub fn rss_bytes_for_pid(pid: u32) -> Option<u64> {
    #[cfg(target_os = "linux")]
    {
        read_status_kib_for_pid(pid, "VmRSS").map(|kib| kib * 1024)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = pid;
        None
    }
}

#[cfg(target_os = "linux")]
fn read_status_kib(field: &str) -> Option<u64> {
    read_status_kib_for_pid(std::process::id(), field)
}

#[cfg(target_os = "linux")]
fn read_status_kib_for_pid(pid: u32, field: &str) -> Option<u64> {
    let status = std::fs::read_to_string(format!("/proc/{pid}/status")).ok()?;
    for line in status.lines() {
        if let Some(rest) = line.strip_prefix(field) {
            let num: String = rest.chars().filter(|c| c.is_ascii_digit()).collect();
            return num.parse::<u64>().ok();
        }
    }
    None
}

/// Refuse to start work when the process RSS is already over `cap`
/// bytes. Ok when the RSS is under the cap, and Ok (no-op) when the
/// RSS cannot be read on this platform.
pub fn check_rss_cap(cap: u64) -> Result<(), SecurityError> {
    if let Some(current) = current_rss_bytes() {
        if current > cap {
            return Err(SecurityError::RssCapExceeded { current, cap });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rss_is_readable_on_linux() {
        // On Linux this must return a plausible value (this test
        // binary alone is a few MiB); elsewhere it is None and the
        // test is a no-op.
        if let Some(rss) = current_rss_bytes() {
            assert!(rss > 0 && rss < 10 * 1024 * 1024 * 1024, "rss = {rss}");
        }
    }

    #[test]
    fn tiny_cap_is_refused_and_huge_cap_passes() {
        if current_rss_bytes().is_some() {
            // Linux: RSS is readable, so a 1-byte cap must be refused.
            assert!(matches!(
                check_rss_cap(1),
                Err(SecurityError::RssCapExceeded { .. })
            ));
        } else {
            // Non-Linux: RSS cannot be read, so the check is a documented no-op.
            assert!(check_rss_cap(1).is_ok());
        }
        assert!(check_rss_cap(u64::MAX).is_ok());
    }

    #[test]
    fn rss_for_own_pid_matches_self_reading() {
        // On Linux both readers must return a plausible value for
        // this process (they are two sequential /proc reads, so
        // they may differ by a few KiB — compare loosely, not
        // exactly). Elsewhere both are None and the test is a no-op.
        let via_self = current_rss_bytes();
        let via_pid = rss_bytes_for_pid(std::process::id());
        assert_eq!(via_self.is_some(), via_pid.is_some());
        if let (Some(a), Some(b)) = (via_self, via_pid) {
            let diff = a.abs_diff(b);
            assert!(
                diff < 1024 * 1024,
                "own RSS readings differ by {diff} bytes ({a} vs {b})"
            );
            assert!(b > 0, "own RSS must be positive");
        }
        // A pid that (almost certainly) does not exist reads as None,
        // never as 0 or an error.
        assert_eq!(rss_bytes_for_pid(u32::MAX), None);
    }
}
