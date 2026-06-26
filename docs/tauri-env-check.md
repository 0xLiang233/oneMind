# Tauri 环境检测

这个检测器先解决一个问题：`你的工作电脑是否具备运行 Tauri 应用的基础环境`。

它不会编译或启动 Tauri 应用本身，先做依赖体检，避免盲猜白屏原因。

## 检测项

- Windows 版本、构建号、架构、内存
- `WebView2 Runtime` 是否安装、版本、注册表来源
- `Microsoft Edge` 版本
- `Microsoft Visual C++ x64 Runtime` 是否存在
- `rustc` / `cargo` / `node` / `pnpm` 是否存在
- `WebView2Loader.dll` 是否出现在系统目录

## 使用方式

在 PowerShell 中执行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\tools\tauri-env-check.ps1
```

## 输出结果

脚本会：

- 在终端打印摘要
- 生成 JSON 报告：`artifacts/tauri-env-report.json`

## 如何判断

如果输出里是 `Tauri Ready : YES`，说明这台机器至少满足最基础的运行条件。

如果是 `NO`，先看这几类问题：

- `WebView2 Runtime 未安装`
- `Microsoft Visual C++ x64 Runtime 未检测到`
- `Windows 构建号过低`

## 当前限制

这个检测器当前只做“环境前置检查”，还没有做“真实 Tauri 窗口启动探针”。

原因是当前开发环境里没有 `Rust/cargo`，我还不能直接在这里编译出一个 Tauri 可执行文件。

下一步已经补上了一个最小探针应用：

- 目录：`apps/tauri-probe`
- 开发运行：`apps/tauri-probe/tools/run-probe.cmd`
- 调试构建：`apps/tauri-probe/tools/build-probe.cmd`

构建产物默认输出到：

- `apps/tauri-probe/src-tauri/target/debug/bundle/nsis/`
- `apps/tauri-probe/src-tauri/target/debug/bundle/msi/`
