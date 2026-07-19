use serde::{Deserialize, Serialize};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, State};

const DEFAULT_BRANCH: &str = "main";
const SYNC_EVENT: &str = "sync-status-changed";
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Default)]
pub struct SyncState {
    operation: Mutex<()>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub remote_url: String,
    #[serde(default = "default_branch")]
    pub branch: String,
    #[serde(default)]
    pub auto_sync_interval_minutes: u32,
    #[serde(default)]
    pub pull_on_startup: bool,
}

impl Default for SyncConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            remote_url: String::new(),
            branch: default_branch(),
            auto_sync_interval_minutes: 0,
            pull_on_startup: false,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub available: bool,
    pub configured: bool,
    pub repository_initialized: bool,
    pub phase: String,
    pub branch: String,
    pub remote_url: String,
    pub ahead: u32,
    pub behind: u32,
    pub changed_files: u32,
    pub conflicts: Vec<String>,
    pub message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub success: bool,
    pub status: SyncStatus,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitIdentity {
    pub name: String,
    pub email: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPreflight {
    pub git_available: bool,
    pub git_version: String,
    pub repository_initialized: bool,
    pub identity_configured: bool,
    pub identity: GitIdentity,
    pub credential_helper: String,
    pub credential_helper_ready: bool,
    pub remote_url: String,
    pub remote_configured: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteCheck {
    pub success: bool,
    pub state: String,
    pub message: String,
    pub remote_url: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticationResult {
    pub success: bool,
    pub message: String,
}

fn default_branch() -> String {
    DEFAULT_BRANCH.to_string()
}

fn workspace_root(workspace_path: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(workspace_path)
        .canonicalize()
        .map_err(|error| format!("Workspace 不可用: {error}"))?;
    if !root.is_dir() {
        return Err("Workspace 不是有效目录。".to_string());
    }
    Ok(root)
}

fn sync_config_path(root: &Path) -> PathBuf {
    root.join(".onemind").join("sync.json")
}

fn read_config(root: &Path) -> SyncConfig {
    fs::read_to_string(sync_config_path(root))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_config(root: &Path, config: &SyncConfig) -> Result<(), String> {
    let config_path = sync_config_path(root);
    let parent = config_path
        .parent()
        .ok_or_else(|| "同步配置目录无效。".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary_path = parent.join("sync.json.tmp");
    let raw = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
    fs::write(&temporary_path, raw).map_err(|error| error.to_string())?;
    fs::rename(&temporary_path, &config_path).map_err(|error| error.to_string())
}

fn validate_config(config: &SyncConfig) -> Result<(), String> {
    if config.branch.contains(char::is_whitespace) || config.branch.starts_with('-') {
        return Err("分支名称无效。".to_string());
    }
    if let Some((_, address)) = config.remote_url.split_once("://") {
        let authority = address.split('/').next().unwrap_or_default();
        if authority.contains('@') {
            return Err(
                "远程地址不能包含用户名、密码或 token，请使用系统 Git 凭证管理。".to_string(),
            );
        }
    }
    Ok(())
}

fn git_command() -> Command {
    let mut command = Command::new("git");
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

fn git_output(root: &Path, args: &[&str]) -> Result<Output, String> {
    git_command()
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|error| format!("无法运行 Git: {error}"))
}

fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = git_output(root, args)?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(if stderr.is_empty() { stdout } else { stderr })
}

fn git_available() -> bool {
    git_command()
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn git_version() -> String {
    git_command()
        .arg("--version")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_default()
}

fn git_config(root: &Path, key: &str) -> String {
    git(root, &["config", "--get", key]).unwrap_or_default()
}

fn read_identity(root: &Path) -> GitIdentity {
    GitIdentity {
        name: git_config(root, "user.name"),
        email: git_config(root, "user.email"),
    }
}

fn credential_helper(root: &Path) -> String {
    git_config(root, "credential.helper")
}

fn classify_remote_error(message: &str) -> (&'static str, &'static str) {
    let lower = message.to_lowercase();
    if lower.contains("authentication failed")
        || lower.contains("permission denied")
        || lower.contains("could not read username")
        || lower.contains("terminal prompts disabled")
        || lower.contains("publickey")
    {
        return ("authentication_required", "远程仓库需要登录，或当前账号没有访问权限。");
    }
    if lower.contains("repository not found") || lower.contains("not found") {
        return ("repository_not_found", "没有找到远程仓库，请检查地址和仓库权限。");
    }
    if lower.contains("could not resolve host")
        || lower.contains("failed to connect")
        || lower.contains("network")
        || lower.contains("timed out")
    {
        return ("network_unavailable", "无法连接远程服务，请检查网络后重试。");
    }
    ("unreachable", "无法访问远程仓库，请检查地址、登录状态和权限。")
}

fn is_repository(root: &Path) -> bool {
    root.join(".git").is_dir()
        && git(root, &["rev-parse", "--is-inside-work-tree"])
            .map(|value| value == "true")
            .unwrap_or(false)
}

fn ensure_gitignore(root: &Path) -> Result<(), String> {
    let ignore_path = root.join(".gitignore");
    let existing = fs::read_to_string(&ignore_path).unwrap_or_default();
    let required = [
        ".onemind/logs/",
        ".onemind/cache/",
        ".onemind/snapshots/",
        ".onemind/settings.json",
        ".onemind/sync.json",
        ".onemind/activity/",
    ];
    let mut next = existing.trim_end().to_string();
    let mut changed = false;
    for entry in required {
        if !existing.lines().any(|line| line.trim() == entry) {
            if !next.is_empty() {
                next.push('\n');
            }
            next.push_str(entry);
            changed = true;
        }
    }
    if changed || !ignore_path.exists() {
        next.push('\n');
        fs::write(ignore_path, next).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn count_changes(root: &Path) -> u32 {
    git(root, &["status", "--porcelain", "-uall"])
        .map(|value| value.lines().count() as u32)
        .unwrap_or(0)
}

fn current_branch(root: &Path, fallback: &str) -> String {
    git(root, &["branch", "--show-current"])
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn remote_url(root: &Path) -> String {
    git(root, &["remote", "get-url", "origin"]).unwrap_or_default()
}

fn ahead_behind(root: &Path, branch: &str) -> (u32, u32) {
    let remote_ref = format!("origin/{branch}");
    let Ok(raw) = git(
        root,
        &[
            "rev-list",
            "--left-right",
            "--count",
            &format!("HEAD...{remote_ref}"),
        ],
    ) else {
        return (0, 0);
    };
    let counts = raw
        .split_whitespace()
        .filter_map(|value| value.parse::<u32>().ok())
        .collect::<Vec<_>>();
    (
        counts.first().copied().unwrap_or(0),
        counts.get(1).copied().unwrap_or(0),
    )
}

fn conflict_files(root: &Path) -> Vec<String> {
    git(root, &["diff", "--name-only", "--diff-filter=U"])
        .map(|value| value.lines().map(str::to_string).collect())
        .unwrap_or_default()
}

fn status(root: &Path, phase: &str, message: impl Into<String>) -> SyncStatus {
    let config = read_config(root);
    let repository_initialized = is_repository(root);
    let branch = if repository_initialized {
        current_branch(root, &config.branch)
    } else {
        config.branch.clone()
    };
    let (ahead, behind) = if repository_initialized {
        ahead_behind(root, &branch)
    } else {
        (0, 0)
    };
    SyncStatus {
        available: git_available(),
        configured: repository_initialized && !remote_url(root).is_empty(),
        repository_initialized,
        phase: phase.to_string(),
        branch,
        remote_url: if repository_initialized {
            remote_url(root)
        } else {
            config.remote_url
        },
        ahead,
        behind,
        changed_files: if repository_initialized {
            count_changes(root)
        } else {
            0
        },
        conflicts: if repository_initialized {
            conflict_files(root)
        } else {
            Vec::new()
        },
        message: message.into(),
    }
}

fn emit_status(app: &AppHandle, value: &SyncStatus) {
    let _ = app.emit(SYNC_EVENT, value.clone());
}

fn set_remote(root: &Path, remote_url: &str) -> Result<(), String> {
    if remote_url.trim().is_empty() {
        return Ok(());
    }
    if git(root, &["remote", "get-url", "origin"]).is_ok() {
        git(root, &["remote", "set-url", "origin", remote_url])?;
    } else {
        git(root, &["remote", "add", "origin", remote_url])?;
    }
    Ok(())
}

#[tauri::command]
pub fn sync_read_config(workspace_path: String) -> Result<SyncConfig, String> {
    Ok(read_config(&workspace_root(&workspace_path)?))
}

#[tauri::command]
pub fn sync_write_config(
    workspace_path: String,
    mut config: SyncConfig,
) -> Result<SyncConfig, String> {
    let root = workspace_root(&workspace_path)?;
    config.branch = config.branch.trim().to_string();
    config.remote_url = config.remote_url.trim().to_string();
    if config.branch.is_empty() {
        config.branch = default_branch();
    }
    validate_config(&config)?;
    write_config(&root, &config)?;
    Ok(config)
}

#[tauri::command]
pub fn sync_get_status(workspace_path: String) -> Result<SyncStatus, String> {
    let root = workspace_root(&workspace_path)?;
    Ok(status(&root, "idle", ""))
}

#[tauri::command]
pub fn sync_preflight(workspace_path: String) -> Result<SyncPreflight, String> {
    let root = workspace_root(&workspace_path)?;
    let available = git_available();
    let repository_initialized = available && is_repository(&root);
    let identity = if available {
        read_identity(&root)
    } else {
        GitIdentity {
            name: String::new(),
            email: String::new(),
        }
    };
    let helper = if available {
        credential_helper(&root)
    } else {
        String::new()
    };
    let configured_remote = if repository_initialized {
        remote_url(&root)
    } else {
        read_config(&root).remote_url
    };
    Ok(SyncPreflight {
        git_available: available,
        git_version: git_version(),
        repository_initialized,
        identity_configured: !identity.name.trim().is_empty() && !identity.email.trim().is_empty(),
        identity,
        credential_helper_ready: !helper.trim().is_empty(),
        credential_helper: helper,
        remote_configured: !configured_remote.trim().is_empty(),
        remote_url: configured_remote,
    })
}

#[tauri::command]
pub fn sync_write_identity(
    workspace_path: String,
    mut identity: GitIdentity,
) -> Result<GitIdentity, String> {
    let root = workspace_root(&workspace_path)?;
    if !git_available() {
        return Err("未检测到 Git，请先安装 Git 并重新启动 OneMind。".to_string());
    }
    identity.name = identity.name.trim().to_string();
    identity.email = identity.email.trim().to_string();
    if identity.name.is_empty() {
        return Err("请填写提交者名称。".to_string());
    }
    if !identity.email.contains('@') || identity.email.starts_with('@') || identity.email.ends_with('@') {
        return Err("请填写有效的提交者邮箱。".to_string());
    }
    if !is_repository(&root) {
        let branch = read_config(&root).branch;
        git(&root, &["init", "-b", &branch])?;
        ensure_gitignore(&root)?;
    }
    git(&root, &["config", "--local", "user.name", &identity.name])?;
    git(&root, &["config", "--local", "user.email", &identity.email])?;
    Ok(identity)
}

#[tauri::command]
pub fn sync_test_remote(
    workspace_path: String,
    remote_url: String,
) -> Result<RemoteCheck, String> {
    let root = workspace_root(&workspace_path)?;
    let remote_url = remote_url.trim().to_string();
    if remote_url.is_empty() {
        return Err("请填写远程仓库地址。".to_string());
    }
    let mut config = read_config(&root);
    config.remote_url = remote_url.clone();
    validate_config(&config)?;
    let output = git_output(&root, &["ls-remote", "--heads", &remote_url])?;
    if output.status.success() {
        let refs = String::from_utf8_lossy(&output.stdout);
        let has_history = refs.lines().any(|line| !line.trim().is_empty());
        return Ok(RemoteCheck {
            success: true,
            state: if has_history { "has_history" } else { "empty" }.to_string(),
            message: if has_history {
                "连接成功，但远程仓库已有分支和提交。".to_string()
            } else {
                "连接成功，远程仓库为空，可以初始化同步。".to_string()
            },
            remote_url,
        });
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if stderr.is_empty() { stdout } else { stderr };
    let (state, message) = classify_remote_error(&detail);
    Ok(RemoteCheck {
        success: false,
        state: state.to_string(),
        message: message.to_string(),
        remote_url,
    })
}

#[tauri::command]
pub fn sync_authenticate_github(
    workspace_path: String,
    username: Option<String>,
) -> Result<AuthenticationResult, String> {
    let root = workspace_root(&workspace_path)?;
    let manager = git_command()
        .args(["credential-manager", "--version"])
        .current_dir(&root)
        .output()
        .map_err(|error| format!("无法启动 Git Credential Manager: {error}"))?;
    if !manager.status.success() {
        return Err("未检测到 Git Credential Manager，请安装最新版 Git for Windows。".to_string());
    }

    let mut command = git_command();
    command
        .args(["credential-manager", "github", "login", "--browser", "--force"])
        .current_dir(&root);
    if let Some(value) = username.map(|value| value.trim().to_string()).filter(|value| !value.is_empty()) {
        command.args(["--username", &value]);
    }
    command.stdout(Stdio::null()).stderr(Stdio::null());
    command
        .spawn()
        .map_err(|error| format!("无法启动 GitHub 登录: {error}"))?;
    Ok(AuthenticationResult {
        success: true,
        message: "浏览器授权已启动。完成网页授权后，返回 OneMind 验证写入权限。".to_string(),
    })
}

#[tauri::command]
pub fn sync_initialize(
    app: AppHandle,
    state: State<'_, SyncState>,
    workspace_path: String,
    mut config: SyncConfig,
) -> Result<SyncResult, String> {
    let _guard = state
        .operation
        .try_lock()
        .map_err(|_| "另一个同步操作正在进行。".to_string())?;
    let root = workspace_root(&workspace_path)?;
    if !git_available() {
        return Err("未检测到 Git，请先安装 Git 并重新启动 OneMind。".to_string());
    }

    config.branch = config.branch.trim().to_string();
    config.remote_url = config.remote_url.trim().to_string();
    if config.branch.is_empty() {
        config.branch = default_branch();
    }
    validate_config(&config)?;
    let working = status(&root, "initializing", "正在初始化同步…");
    emit_status(&app, &working);
    if !is_repository(&root) {
        git(&root, &["init", "-b", &config.branch])?;
    } else {
        let current = current_branch(&root, &config.branch);
        if current != config.branch {
            git(&root, &["branch", "-M", &config.branch])?;
        }
    }
    ensure_gitignore(&root)?;
    set_remote(&root, &config.remote_url)?;
    write_config(&root, &config)?;
    let next = status(&root, "idle", "同步已配置");
    emit_status(&app, &next);
    Ok(SyncResult {
        success: true,
        status: next,
    })
}

#[tauri::command]
pub fn sync_run(
    app: AppHandle,
    state: State<'_, SyncState>,
    workspace_path: String,
) -> Result<SyncResult, String> {
    let _guard = state
        .operation
        .try_lock()
        .map_err(|_| "另一个同步操作正在进行。".to_string())?;
    let root = workspace_root(&workspace_path)?;
    if !is_repository(&root) {
        return Err("当前工作区尚未初始化同步。".to_string());
    }
    let config = read_config(&root);
    ensure_gitignore(&root)?;

    emit_status(&app, &status(&root, "committing", "正在保存本地更改…"));
    git(&root, &["add", "-A", "--", "."])?;
    let has_staged_changes = git(&root, &["diff", "--cached", "--quiet"]).is_err();
    if has_staged_changes {
        let message = format!(
            "OneMind sync: {}",
            chrono::Local::now().format("%Y-%m-%d %H:%M")
        );
        git(&root, &["commit", "-m", &message])?;
    }

    let remote = remote_url(&root);
    if remote.is_empty() {
        let next = status(&root, "idle", "本地更改已提交");
        emit_status(&app, &next);
        return Ok(SyncResult {
            success: true,
            status: next,
        });
    }

    emit_status(&app, &status(&root, "fetching", "正在获取远程更改…"));
    git(&root, &["fetch", "origin"])?;
    let remote_ref = format!("origin/{}", config.branch);
    if git(&root, &["rev-parse", "--verify", &remote_ref]).is_ok() {
        let (_, behind) = ahead_behind(&root, &config.branch);
        if behind > 0 {
            emit_status(&app, &status(&root, "rebasing", "正在合并远程更改…"));
            if let Err(error) = git(&root, &["rebase", &remote_ref]) {
                let conflicts = conflict_files(&root);
                let _ = git(&root, &["rebase", "--abort"]);
                let mut next = status(&root, "conflicted", "检测到同步冲突");
                next.conflicts = conflicts;
                next.message = error;
                emit_status(&app, &next);
                return Ok(SyncResult {
                    success: false,
                    status: next,
                });
            }
        }
    }

    emit_status(&app, &status(&root, "pushing", "正在上传本地更改…"));
    git(&root, &["push", "--set-upstream", "origin", &config.branch])?;
    let next = status(&root, "idle", "同步完成");
    emit_status(&app, &next);
    Ok(SyncResult {
        success: true,
        status: next,
    })
}
