# Repository Guidelines

## Project Structure & Module Organization

This is a pnpm workspace. The current Electron desktop shell lives in `desktop/electron`, an Electron + React + Vite desktop app. Renderer code is currently in `desktop/electron/src`, Electron main/preload code is in `desktop/electron/electron`, static assets are in `desktop/electron/public`, and built output goes to `desktop/electron/dist` and `desktop/electron/dist-electron`.

`desktop/tauri` is the Tauri experiment/probe app and may become the primary desktop shell after validation. Shared workspace packages are under `packages/application`, `packages/domain`, `packages/shared`, and `packages/storage`. Product references and archived notes are in `docs`.

## Build, Test, and Development Commands

- `pnpm install`: install workspace dependencies.
- `pnpm dev:electron` or `pnpm dev:desktop`: run the Electron desktop app with Vite and Electron together.
- `pnpm build:electron` or `pnpm build:desktop`: build the Electron renderer, main process, and preload scripts.
- `pnpm --dir desktop/electron lint`: run ESLint for the Electron app.
- `pnpm --dir desktop/electron preview`: preview the Vite production build.
- `pnpm dev:tauri`: run the Tauri probe when working on that shell.

## Coding Style & Naming Conventions

Use TypeScript and React function components. Keep components and views in PascalCase files such as `SettingsPage.tsx`; use camelCase for functions, local variables, and IPC method wrappers. Follow the existing CSS class style: descriptive kebab-case names such as `settings-miniapp-item` and `source-native-view-placeholder`.

Prefer existing helpers and IPC patterns in `electron/main.ts` and `electron/preload.cts` before adding new abstractions. Keep changes scoped to the relevant app/package.

## Testing Guidelines

There is no dedicated test suite configured yet. For now, verify changes with `pnpm build:desktop` and, when practical, `pnpm --dir desktop/electron lint`. For UI changes, run `pnpm dev:desktop` and check the actual Electron window, especially native `WebContentsView` behavior that browser-only previews cannot cover.

## Agent-Specific Instructions

When an agent completes any task that changes code, rebuild with `pnpm build:desktop` and restart the Electron process before final verification. Main process, preload, and native `WebContentsView` changes do not fully apply until Electron is restarted.

## Commit & Pull Request Guidelines

This checkout does not expose Git history, so no project-specific commit convention can be inferred. Use concise imperative commit messages, for example `Add settings persistence` or `Fix miniapp tab hit area`.

Pull requests should include a short summary, verification commands run, screenshots or screen recordings for UI changes, and notes for any Electron main/preload changes because they require restarting the dev process.

## Security & Configuration Tips

Do not enable Node integration in remote web content. Keep remote pages isolated through `WebContentsView` preferences and preload-exposed IPC only. Workspace data is persisted under the selected workspace, including `.onemind/preferences.json` and `sources/miniapps.json`.
