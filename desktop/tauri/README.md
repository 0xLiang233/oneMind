# OneMind Tauri Shell

This app is the Tauri desktop shell for the shared OneMind renderer in `../../renderer`.

The current migration goal is to load the same React/Vite UI used by the Electron shell, then gradually replace Electron IPC features with Tauri commands.

## Run

```powershell
pnpm install
pnpm dev:tauri
```

## Build

```powershell
pnpm build:tauri
```

Some product features still depend on the `window.oneMind` bridge implemented by Electron preload. The renderer includes a fallback bridge so the Tauri shell can load without crashing while native commands are migrated.
