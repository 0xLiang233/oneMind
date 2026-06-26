# OneMind Desktop

Minimum usable Electron + React skeleton for OneMind.

## Current scope

- Electron desktop shell
- React route-driven workbench
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
pnpm dev:desktop
```

Or inside this app:

```powershell
pnpm install
pnpm dev
```

## Build

```powershell
pnpm build:desktop
```

## Notes

- No backend
- No agent runtime
- No plugin host
- Workspace path is first-class
