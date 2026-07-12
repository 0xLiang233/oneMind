# OneMind

[English](../README.md)

OneMind 是一个本地优先的桌面工作台，用于快速捕捉想法、组织 Markdown 笔记，并将个人常用工具集中到一个空间中。项目采用共享的 React 渲染层，并以 Tauri 作为主要桌面端外壳。

## 功能介绍

- 基于本地目录的工作区、Markdown 笔记与资源管理
- 支持富文本和源码模式的 Markdown 编辑器
- 随时记录想法的快速记录功能
- 可自由配置的网页应用入口
- 工作区偏好设置与活跃度概览
- 面向多桌面平台设计的渲染层兼容桥接

## 环境要求

运行 OneMind 前需要安装：

- [Node.js](https://nodejs.org/)
- [pnpm 8](https://pnpm.io/installation)
- [Rust](https://www.rust-lang.org/tools/install)
- 当前操作系统对应的 [Tauri 系统依赖](https://v2.tauri.app/zh-cn/start/prerequisites/)

## 安装与运行

克隆仓库并安装 workspace 依赖：

```bash
git clone <repository-url>
cd oneMind
pnpm install
```

以开发模式启动 Tauri 桌面应用：

```bash
pnpm dev:tauri
```

## 构建

构建 Tauri 桌面应用的生产版本：

```bash
pnpm build:tauri
```

仅构建共享的 React 渲染层：

```bash
pnpm build:renderer
```

## 项目结构

```text
renderer/         React 与 Vite 渲染层
desktop/tauri/    主要的 Tauri 桌面端外壳
desktop/electron/ 保留的 Electron 旧版外壳
packages/         共享的应用、领域、存储和工具包
docs/             项目文档与归档资料
```
