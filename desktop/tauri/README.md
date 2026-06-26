# OneMind Tauri Probe

Minimal Tauri app used to answer one question:

`Can this machine launch a Tauri window, render the frontend, and write logs?`

## What it does

- opens a minimal Tauri window
- shows a runtime report from Rust
- writes probe logs to the app data directory
- captures frontend startup errors and unhandled rejections

## Run

```powershell
pnpm install
pnpm tauri dev
```

## Expected result

If the app opens and shows the probe report, Tauri itself is viable on this machine.

If it opens as a white screen or crashes, inspect the log file path shown in the UI.
