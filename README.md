# OneMind

[简体中文](docs/README.zh-CN.md)

OneMind is a local-first desktop workspace for capturing ideas, organizing Markdown notes, and bringing personal tools together in one place. It uses a shared React renderer with Tauri as the primary desktop shell.

## Features

- Local workspace with Markdown notes and assets
- Rich-text and source-mode Markdown editing
- Quick capture for saving ideas without interrupting your workflow
- Configurable web app shortcuts
- Workspace preferences and activity overview
- Portable renderer bridge designed for multiple desktop platforms

## Requirements

Before running OneMind, install:

- [Node.js](https://nodejs.org/)
- [pnpm 8](https://pnpm.io/installation)
- [Rust](https://www.rust-lang.org/tools/install)
- The [Tauri system prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system

## Install and Run

Clone the repository and install the workspace dependencies:

```bash
git clone <repository-url>
cd oneMind
pnpm install
```

Start the Tauri desktop app in development mode:

```bash
pnpm dev:tauri
```

## Build

Create a production build of the Tauri desktop app:

```bash
pnpm build:tauri
```

To build only the shared React renderer:

```bash
pnpm build:renderer
```

## Project Structure

```text
renderer/        React and Vite renderer
desktop/tauri/   Primary Tauri desktop shell
desktop/electron/ Legacy Electron shell
packages/        Shared application, domain, storage, and utility packages
docs/            Documentation and archived project notes
```

