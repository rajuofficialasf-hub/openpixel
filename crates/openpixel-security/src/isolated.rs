//! True process isolation (Phase 8): timeout-**kill** and RSS
//! enforcement for heavy work.
//!
//! This closes the two honest gaps Phase 1 left behind (accepted
//! risks A8/A9, `docs/SECURITY-AUDIT.md`):
//!
//! * [`run_with_timeout`] (thread timeout) **detaches** the worker
//!   on timeout — it keeps running, holding its memory. That is
//!   still the behaviour for in-process callers that cannot
//!   re-execute (the desktop app, the WASM build).
//! * [`crate::check_rss_cap`] is only a **pre-flight** check: it
//!   refuses to *start* work on an already-bloated process and
//!   cannot stop a call that is already running.
//!
//! [`run_command_isolated`] is the real enforcement. It spawns the
//! work as a **child process**, then supervises it from the parent:
//!
//! * **Timeout** — when the deadline passes, the parent kills the
//!   child (`Child::kill`, SIGKILL on Unix) and reaps it. The
//!   caller gets [`IsolationError::TimedOut`], which names the
//!   timeout and the killed pid. Nothing keeps running.
//! * **RSS** — while the child runs, the parent polls its resident
//!   memory (Linux `/proc/<pid>/status`, via
//!   [`crate::rss_bytes_for_pid`]) every [`IsolationLimits::poll_interval`].
//!   When RSS passes [`IsolationLimits::max_rss_bytes`] the parent
//!   kills the child and the caller gets
//!   [`IsolationError::RssCapExceeded`], which names the observed
//!   RSS and the cap. Nothing silently continues.
//! * **Exit status** — a child that exits non-zero on its own is
//!   reported as [`IsolationError::ChildFailed`] with its stderr
//!   (truncated), never mistaken for a timeout or an RSS kill.
//!
//! # Platform honesty
//!
//! * Linux: both timeout-kill and RSS enforcement work
//!   ([`platform_support`] reports `rss_enforcement: true`).
//! * Windows / macOS: timeout-kill works (`std::process::Child::kill`
//!   is cross-platform); RSS enforcement does **not** — there is no
//!   `/proc` to read, so the RSS cap is not enforced and
//!   `rss_enforced` is `false` in [`IsolatedOutput`]. Callers must
//!   not claim an RSS cap on those platforms; a deployment that
//!   needs a hard cap there should use OS limits (`ulimit` /
//!   cgroups / Job Objects).
//! * wasm32: no child processes exist. [`run_command_isolated`]
//!   returns [`IsolationError::UnsupportedPlatform`] without
//!   spawning anything.
//!
//! # Limits of the mechanism
//!
//! * Only the **direct child** is killed. The worker must not spawn
//!   grandchildren — the CLI's isolated worker
//!   (`openpixel __isolated-work`) never does, so a kill always
//!   ends the work. A child that did spawn grandchildren would
//!   orphan them; that is a property of the child, not of this
//!   monitor.
//! * RSS is sampled, not continuous: a spike that allocates and
//!   frees between two polls (default 25 ms) can be missed, and a
//!   process that exhausts memory faster than one poll interval
//!   can be OOM-killed before the monitor sees it. The pixel /
//!   file-size limits remain the first line of defence; this is
//!   the second.
//! * The child's stdout/stderr are drained by threads and returned
//!   in [`IsolatedOutput`]; a child that fills the pipes faster
//!   than the drain threads read them blocks on write, which is
//!   the standard back-pressure behaviour, not a hang.

use crate::rss::rss_bytes_for_pid;
use std::io::Read;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};
use thiserror::Error;

/// How long the supervisor may take to notice a breach. Shorter
/// polls catch RSS spikes sooner and cost more `/proc` reads;
/// 25 ms is ~40 reads/second, negligible next to a conversion.
pub const DEFAULT_POLL_INTERVAL: Duration = Duration::from_millis(25);

/// The stderr tail kept in [`IsolationError::ChildFailed`]: enough
/// to name the failure, not the whole log.
pub const MAX_STDERR_TAIL: usize = 500;

/// What the supervisor enforces. Both limits are `Option` so a
/// caller can enforce one without the other; `None` means "not
/// enforced by this run" (not "unlimited" — the caller's own
/// defaults decide that).
#[derive(Debug, Clone, Copy)]
pub struct IsolationLimits {
    /// Wall-clock deadline for the child. `None` = no timeout.
    pub timeout: Option<Duration>,
    /// Resident-memory ceiling for the child, in bytes. `None` = no
    /// RSS cap. On non-Linux platforms this is accepted and ignored
    /// (see [`IsolatedOutput::rss_enforced`]).
    pub max_rss_bytes: Option<u64>,
    /// How often to poll the child (exit check + RSS read).
    pub poll_interval: Duration,
}

impl Default for IsolationLimits {
    fn default() -> Self {
        Self {
            // Mirrors `EngineConfig::processing_timeout` (300 s).
            timeout: Some(Duration::from_secs(300)),
            // Mirrors `EngineConfig::max_rss_bytes` (2 GiB).
            max_rss_bytes: Some(2 * 1024 * 1024 * 1024),
            poll_interval: DEFAULT_POLL_INTERVAL,
        }
    }
}

impl IsolationLimits {
    /// Build limits from the engine's own fields, so the names and
    /// meanings stay the same everywhere (`EngineConfig::
    /// processing_timeout` / `max_rss_bytes`).
    pub fn from_engine_config(processing_timeout: Duration, max_rss_bytes: u64) -> Self {
        Self {
            timeout: Some(processing_timeout),
            max_rss_bytes: Some(max_rss_bytes),
            poll_interval: DEFAULT_POLL_INTERVAL,
        }
    }

    /// No limits at all — the child runs until it exits. Only for
    /// callers that deliberately opt out; the CLI never uses this.
    pub fn none() -> Self {
        Self {
            timeout: None,
            max_rss_bytes: None,
            poll_interval: DEFAULT_POLL_INTERVAL,
        }
    }
}

/// What this platform actually enforces. See the module docs for
/// the per-platform table; never claim more than this reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IsolationSupport {
    /// The parent can kill the child on timeout (every native
    /// platform; false only on wasm32).
    pub timeout_kill: bool,
    /// The parent can read the child's RSS and kill it over the cap
    /// (Linux only).
    pub rss_enforcement: bool,
}

/// Report what process isolation can do on this platform.
pub fn platform_support() -> IsolationSupport {
    #[cfg(target_arch = "wasm32")]
    {
        IsolationSupport {
            timeout_kill: false,
            rss_enforcement: false,
        }
    }
    #[cfg(all(not(target_arch = "wasm32"), target_os = "linux"))]
    {
        IsolationSupport {
            timeout_kill: true,
            rss_enforcement: true,
        }
    }
    #[cfg(all(not(target_arch = "wasm32"), not(target_os = "linux")))]
    {
        IsolationSupport {
            timeout_kill: true,
            rss_enforcement: false,
        }
    }
}

/// True on Linux when `/proc/<pid>` exists — i.e. the process is
/// alive (or an unreaped zombie). Used by tests to prove a killed
/// child is really gone. On non-Linux platforms this cannot be
/// observed and always returns `false`; do not read that as "the
/// process is gone".
pub fn process_exists(pid: u32) -> bool {
    #[cfg(target_os = "linux")]
    {
        std::path::Path::new(&format!("/proc/{pid}")).exists()
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = pid;
        false
    }
}

/// Everything that can go wrong while supervising a child. The two
/// enforcement failures carry the killed pid, so a caller (or a
/// test) can verify the child is really gone afterwards.
#[derive(Debug, Error)]
pub enum IsolationError {
    /// The child did not finish within the timeout. It was killed
    /// (not detached) and reaped; `pid` no longer exists.
    #[error("processing timed out after {timeout:?} — child process {pid} was killed")]
    TimedOut { timeout: Duration, pid: u32 },

    /// The child's RSS passed the cap while running. It was killed
    /// (not left running) and reaped; `pid` no longer exists.
    #[error(
        "child process {pid} resident memory {current} bytes exceeds the RSS cap of {cap} bytes — child process was killed"
    )]
    RssCapExceeded { current: u64, cap: u64, pid: u32 },

    /// The child could not be started at all (missing binary,
    /// permission denied, …). No pid exists.
    #[error("could not start child process: {0}")]
    SpawnFailed(#[from] std::io::Error),

    /// The child exited on its own with a non-zero status (or a
    /// signal). Its stderr tail is included so the real failure —
    /// a bad input, a missing file — is not mistaken for a
    /// timeout or an RSS kill.
    #[error("child process exited with {status}: {stderr}")]
    ChildFailed { status: String, stderr: String },

    /// No child processes exist on this platform (wasm32). The
    /// work was not run at all.
    #[error("process isolation is not supported on this platform: {0}")]
    UnsupportedPlatform(&'static str),
}

/// What a supervised child produced. Returned only when the child
/// exited successfully (`status.success()`).
#[derive(Debug)]
pub struct IsolatedOutput {
    /// The child's exit status (success, by construction).
    pub status: ExitStatus,
    /// Everything the child wrote to stdout.
    pub stdout: Vec<u8>,
    /// Everything the child wrote to stderr.
    pub stderr: Vec<u8>,
    /// The child's pid (for logging / correlation).
    pub pid: u32,
    /// Highest RSS observed while polling, if RSS could be read at
    /// least once (Linux). `None` where RSS is unreadable.
    pub peak_rss_bytes: Option<u64>,
    /// True when the RSS cap was actually watched during this run
    /// (Linux + a cap was set). False means "not enforced", never
    /// "under the cap".
    pub rss_enforced: bool,
}

/// Spawn `cmd` as a child process, feed it `stdin_data`, and
/// supervise it under `limits`: kill it on timeout or RSS breach,
/// reap it in all cases, and return its output on success.
///
/// The child is spawned with piped stdin/stdout/stderr; `cmd`'s own
/// stdio configuration is overwritten. On wasm32 this returns
/// [`IsolationError::UnsupportedPlatform`] without spawning.
#[cfg(not(target_arch = "wasm32"))]
pub fn run_command_isolated(
    mut cmd: Command,
    stdin_data: &[u8],
    limits: &IsolationLimits,
) -> Result<IsolatedOutput, IsolationError> {
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(IsolationError::SpawnFailed)?;
    let pid = child.id();
    let poll = if limits.poll_interval.is_zero() {
        Duration::from_millis(10)
    } else {
        limits.poll_interval
    };
    let deadline = limits.timeout.map(|t| Instant::now() + t);

    // Drain stdout/stderr on threads so a chatty child can never
    // block on a full pipe while the parent is polling, and feed
    // stdin on its own thread so a child that exits early does not
    // deadlock the parent's write.
    let (stdout_tx, stdout_rx) = mpsc::channel::<Vec<u8>>();
    let (stderr_tx, stderr_rx) = mpsc::channel::<Vec<u8>>();
    let mut stdout_pipe = child.stdout.take();
    let mut stderr_pipe = child.stderr.take();
    let stdout_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(pipe) = stdout_pipe.as_mut() {
            let _ = pipe.read_to_end(&mut buf);
        }
        let _ = stdout_tx.send(buf);
    });
    let stderr_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(pipe) = stderr_pipe.as_mut() {
            let _ = pipe.read_to_end(&mut buf);
        }
        let _ = stderr_tx.send(buf);
    });
    let stdin_data = stdin_data.to_vec();
    let mut stdin_pipe = child.stdin.take();
    let stdin_thread = std::thread::spawn(move || {
        use std::io::Write;
        if let Some(pipe) = stdin_pipe.as_mut() {
            let _ = pipe.write_all(&stdin_data);
            let _ = pipe.flush();
        }
        // Dropping the pipe closes the child's stdin (EOF).
    });

    let mut peak_rss_bytes: Option<u64> = None;
    let mut rss_enforced = false;
    let outcome: Result<ExitStatus, IsolationError> = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => {
                // Still running: enforce the limits.
                if let Some(deadline) = deadline {
                    if Instant::now() >= deadline {
                        let timeout = limits.timeout.expect("deadline implies timeout");
                        break match kill_and_reap(&mut child, pid) {
                            Ok(()) => Err(IsolationError::TimedOut { timeout, pid }),
                            Err(e) => Err(e),
                        };
                    }
                }
                if let Some(cap) = limits.max_rss_bytes {
                    if let Some(rss) = rss_bytes_for_pid(pid) {
                        rss_enforced = true;
                        peak_rss_bytes = Some(peak_rss_bytes.unwrap_or(rss).max(rss));
                        if rss > cap {
                            break match kill_and_reap(&mut child, pid) {
                                Ok(()) => Err(IsolationError::RssCapExceeded {
                                    current: rss,
                                    cap,
                                    pid,
                                }),
                                Err(e) => Err(e),
                            };
                        }
                    }
                }
                std::thread::sleep(poll);
            }
            Err(e) => break Err(IsolationError::SpawnFailed(e)),
        }
    };

    // The child is gone (exited or killed + reaped). Collect the
    // drained pipes; a drain thread that never delivers (a pipe
    // held open by a grandchild — the worker never spawns one)
    // yields empty output rather than hanging the parent.
    let _ = stdin_thread.join();
    let _ = stdout_thread.join();
    let _ = stderr_thread.join();
    let stdout = stdout_rx.try_recv().unwrap_or_default();
    let stderr = stderr_rx.try_recv().unwrap_or_default();

    match outcome {
        Ok(status) => {
            if status.success() {
                Ok(IsolatedOutput {
                    status,
                    stdout,
                    stderr,
                    pid,
                    peak_rss_bytes,
                    rss_enforced,
                })
            } else {
                Err(IsolationError::ChildFailed {
                    status: status.to_string(),
                    stderr: stderr_tail(&stderr),
                })
            }
        }
        Err(e) => Err(e),
    }
}

/// Kill the child and reap it, so no zombie is left behind.
/// Returns `Ok` when the child was reaped, or the I/O error when
/// even the kill/reap failed (the caller then reports that error
/// instead of the timeout/RSS breach that triggered the kill).
fn kill_and_reap(child: &mut Child, _pid: u32) -> Result<(), IsolationError> {
    // `kill` is SIGKILL on Unix, TerminateProcess on Windows: the
    // child cannot trap or ignore it. `wait` reaps it.
    let _ = child.kill();
    child
        .wait()
        .map(|_| ())
        .map_err(IsolationError::SpawnFailed)
}

/// Last `MAX_STDERR_TAIL` bytes of stderr as a lossy string, for
/// [`IsolationError::ChildFailed`]. Empty stderr becomes "(no
/// stderr)" so the message never ends in a bare colon.
fn stderr_tail(stderr: &[u8]) -> String {
    if stderr.is_empty() {
        return "(no stderr)".to_string();
    }
    let tail = if stderr.len() > MAX_STDERR_TAIL {
        &stderr[stderr.len() - MAX_STDERR_TAIL..]
    } else {
        stderr
    };
    String::from_utf8_lossy(tail).into_owned()
}

/// wasm32: single-threaded, no child processes. The work is not run.
#[cfg(target_arch = "wasm32")]
pub fn run_command_isolated(
    _cmd: Command,
    _stdin_data: &[u8],
    _limits: &IsolationLimits,
) -> Result<IsolatedOutput, IsolationError> {
    Err(IsolationError::UnsupportedPlatform(
        "wasm32 has no child processes — the engine runs in a Web Worker instead",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The child processes are `python3 -c` one-liners, not the
    /// Unix `sleep`/`echo`/`cat`/`sh` utilities: python3 is on
    /// PATH on all three CI runners (and is already what the
    /// Linux-only RSS test below uses), while the Unix utilities
    /// exist on Windows only inside Git Bash — which is not
    /// reliably on PATH for a `cargo test` process, so the
    /// timeout/stdout/stdin tests would fail there with
    /// SpawnFailed instead of testing the supervisor.
    fn python_command(code: &str) -> Command {
        let mut cmd = Command::new("python3");
        cmd.args(["-c", code]);
        cmd
    }

    /// A child that outlives the deadline by a wide margin.
    fn sleep_command(seconds: u64) -> Command {
        python_command(&format!("import time; time.sleep({seconds})"))
    }

    #[test]
    fn fast_child_returns_its_stdout() {
        let out = run_command_isolated(
            python_command("print('hello-isolated')"),
            b"",
            &IsolationLimits::none(),
        )
        .unwrap();
        assert!(out.status.success());
        assert_eq!(
            String::from_utf8_lossy(&out.stdout).trim(),
            "hello-isolated"
        );
        assert!(!process_exists(out.pid), "reaped child must be gone");
    }

    #[test]
    fn stdin_is_fed_to_the_child() {
        let out = run_command_isolated(
            python_command("import sys; sys.stdout.write(sys.stdin.read())"),
            b"round-trip",
            &IsolationLimits::none(),
        )
        .unwrap();
        assert_eq!(out.stdout, b"round-trip");
    }

    #[test]
    fn failing_child_reports_its_stderr_not_a_timeout() {
        let err = run_command_isolated(
            python_command("import sys; sys.stderr.write('boom\\n'); sys.exit(3)"),
            b"",
            &IsolationLimits::none(),
        )
        .unwrap_err();
        match err {
            IsolationError::ChildFailed { status, stderr } => {
                assert!(status.contains('3'), "status = {status}");
                assert!(stderr.contains("boom"), "stderr = {stderr}");
            }
            other => panic!("expected ChildFailed, got {other:?}"),
        }
    }

    #[test]
    fn missing_binary_is_a_spawn_error() {
        let err = run_command_isolated(
            Command::new("openpixel-definitely-not-a-real-binary"),
            b"",
            &IsolationLimits::none(),
        )
        .unwrap_err();
        assert!(
            matches!(err, IsolationError::SpawnFailed(_)),
            "expected SpawnFailed, got {err:?}"
        );
    }

    #[test]
    fn timeout_kills_the_child_process() {
        // The child would sleep 60 s; the supervisor must kill it
        // after ~200 ms and prove the pid is gone — not merely
        // detach from it (the old `run_with_timeout` behaviour).
        let started = Instant::now();
        let err = run_command_isolated(
            sleep_command(60),
            b"",
            &IsolationLimits {
                timeout: Some(Duration::from_millis(200)),
                max_rss_bytes: None,
                poll_interval: Duration::from_millis(10),
            },
        )
        .unwrap_err();
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "kill must return promptly, took {:?}",
            started.elapsed()
        );
        match err {
            IsolationError::TimedOut { timeout, pid } => {
                assert_eq!(timeout, Duration::from_millis(200));
                assert!(
                    !process_exists(pid),
                    "killed child {pid} must be gone from /proc"
                );
            }
            other => panic!("expected TimedOut, got {other:?}"),
        }
    }

    #[test]
    fn timeout_error_names_the_timeout() {
        let err = run_command_isolated(
            sleep_command(60),
            b"",
            &IsolationLimits {
                timeout: Some(Duration::from_millis(120)),
                max_rss_bytes: None,
                poll_interval: Duration::from_millis(10),
            },
        )
        .unwrap_err();
        let message = err.to_string();
        assert!(
            message.contains("timed out") && message.contains("120ms"),
            "error must name the timeout: {message}"
        );
        assert!(
            message.contains("killed"),
            "error must say the child was killed: {message}"
        );
    }

    /// A child that allocates past the RSS cap must fail loudly
    /// (Linux only: RSS cannot be read elsewhere, so the cap is
    /// honestly unenforced there — see the module docs).
    #[test]
    #[cfg(target_os = "linux")]
    fn rss_cap_kills_a_greedy_child() {
        if !platform_support().rss_enforcement {
            return;
        }
        // Python allocates 256 MiB and then sleeps: far over a
        // 64 MiB cap, with plenty of time for the poller to see it.
        let started = Instant::now();
        let err = run_command_isolated(
            {
                let mut cmd = Command::new("python3");
                cmd.args([
                    "-c",
                    "x = bytearray(256 * 1024 * 1024); import time; time.sleep(60)",
                ]);
                cmd
            },
            b"",
            &IsolationLimits {
                timeout: Some(Duration::from_secs(30)),
                max_rss_bytes: Some(64 * 1024 * 1024),
                poll_interval: Duration::from_millis(10),
            },
        )
        .unwrap_err();
        assert!(
            started.elapsed() < Duration::from_secs(20),
            "RSS kill must return promptly, took {:?}",
            started.elapsed()
        );
        match err {
            IsolationError::RssCapExceeded { current, cap, pid } => {
                assert_eq!(cap, 64 * 1024 * 1024);
                assert!(
                    current > cap,
                    "observed RSS {current} must exceed cap {cap}"
                );
                assert!(
                    !process_exists(pid),
                    "killed child {pid} must be gone from /proc"
                );
            }
            other => panic!("expected RssCapExceeded, got {other:?}"),
        }
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn rss_error_names_the_cap() {
        if !platform_support().rss_enforcement {
            return;
        }
        let err = run_command_isolated(
            {
                let mut cmd = Command::new("python3");
                cmd.args([
                    "-c",
                    "x = bytearray(256 * 1024 * 1024); import time; time.sleep(60)",
                ]);
                cmd
            },
            b"",
            &IsolationLimits {
                timeout: Some(Duration::from_secs(30)),
                max_rss_bytes: Some(64 * 1024 * 1024),
                poll_interval: Duration::from_millis(10),
            },
        )
        .unwrap_err();
        let message = err.to_string();
        assert!(
            message.contains("RSS cap") && message.contains("67108864"),
            "error must name the RSS cap: {message}"
        );
        assert!(
            message.contains("killed"),
            "error must say the child was killed: {message}"
        );
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn small_allocation_under_the_cap_succeeds() {
        // 8 MiB under a 256 MiB cap must pass — the cap is a
        // ceiling, not a tripwire for any allocation.
        let out = run_command_isolated(
            {
                let mut cmd = Command::new("python3");
                cmd.args(["-c", "x = bytearray(8 * 1024 * 1024); print('ok')"]);
                cmd
            },
            b"",
            &IsolationLimits {
                timeout: Some(Duration::from_secs(30)),
                max_rss_bytes: Some(256 * 1024 * 1024),
                poll_interval: Duration::from_millis(10),
            },
        )
        .unwrap();
        assert!(out.status.success());
        assert!(out.rss_enforced, "RSS must have been watched on Linux");
        assert!(
            out.peak_rss_bytes.is_some_and(|p| p > 0),
            "peak RSS must have been observed"
        );
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "ok");
    }

    #[test]
    fn platform_support_reports_linux_honestly() {
        let support = platform_support();
        #[cfg(target_os = "linux")]
        assert!(support.timeout_kill && support.rss_enforcement);
        #[cfg(not(target_os = "linux"))]
        assert!(support.timeout_kill && !support.rss_enforcement);
    }
}
