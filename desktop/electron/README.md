# OneMind Desktop

Electron desktop shell for OneMind. The shared React/Vite renderer lives in `../../renderer`.

## Current scope

- Electron desktop shell
- Electron main/preload process
- Native window and IPC integration
- Packaged loading of `renderer/dist`
- Workspace / vault folder selection
- Local workspace initialization:
  - `notes/`
  - `assets/`
  - `inbox/`
  - `sources/`
  - `.onemind/`

## Run

From repo root:

```powershell
pnpm install
pnpm dev:electron
```

Or inside this app:

```powershell
pnpm install
pnpm dev
```

## Build

```powershell
pnpm build:electron
```

## Notes

- No backend
- No agent runtime
- No plugin host
- Workspace path is first-class
