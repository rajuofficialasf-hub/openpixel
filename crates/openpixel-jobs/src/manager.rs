use crate::error::{JobError, Result};
use crate::types::{BatchProgress, Job, JobKind, JobResult, JobStatus};
use openpixel_core::{ConvertOptions, Engine, ImageFormat};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

/// The work a worker performs for one job. Returns the output file
/// size in bytes on success, or an error message on failure. The
/// manager measures the duration and builds the [`JobResult`]; the
/// function itself never touches manager state, so a failure here
/// cannot poison the pool — it is recorded and the next job runs.
/// The engine's own limits (`EngineConfig`) are enforced inside the
/// work function (see [`JobManager::for_engine`]).
pub type WorkFn = dyn Fn(&Job) -> std::result::Result<u64, String> + Send + Sync;

/// A handler for one kind of job (Studio Phase 1). The pool is
/// generic over the *mechanics* (queue, workers, pause/resume/
/// cancel/retry); the handler decides what a job of its kind
/// means. Image jobs keep using plain [`WorkFn`] closures;
/// PDF/OCR/document jobs in later phases implement this trait so
/// the pool can route and describe them without knowing their
/// payloads. `run` receives the whole [`Job`] (including `kind`
/// and `params`) and returns the output size in bytes, like `WorkFn`.
pub trait JobHandler: Send + Sync {
    fn kind(&self) -> JobKind;
    fn run(&self, job: &Job) -> std::result::Result<u64, String>;
}

/// Maximum workers the pool will ever run. The default is smaller
/// (see [`default_workers`]); this is the hard clamp on a caller's
/// explicit count, so a typo cannot spawn an unbounded pool.
pub const MAX_WORKERS: usize = 8;

/// Default worker count: the machine's CPUs, capped at 4. On this
/// VM (4 CPUs) that is 4. The cap exists because each worker can
/// hold one full-resolution image in RAM (see the crate docs).
pub fn default_workers() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1)
        .clamp(1, 4)
}

#[derive(Debug, Clone, Copy)]
pub struct JobManagerConfig {
    /// Worker threads. Clamped to 1..=`MAX_WORKERS` by the manager;
    /// 0 is rejected with [`JobError::InvalidWorkerCount`].
    pub workers: usize,
    /// Wall-clock limit for one job, enforced by running the work
    /// on a timeout thread (see `openpixel-security::run_with_timeout`).
    /// `None` means no pool-level timeout — the work runs until it
    /// finishes. `JobManager::for_engine` fills this in from the
    /// engine's `EngineConfig::processing_timeout` when it is `None`,
    /// so engine-backed pools always have a timeout.
    pub processing_timeout: Option<Duration>,
}

impl Default for JobManagerConfig {
    fn default() -> Self {
        Self {
            workers: default_workers(),
            processing_timeout: None,
        }
    }
}

impl JobManagerConfig {
    pub fn with_workers(workers: usize) -> Self {
        Self {
            workers,
            processing_timeout: None,
        }
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.processing_timeout = Some(timeout);
        self
    }
}

struct State {
    jobs: HashMap<u64, Job>,
    /// Ids of queued jobs, in submission order. Paused jobs stay in
    /// this queue (with status `Paused`); workers simply refuse to
    /// pop while `paused` is set.
    queue: VecDeque<u64>,
    results: Vec<JobResult>,
    running: usize,
    paused: bool,
    shutdown: bool,
}

impl State {
    fn new() -> Self {
        Self {
            jobs: HashMap::new(),
            queue: VecDeque::new(),
            results: Vec::new(),
            running: 0,
            paused: false,
            shutdown: false,
        }
    }
}

struct Shared {
    state: Mutex<State>,
    condvar: Condvar,
    /// Pool-level per-job timeout (see `JobManagerConfig`).
    processing_timeout: Option<Duration>,
}

/// Bounded worker pool for batch conversion.
///
/// Workers are spawned in [`JobManager::new`] and joined in
/// [`JobManager::shutdown`] (also called from `Drop`). The pool is
/// usable from any thread: every method takes `&self`.
pub struct JobManager {
    shared: Arc<Shared>,
    workers: usize,
    next_id: AtomicU64,
    handles: Mutex<Vec<std::thread::JoinHandle<()>>>,
}

impl JobManager {
    /// Build a pool running `work` for every job. `config.workers`
    /// must be 1..=`MAX_WORKERS`; 0 (or more than the max) is an
    /// error and no threads are spawned.
    pub fn new(config: JobManagerConfig, work: Arc<WorkFn>) -> Result<Self> {
        if config.workers == 0 || config.workers > MAX_WORKERS {
            return Err(JobError::InvalidWorkerCount(config.workers));
        }
        let shared = Arc::new(Shared {
            state: Mutex::new(State::new()),
            condvar: Condvar::new(),
            processing_timeout: config.processing_timeout,
        });
        let mut handles = Vec::with_capacity(config.workers);
        for _ in 0..config.workers {
            let shared = Arc::clone(&shared);
            let work = Arc::clone(&work);
            handles.push(std::thread::spawn(move || worker_loop(&shared, &work)));
        }
        Ok(Self {
            shared,
            workers: config.workers,
            next_id: AtomicU64::new(1),
            handles: Mutex::new(handles),
        })
    }

    /// Build a pool running `handler` for every job (Studio Phase 1).
    /// The handler's `kind()` describes what it serves; the pool
    /// itself stays kind-agnostic.
    pub fn new_with_handler(
        config: JobManagerConfig,
        handler: Arc<dyn JobHandler>,
    ) -> Result<Self> {
        Self::new(config, Arc::new(move |job: &Job| handler.run(job)))
    }

    /// Build a pool that converts each job through `engine`
    /// (`engine.convert`). The engine's limits are enforced per job
    /// inside the worker: a job over the file-size / pixel /
    /// dimension limits fails with `LimitExceeded` and is recorded
    /// as `Failed` — the pool keeps going. The engine's
    /// `processing_timeout` (default 300 s) bounds each job unless
    /// the caller set `config.processing_timeout` explicitly.
    pub fn for_engine(config: JobManagerConfig, engine: Arc<Engine>) -> Result<Self> {
        let timeout = config
            .processing_timeout
            .unwrap_or(engine.config().processing_timeout);
        let config = JobManagerConfig {
            processing_timeout: Some(timeout),
            ..config
        };
        Self::new(
            config,
            Arc::new(move |job: &Job| {
                engine
                    .convert(&job.input, &job.output, job.target, &job.options)
                    .map(|r| r.output_bytes)
                    .map_err(|e| e.to_string())
            }),
        )
    }

    /// Worker threads in this pool (the concurrency bound).
    pub fn workers(&self) -> usize {
        self.workers
    }

    /// Submit one conversion job. Returns its id.
    pub fn submit(
        &self,
        input: PathBuf,
        output: PathBuf,
        target: ImageFormat,
        options: ConvertOptions,
    ) -> u64 {
        self.submit_job(Job::new(input, output, target, options))
    }

    /// Submit a pre-built job of any kind (Studio Phase 1). The
    /// job's `id` is assigned here and its status is reset to
    /// `Queued`. Returns the id.
    pub fn submit_job(&self, mut job: Job) -> u64 {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        job.id = id;
        job.status = JobStatus::Queued;
        let mut state = self.shared.state.lock().expect("job state lock poisoned");
        state.jobs.insert(id, job);
        state.queue.push_back(id);
        self.shared.condvar.notify_one();
        id
    }

    /// Submit several jobs in order; returns their ids in order.
    pub fn submit_many(
        &self,
        jobs: Vec<(PathBuf, PathBuf, ImageFormat, ConvertOptions)>,
    ) -> Vec<u64> {
        jobs.into_iter()
            .map(|(input, output, target, options)| self.submit(input, output, target, options))
            .collect()
    }

    /// Pause the queue: jobs not yet started do not start (their
    /// status becomes `Paused`). Jobs already running finish
    /// normally — a decode/encode call is never interrupted.
    pub fn pause(&self) {
        let mut state = self.shared.state.lock().expect("job state lock poisoned");
        state.paused = true;
        let queued: Vec<u64> = state.queue.iter().copied().collect();
        for id in queued {
            if let Some(job) = state.jobs.get_mut(&id) {
                if job.status == JobStatus::Queued {
                    job.status = JobStatus::Paused;
                }
            }
        }
        self.shared.condvar.notify_all();
    }

    /// Resume a paused queue: paused jobs go back to `Queued` and
    /// workers pick them up.
    pub fn resume(&self) {
        let mut state = self.shared.state.lock().expect("job state lock poisoned");
        state.paused = false;
        let queued: Vec<u64> = state.queue.iter().copied().collect();
        for id in queued {
            if let Some(job) = state.jobs.get_mut(&id) {
                if job.status == JobStatus::Paused {
                    job.status = JobStatus::Queued;
                }
            }
        }
        self.shared.condvar.notify_all();
    }

    /// Cancel one queued or paused job. Returns `true` when the job
    /// was cancelled. Returns `false` for a running job (it cannot
    /// be interrupted mid-call and runs to completion), and for a
    /// job that is already terminal or unknown.
    pub fn cancel(&self, id: u64) -> bool {
        let mut state = self.shared.state.lock().expect("job state lock poisoned");
        let Some(job) = state.jobs.get_mut(&id) else {
            return false;
        };
        match job.status {
            JobStatus::Queued | JobStatus::Paused => {
                job.status = JobStatus::Cancelled;
                state.queue.retain(|q| *q != id);
                self.shared.condvar.notify_all();
                true
            }
            _ => false,
        }
    }

    /// Cancel every queued / paused job. Returns how many were
    /// cancelled. Running jobs are untouched.
    pub fn cancel_all(&self) -> usize {
        let mut state = self.shared.state.lock().expect("job state lock poisoned");
        let mut cancelled = 0;
        for job in state.jobs.values_mut() {
            if matches!(job.status, JobStatus::Queued | JobStatus::Paused) {
                job.status = JobStatus::Cancelled;
                cancelled += 1;
            }
        }
        state.queue.clear();
        self.shared.condvar.notify_all();
        cancelled
    }

    /// Re-queue every failed job (status back to `Queued`, its old
    /// result dropped). Returns how many jobs were re-queued.
    /// Whether the retry succeeds is up to the work function — a
    /// permanently corrupt file fails again and stays failed.
    pub fn retry_failed(&self) -> usize {
        let mut state = self.shared.state.lock().expect("job state lock poisoned");
        let failed: Vec<u64> = state
            .jobs
            .values()
            .filter(|j| j.status == JobStatus::Failed)
            .map(|j| j.id)
            .collect();
        for id in &failed {
            if let Some(job) = state.jobs.get_mut(id) {
                job.status = JobStatus::Queued;
            }
            state.queue.push_back(*id);
        }
        state.results.retain(|r| !failed.contains(&r.job_id));
        self.shared.condvar.notify_all();
        failed.len()
    }

    /// Snapshot of one job, or `None` for an unknown id.
    pub fn job(&self, id: u64) -> Option<Job> {
        let state = self.shared.state.lock().expect("job state lock poisoned");
        state.jobs.get(&id).cloned()
    }

    /// Snapshot of every job, in submission (id) order.
    pub fn jobs(&self) -> Vec<Job> {
        let state = self.shared.state.lock().expect("job state lock poisoned");
        let mut jobs: Vec<Job> = state.jobs.values().cloned().collect();
        jobs.sort_by_key(|j| j.id);
        jobs
    }

    /// Counts by status for the whole batch.
    pub fn progress(&self) -> BatchProgress {
        let state = self.shared.state.lock().expect("job state lock poisoned");
        let mut p = BatchProgress {
            total: state.jobs.len(),
            ..Default::default()
        };
        for job in state.jobs.values() {
            match job.status {
                JobStatus::Queued => p.queued += 1,
                JobStatus::Running => p.running += 1,
                JobStatus::Done => p.done += 1,
                JobStatus::Failed => p.failed += 1,
                JobStatus::Cancelled => p.cancelled += 1,
                JobStatus::Paused => p.paused += 1,
            }
        }
        p
    }

    /// Results of every job that has run, in completion order.
    /// Cancelled jobs (never started) have no result.
    pub fn results(&self) -> Vec<JobResult> {
        let state = self.shared.state.lock().expect("job state lock poisoned");
        state.results.clone()
    }

    /// Block until every submitted job is terminal (`Done`,
    /// `Failed` or `Cancelled`). Paused jobs are not terminal: call
    /// `resume()` first, or use [`JobManager::wait_timeout`].
    /// With no jobs submitted this returns immediately.
    pub fn wait_all(&self) {
        let mut state = self.shared.state.lock().expect("job state lock poisoned");
        while !all_terminal(&state) {
            state = self
                .shared
                .condvar
                .wait(state)
                .expect("job condvar wait failed");
        }
    }

    /// Like [`JobManager::wait_all`], but gives up after `timeout`.
    /// Returns `true` when every job reached a terminal state.
    pub fn wait_timeout(&self, timeout: Duration) -> bool {
        let state = self.shared.state.lock().expect("job state lock poisoned");
        let (state, _) = self
            .shared
            .condvar
            .wait_timeout_while(state, timeout, |s| !all_terminal(s))
            .expect("job condvar wait failed");
        all_terminal(&state)
    }

    /// Stop the workers and join them. Idempotent. Called
    /// automatically from `Drop`; call it explicitly when the pool
    /// must be gone before the end of its scope. Jobs still queued
    /// are left `Queued`/`Paused` — they are not run.
    pub fn shutdown(&self) {
        {
            let mut state = self.shared.state.lock().expect("job state lock poisoned");
            if state.shutdown {
                return;
            }
            state.shutdown = true;
            self.shared.condvar.notify_all();
        }
        let handles = self
            .handles
            .lock()
            .expect("job handles lock poisoned")
            .drain(..)
            .collect::<Vec<_>>();
        for handle in handles {
            let _ = handle.join();
        }
    }
}

impl Drop for JobManager {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn all_terminal(state: &State) -> bool {
    state.jobs.values().all(|j| j.status.is_terminal())
}

/// One worker thread: wait for a queued job (or shutdown), run it
/// outside the lock, record the result, repeat. A panic or error in
/// the work function is contained here — `work` returns a
/// `Result`, so a failed job is a recorded `Failed`, never a dead
/// worker.
fn worker_loop(shared: &Arc<Shared>, work: &Arc<WorkFn>) {
    loop {
        let job = {
            let mut state = shared.state.lock().expect("job state lock poisoned");
            loop {
                if state.shutdown {
                    return;
                }
                if state.paused {
                    state = shared.condvar.wait(state).expect("job condvar wait failed");
                    continue;
                }
                let Some(id) = state.queue.pop_front() else {
                    state = shared.condvar.wait(state).expect("job condvar wait failed");
                    continue;
                };
                let Some(job) = state.jobs.get_mut(&id) else {
                    continue;
                };
                if job.status == JobStatus::Cancelled {
                    continue;
                }
                job.status = JobStatus::Running;
                let owned = job.clone();
                state.running += 1;
                shared.condvar.notify_all();
                break owned;
            }
        };
        let started = Instant::now();
        // Pool-level timeout (Studio Phase 1, risk A8): when set,
        // the work runs on a timeout thread and a job that overruns
        // it fails with a timeout message instead of hanging the
        // pool. The worker thread is detached on timeout (see
        // `openpixel-security::run_with_timeout`) — the job is
        // recorded Failed and the pool carries on.
        let outcome = match shared.processing_timeout {
            Some(timeout) => {
                let work = Arc::clone(work);
                // The closure owns its copy: `job` itself is still
                // needed below for the result record.
                let job_for_work = job.clone();
                match openpixel_security::run_with_timeout(timeout, move || work(&job_for_work)) {
                    Ok(result) => result,
                    Err(openpixel_security::TimeoutError::TimedOut(d)) => Err(format!(
                        "processing timed out after {}s (limit {}s)",
                        d.as_secs(),
                        timeout.as_secs()
                    )),
                    Err(openpixel_security::TimeoutError::WorkerPanicked) => {
                        Err("processing worker panicked".to_string())
                    }
                }
            }
            None => work(&job),
        };
        let duration_ms = started.elapsed().as_millis() as u64;
        let mut state = shared.state.lock().expect("job state lock poisoned");
        state.running = state.running.saturating_sub(1);
        let (status, bytes, error) = match outcome {
            Ok(bytes) => (JobStatus::Done, bytes, None),
            Err(message) => (JobStatus::Failed, 0, Some(message)),
        };
        if let Some(record) = state.jobs.get_mut(&job.id) {
            record.status = status;
        }
        state.results.push(JobResult {
            job_id: job.id,
            input: job.input.clone(),
            output: job.output.clone(),
            bytes,
            duration_ms,
            error,
            status,
        });
        shared.condvar.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize};
    use std::sync::Barrier;

    fn test_job(input: &str) -> (PathBuf, PathBuf, ImageFormat, ConvertOptions) {
        (
            PathBuf::from(input),
            PathBuf::from(format!("/tmp/out-{input}")),
            ImageFormat::Png,
            ConvertOptions::default(),
        )
    }

    fn wait_for_status(manager: &JobManager, id: u64, want: JobStatus) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            if manager.job(id).map(|j| j.status) == Some(want) {
                return;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        panic!(
            "job {id} never reached {want:?} (is {:?})",
            manager.job(id).map(|j| j.status)
        );
    }

    #[test]
    fn default_workers_is_capped_at_four() {
        let workers = default_workers();
        assert!((1..=4).contains(&workers), "default workers = {workers}");
    }

    #[test]
    fn rejects_zero_and_excessive_worker_counts() {
        let work: Arc<WorkFn> = Arc::new(|_| Ok(0));
        assert!(matches!(
            JobManager::new(JobManagerConfig::with_workers(0), Arc::clone(&work)),
            Err(JobError::InvalidWorkerCount(0))
        ));
        assert!(matches!(
            JobManager::new(JobManagerConfig::with_workers(MAX_WORKERS + 1), work),
            Err(JobError::InvalidWorkerCount(_))
        ));
    }

    #[test]
    fn bounded_concurrency_never_exceeds_workers() {
        let current = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let current2 = Arc::clone(&current);
        let peak2 = Arc::clone(&peak);
        let work: Arc<WorkFn> = Arc::new(move |_| {
            let now = current2.fetch_add(1, Ordering::SeqCst) + 1;
            peak2.fetch_max(now, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(100));
            current2.fetch_sub(1, Ordering::SeqCst);
            Ok(42)
        });
        // 10 jobs, 2 workers: the peak must never pass 2, and all 10
        // must still complete.
        let manager = JobManager::new(JobManagerConfig::with_workers(2), work).unwrap();
        for i in 0..10 {
            let (input, output, target, options) = test_job(&format!("img{i}.png"));
            manager.submit(input, output, target, options);
        }
        manager.wait_all();
        assert_eq!(peak.load(Ordering::SeqCst), 2, "both workers were used");
        assert_eq!(manager.progress().done, 10);
        assert_eq!(manager.results().len(), 10);
        assert!(manager.results().iter().all(|r| r.bytes == 42));
    }

    #[test]
    fn failing_job_does_not_abort_the_batch() {
        let work: Arc<WorkFn> = Arc::new(|job: &Job| {
            if job.input.to_string_lossy().contains("bad") {
                Err("decode failed: not an image".to_string())
            } else {
                Ok(7)
            }
        });
        let manager = JobManager::new(JobManagerConfig::with_workers(2), work).unwrap();
        for name in ["a.png", "bad.png", "b.png", "c.png", "bad2.png"] {
            let (input, output, target, options) = test_job(name);
            manager.submit(input, output, target, options);
        }
        manager.wait_all();
        let progress = manager.progress();
        assert_eq!((progress.done, progress.failed), (3, 2));
        let failures: Vec<_> = manager
            .results()
            .into_iter()
            .filter(|r| r.status == JobStatus::Failed)
            .collect();
        assert_eq!(failures.len(), 2);
        assert!(failures
            .iter()
            .all(|r| r.error.as_deref() == Some("decode failed: not an image")));
        assert!(failures.iter().all(|r| r.bytes == 0));
    }

    #[test]
    fn pause_prevents_queued_jobs_starting_and_resume_restarts_them() {
        let started = Arc::new(AtomicUsize::new(0));
        let started2 = Arc::clone(&started);
        let work: Arc<WorkFn> = Arc::new(move |_| {
            started2.fetch_add(1, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(200));
            Ok(1)
        });
        let manager = JobManager::new(JobManagerConfig::with_workers(1), work).unwrap();
        let (i1, o1, t1, c1) = test_job("first.png");
        let first = manager.submit(i1, o1, t1, c1);
        let (i2, o2, t2, c2) = test_job("second.png");
        let second = manager.submit(i2, o2, t2, c2);
        wait_for_status(&manager, first, JobStatus::Running);
        manager.pause();
        // The running job finishes; the queued one must not start
        // while paused, however long we wait.
        std::thread::sleep(Duration::from_millis(400));
        assert_eq!(manager.job(first).unwrap().status, JobStatus::Done);
        assert_eq!(manager.job(second).unwrap().status, JobStatus::Paused);
        assert_eq!(started.load(Ordering::SeqCst), 1);
        assert_eq!(manager.progress().paused, 1);
        manager.resume();
        manager.wait_all();
        assert_eq!(manager.job(second).unwrap().status, JobStatus::Done);
        assert_eq!(started.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn cancel_queued_job_but_not_a_running_one() {
        let started = Arc::new(AtomicUsize::new(0));
        let started2 = Arc::clone(&started);
        let work: Arc<WorkFn> = Arc::new(move |_| {
            started2.fetch_add(1, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(200));
            Ok(1)
        });
        let manager = JobManager::new(JobManagerConfig::with_workers(1), work).unwrap();
        let (i1, o1, t1, c1) = test_job("first.png");
        let first = manager.submit(i1, o1, t1, c1);
        let (i2, o2, t2, c2) = test_job("second.png");
        let second = manager.submit(i2, o2, t2, c2);
        wait_for_status(&manager, first, JobStatus::Running);
        assert!(manager.cancel(second), "queued job cancels");
        assert_eq!(manager.job(second).unwrap().status, JobStatus::Cancelled);
        assert!(
            !manager.cancel(first),
            "running job cannot be cancelled mid-call"
        );
        assert!(!manager.cancel(999_999), "unknown job cannot be cancelled");
        manager.wait_all();
        assert_eq!(manager.job(first).unwrap().status, JobStatus::Done);
        assert_eq!(manager.progress().cancelled, 1);
        assert_eq!(started.load(Ordering::SeqCst), 1, "cancelled job never ran");
        assert!(manager.results().iter().all(|r| r.job_id == first));
    }

    #[test]
    fn cancel_all_cancels_only_queued_jobs() {
        let gate = Arc::new(Barrier::new(2));
        let gate2 = Arc::clone(&gate);
        let work: Arc<WorkFn> = Arc::new(move |_| {
            gate2.wait();
            Ok(1)
        });
        let manager = JobManager::new(JobManagerConfig::with_workers(1), work).unwrap();
        let mut ids = Vec::new();
        for name in ["a.png", "b.png", "c.png"] {
            let (input, output, target, options) = test_job(name);
            ids.push(manager.submit(input, output, target, options));
        }
        wait_for_status(&manager, ids[0], JobStatus::Running);
        assert_eq!(manager.cancel_all(), 2);
        // Release the running job; the cancelled ones never run.
        gate.wait();
        manager.wait_all();
        assert_eq!(manager.progress().done, 1);
        assert_eq!(manager.progress().cancelled, 2);
    }

    #[test]
    fn retry_failed_requeues_and_a_second_attempt_can_succeed() {
        let attempts = Arc::new(AtomicUsize::new(0));
        let attempts2 = Arc::clone(&attempts);
        let fail_first = Arc::new(AtomicBool::new(true));
        let fail_first2 = Arc::clone(&fail_first);
        let work: Arc<WorkFn> = Arc::new(move |_| {
            attempts2.fetch_add(1, Ordering::SeqCst);
            if fail_first2.swap(false, Ordering::SeqCst) {
                Err("transient failure".to_string())
            } else {
                Ok(9)
            }
        });
        let manager = JobManager::new(JobManagerConfig::with_workers(1), work).unwrap();
        let (input, output, target, options) = test_job("flaky.png");
        manager.submit(input, output, target, options);
        manager.wait_all();
        assert_eq!(manager.progress().failed, 1);
        assert_eq!(manager.retry_failed(), 1);
        manager.wait_all();
        assert_eq!(manager.progress().done, 1);
        assert_eq!(manager.progress().failed, 0);
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
        assert_eq!(manager.results().len(), 1, "old failed result is replaced");
        assert_eq!(manager.results()[0].status, JobStatus::Done);
    }

    #[test]
    fn retry_failed_on_a_clean_batch_requeues_nothing() {
        let work: Arc<WorkFn> = Arc::new(|_| Ok(1));
        let manager = JobManager::new(JobManagerConfig::with_workers(1), work).unwrap();
        let (input, output, target, options) = test_job("ok.png");
        manager.submit(input, output, target, options);
        manager.wait_all();
        assert_eq!(manager.retry_failed(), 0);
    }

    #[test]
    fn progress_counts_and_per_job_status_are_visible() {
        let work: Arc<WorkFn> = Arc::new(|_| {
            std::thread::sleep(Duration::from_millis(50));
            Ok(3)
        });
        let manager = JobManager::new(JobManagerConfig::with_workers(2), work).unwrap();
        let mut ids = Vec::new();
        for name in ["a.png", "b.png", "c.png"] {
            let (input, output, target, options) = test_job(name);
            ids.push(manager.submit(input, output, target, options));
        }
        assert_eq!(manager.progress().total, 3);
        assert_eq!(manager.jobs().len(), 3);
        assert_eq!(manager.jobs().iter().map(|j| j.id).collect::<Vec<_>>(), ids);
        manager.wait_all();
        let progress = manager.progress();
        assert_eq!((progress.done, progress.completed()), (3, 3));
        assert!(manager.results().iter().all(|r| r.duration_ms < 10_000));
    }

    #[test]
    fn wait_timeout_gives_up_on_a_paused_queue() {
        let work: Arc<WorkFn> = Arc::new(|_| {
            std::thread::sleep(Duration::from_millis(300));
            Ok(1)
        });
        let manager = JobManager::new(JobManagerConfig::with_workers(1), work).unwrap();
        let (i1, o1, t1, c1) = test_job("first.png");
        let first = manager.submit(i1, o1, t1, c1);
        let (i2, o2, t2, c2) = test_job("second.png");
        manager.submit(i2, o2, t2, c2);
        wait_for_status(&manager, first, JobStatus::Running);
        manager.pause();
        assert!(!manager.wait_timeout(Duration::from_millis(100)));
        manager.resume();
        assert!(manager.wait_timeout(Duration::from_secs(10)));
    }

    // Studio Phase 1 — generalisation: a handler serves a non-image
    // job through the same pool, and a slow job times out instead
    // of hanging the pool.

    struct PdfHandler;

    impl JobHandler for PdfHandler {
        fn kind(&self) -> JobKind {
            JobKind::Pdf
        }

        fn run(&self, job: &Job) -> std::result::Result<u64, String> {
            assert_eq!(job.kind, JobKind::Pdf);
            assert_eq!(job.params["operation"], "merge");
            Ok(1234)
        }
    }

    #[test]
    fn handler_trait_serves_a_non_image_job() {
        let manager =
            JobManager::new_with_handler(JobManagerConfig::with_workers(1), Arc::new(PdfHandler))
                .unwrap();
        let (input, output, target, options) = test_job("doc.pdf");
        let job = Job::new(input, output, target, options)
            .with_kind(JobKind::Pdf, serde_json::json!({"operation": "merge"}));
        let id = manager.submit_job(job);
        manager.wait_all();
        assert_eq!(manager.job(id).unwrap().status, JobStatus::Done);
        assert_eq!(manager.results()[0].bytes, 1234);
        assert_eq!(manager.job(id).unwrap().kind, JobKind::Pdf);
    }

    #[test]
    fn pool_timeout_fails_a_slow_job_without_killing_the_pool() {
        let work: Arc<WorkFn> = Arc::new(|job: &Job| {
            if job.input.to_string_lossy().contains("slow") {
                std::thread::sleep(Duration::from_secs(5));
            }
            Ok(1)
        });
        let config = JobManagerConfig::with_workers(1).with_timeout(Duration::from_millis(150));
        let manager = JobManager::new(config, work).unwrap();
        let (i1, o1, t1, c1) = test_job("slow.png");
        let slow = manager.submit(i1, o1, t1, c1);
        let (i2, o2, t2, c2) = test_job("fast.png");
        let fast = manager.submit(i2, o2, t2, c2);
        manager.wait_all();
        assert_eq!(manager.job(slow).unwrap().status, JobStatus::Failed);
        assert!(
            manager.results()[0]
                .error
                .as_deref()
                .unwrap_or("")
                .contains("timed out"),
            "failure must say timed out: {:?}",
            manager.results()[0].error
        );
        assert_eq!(manager.job(fast).unwrap().status, JobStatus::Done);
        assert_eq!(manager.progress().done, 1);
    }

    #[test]
    fn job_kind_and_params_round_trip_and_old_json_still_parses() {
        let (input, output, target, options) = test_job("doc.pdf");
        let job = Job::new(input, output, target, options)
            .with_kind(JobKind::Pdf, serde_json::json!({"operation": "split"}));
        let json = serde_json::to_string(&job).unwrap();
        let back: Job = serde_json::from_str(&json).unwrap();
        assert_eq!(back.kind, JobKind::Pdf);
        assert_eq!(back.params["operation"], "split");
        // Job JSON written before Phase 1 (no kind/params fields)
        // still parses, defaulting to an image job.
        let old = r#"{"id":1,"input":"a.png","output":"b.webp","target":"webp","options":{"quality":null,"png_compression":null,"background":[255,255,255],"preserve_metadata":false,"metadata_policy":null,"selected_frame":null,"convert_to_srgb":false},"status":"Queued"}"#;
        let old_job: Job = serde_json::from_str(old).unwrap();
        assert_eq!(old_job.kind, JobKind::Image);
        assert!(old_job.params.is_null());
    }
}
