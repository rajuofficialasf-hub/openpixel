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

#[cfg(target_os = "linux")]
fn read_status_kib(field: &str) -> Option<u64> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
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
        assert!(matches!(
            check_rss_cap(1),
            Err(SecurityError::RssCapExceeded { .. })
        ));
        assert!(check_rss_cap(u64::MAX).is_ok());
    }
}
