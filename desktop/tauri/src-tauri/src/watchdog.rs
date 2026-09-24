//! One outstanding heartbeat, independent of the UI and async worker pools.
//! Diagnostic only: never restart the app or discard a user's unsaved content.
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};
#[derive(Default)]
pub(crate) struct WatchdogState {
    stopped: AtomicBool,
}
impl WatchdogState {
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Relaxed);
    }
}

pub(crate) fn start(app: AppHandle) {
    let _ =
        std::thread::Builder::new()
            .name("onemind-ui-watchdog".into())
            .spawn(move || {
                let stopped = || app.state::<WatchdogState>().stopped.load(Ordering::Relaxed);
                while !stopped() {
                    std::thread::sleep(Duration::from_secs(5));
                    if stopped() {
                        break;
                    }
                    let (reply, received) = mpsc::sync_channel(1);
                    let started = Instant::now();
                    if app
                        .run_on_main_thread(move || {
                            let _ = reply.try_send(());
                        })
                        .is_err()
                    {
                        break;
                    }
                    let mut reported = false;
                    loop {
                        match received.recv_timeout(Duration::from_secs(5)) {
                            Ok(()) => {
                                if reported {
                                    crate::append_global_log(
                                        "warn",
                                        "ui_responsive_again",
                                        Some(&format!(
                                            "blocked_ms={}",
                                            started.elapsed().as_millis()
                                        )),
                                    );
                                }
                                break;
                            }
                            Err(mpsc::RecvTimeoutError::Disconnected) => return,
                            Err(mpsc::RecvTimeoutError::Timeout) => {
                                if stopped() {
                                    return;
                                }
                                if !reported && started.elapsed() >= Duration::from_secs(10) {
                                    reported = true;
                                    crate::append_global_log("error", "ui_unresponsive",
                                Some("main event loop has not acknowledged a heartbeat for 10s"));
                                }
                                // Do not enqueue another callback while this one is outstanding.
                            }
                        }
                    }
                }
            });
}
