use std::{
    env,
    fs::OpenOptions,
    io::Write,
    panic,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

fn now_iso_like() -> String {
    let since_epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{since_epoch}")
}

fn main_log_path() -> PathBuf {
    env::temp_dir().join("onemind-tauri-probe-main.log")
}

fn append_main_log(message: &str) {
    let path = main_log_path();
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(
            file,
            "{{\"timestamp\":\"{}\",\"message\":\"{}\"}}",
            now_iso_like(),
            message.replace('"', "'")
        );
        let _ = file.flush();
    }
}

fn main() {
    append_main_log("main_entered");
    panic::set_hook(Box::new(|info| {
        let path = main_log_path();
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(
                file,
                "{{\"timestamp\":\"{}\",\"message\":\"panic\",\"context\":\"{}\"}}",
                now_iso_like(),
                format!("{info}").replace('"', "'")
            );
            let _ = file.flush();
        }
    }));
    append_main_log("before_run");
    onemind_tauri_probe_lib::run()
}
