# Repository Guidelines

## Project Structure & Module Organization

This is a pnpm workspace. The React/Vite renderer lives in `renderer`; it owns pages, routes, styles, editor UI, and browser-side state. The current primary desktop shell is Tauri in `desktop/tauri`; active desktop work and future iterations should target Tauri first. Renderer build output goes to `renderer/dist`.

`desktop/electron` is currently retained as a secondary/legacy shell. Do not prioritize Electron-specific work unless explicitly requested, but keep the renderer compatibility layer healthy so the app can continue to switch desktop platforms later. Electron main/preload build output goes to `desktop/electron/dist-electron`. Shared workspace packages are under `packages/application`, `packages/domain`, `packages/shared`, and `packages/storage`. Product references and archived notes are in `docs`.

## Build, Test, and Development Commands

- `pnpm install`: install workspace dependencies.
- `pnpm dev:tauri`: run the primary Tauri desktop shell during active development.
- `pnpm build:renderer`: build the shared React/Vite renderer.
- `pnpm build:tauri`: build the Tauri desktop shell.
- `pnpm --dir renderer lint`: run ESLint for the renderer.
- `pnpm --dir renderer preview`: preview the Vite production build.
- `pnpm dev:electron` or `pnpm dev:desktop`: run the legacy Electron shell only when Electron-specific validation is requested.
- `pnpm build:electron` or `pnpm build:desktop`: build the renderer, Electron main process, and preload scripts for legacy Electron validation.
- `pnpm --dir desktop/electron lint`: run ESLint for the Electron app when touching Electron code.

## Coding Style & Naming Conventions

Use TypeScript and React function components in `renderer`. Keep components and views in PascalCase files such as `SettingsPage.tsx`; use camelCase for functions, local variables, and IPC method wrappers. Follow the existing CSS class style: descriptive kebab-case names such as `settings-miniapp-item` and `source-native-view-placeholder`.

Prefer existing renderer bridge patterns before adding new platform APIs. Tauri-facing integrations should live behind the shared `window.oneMind` compatibility surface or adjacent platform adapters, so renderer code remains portable. Keep Electron IPC/preload compatibility in mind, but do not add Electron-specific abstractions for Tauri-only work unless they are needed to preserve the platform boundary. Keep changes scoped to the relevant app/package.

## Testing Guidelines

There is no dedicated test suite configured yet. For now, verify changes with `pnpm build:tauri` for Tauri work and, when practical, `pnpm --dir renderer lint`. For UI changes, run `pnpm dev:tauri` and check the actual Tauri window because browser-only previews cannot cover desktop shell behavior.

Run Electron validation only when the change touches Electron code, the compatibility layer, or the user explicitly asks for it. In those cases, use `pnpm build:desktop`, `pnpm dev:desktop`, and `pnpm --dir desktop/electron lint` as appropriate.

## Agent-Specific Instructions

When an agent completes any task that changes code, prefer Tauri verification: rebuild with `pnpm build:tauri` and restart the Tauri process before final verification when a desktop runtime is involved. Do not restart or otherwise manage Electron unless the task explicitly targets Electron.

Continue improving the platform compatibility layer as code evolves. Renderer features should be written against stable bridge contracts rather than directly coupling to Tauri internals, so later platform switching remains practical.

## Commit & Pull Request Guidelines

This checkout does not expose Git history, so no project-specific commit convention can be inferred. Use concise imperative commit messages, for example `Add settings persistence` or `Fix miniapp tab hit area`.

Pull requests should include a short summary, verification commands run, screenshots or screen recordings for UI changes, and notes for any Tauri shell or compatibility-layer changes. If Electron main/preload files are touched, call that out separately because Electron validation is no longer the default path.

## Security & Configuration Tips

Do not expose privileged desktop APIs directly to remote web content. Keep remote pages isolated through the active shell's platform boundary and expose only narrow bridge APIs to the renderer. Workspace data is persisted under the selected workspace, including `.onemind/preferences.json` and `sources/miniapps.json`.
