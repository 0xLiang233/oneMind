//! Run potentially blocking native work away from both the UI and async workers.
use std::{
    sync::Arc,
    time::{Duration, Instant},
};

#[derive(Clone, Default)]
pub(crate) struct SerialExecutor(Arc<tokio::sync::Mutex<()>>);

impl SerialExecutor {
    pub async fn run<T: Send + 'static>(
        &self,
        name: &'static str,
        task: impl FnOnce() -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        let guard = self.0.clone().lock_owned().await;
        run_blocking(name, move || {
            // The guard stays with the work even if its caller stops waiting.
            let _guard = guard;
            task()
        })
        .await
    }
}

pub(crate) async fn run_storage<T: Send + 'static>(
    name: &'static str,
    task: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    static STORAGE: std::sync::OnceLock<SerialExecutor> = std::sync::OnceLock::new();
    STORAGE
        .get_or_init(SerialExecutor::default)
        .run(name, task)
        .await
}

pub(crate) async fn run_blocking<T: Send + 'static>(
    name: &'static str,
    task: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let result = task();
        if started.elapsed() >= Duration::from_secs(2) {
            crate::append_global_log(
                "warn",
                "slow_native_operation",
                Some(&format!(
                    "operation={name} elapsed_ms={}",
                    started.elapsed().as_millis()
                )),
            );
        }
        if let Err(error) = &result {
            crate::append_global_log("error", name, Some(error));
        }
        result
    })
    .await
    .map_err(|error| format!("{name} worker failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn concurrent_operations_never_overlap_and_errors_do_not_poison_the_lane() {
        tauri::async_runtime::block_on(async {
            let lane = SerialExecutor::default();
            let active = Arc::new(AtomicUsize::new(0));
            let mut jobs = Vec::new();
            for n in 0..32 {
                let lane = lane.clone();
                let active = active.clone();
                jobs.push(tauri::async_runtime::spawn(async move {
                    lane.run("test_serial", move || {
                        assert_eq!(active.fetch_add(1, Ordering::SeqCst), 0);
                        std::thread::sleep(Duration::from_millis(2));
                        assert_eq!(active.fetch_sub(1, Ordering::SeqCst), 1);
                        if n == 10 {
                            Err("expected failure".into())
                        } else {
                            Ok(n)
                        }
                    })
                    .await
                }));
            }
            let mut failures = 0;
            for job in jobs {
                if job.await.unwrap().is_err() {
                    failures += 1;
                }
            }
            assert_eq!(failures, 1);
            assert_eq!(lane.run("test_after_failure", || Ok(42)).await.unwrap(), 42);
        });
    }

    #[test]
    fn cancelling_the_caller_does_not_release_running_native_work() {
        tauri::async_runtime::block_on(async {
            let lane = SerialExecutor::default();
            let (started_tx, started_rx) = tokio::sync::oneshot::channel();
            let (release_tx, release_rx) = std::sync::mpsc::channel();
            let first_lane = lane.clone();
            let first = tauri::async_runtime::spawn(async move {
                first_lane
                    .run("test_cancelled_caller", move || {
                        let _ = started_tx.send(());
                        release_rx
                            .recv_timeout(Duration::from_secs(5))
                            .map_err(|e| e.to_string())
                    })
                    .await
            });
            tokio::time::timeout(Duration::from_secs(2), started_rx)
                .await
                .unwrap()
                .unwrap();
            first.abort();
            assert!(first.await.is_err());

            let (entered_tx, mut entered_rx) = tokio::sync::oneshot::channel();
            let next = tauri::async_runtime::spawn(async move {
                lane.run("test_after_cancel", move || {
                    let _ = entered_tx.send(());
                    Ok(42)
                })
                .await
            });
            assert!(
                tokio::time::timeout(Duration::from_millis(50), &mut entered_rx)
                    .await
                    .is_err()
            );
            release_tx.send(()).unwrap();
            assert_eq!(
                tokio::time::timeout(Duration::from_secs(2), next)
                    .await
                    .unwrap()
                    .unwrap()
                    .unwrap(),
                42
            );
        });
    }
}
