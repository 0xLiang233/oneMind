use serde::{Deserialize, Serialize};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    sync::{Arc, Mutex, OnceLock},
};
use tauri::{AppHandle, Emitter, State};

const DEFAULT_BRANCH: &str = "main";
const SYNC_EVENT: &str = "sync-status-changed";
const RUNTIME_IGNORE_ENTRIES: &[&str] = &[
    ".onemind/logs/",
    ".onemind/cache/",
    ".onemind/snapshots/",
    ".onemind/activity/",
];
const LEGACY_CONFIG_IGNORE_ENTRIES: &[&str] = &[
    ".onemind/settings.json",
    ".onemind/preferences.json",
    ".onemind/recent-system-apps.json",
    ".onemind/system-app-recents.json",
    ".onemind/sync.json",
];
const CONFIG_OVERWRITE_REQUIRED: &str = "REMOTE_CONFIG_OVERWRITE_REQUIRED";
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
static GIT_PROCESS_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Default)]
pub struct SyncState {
    operation: Arc<Mutex<()>>,
}

async fn run_git_operation<T: Send + 'static>(
    operation: Arc<Mutex<()>>,
    task: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = operation
            .lock()
            .map_err(|_| "同步操作队列不可用。".to_string())?;
        task()
    })
    .await
    .map_err(|error| format!("同步后台任务失败: {error}"))?
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncChange {
    pub kind: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_path: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflictResolution {
    pub path: String,
    pub version: ConflictVersion,
}

#[derive(Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ConflictVersion {
    Local,
    Remote,
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
    let _guard = GIT_PROCESS_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Git 操作队列不可用。".to_string())?;
    git_command()
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|error| format!("无法运行 Git: {error}"))
}

fn git_output_with_editor(root: &Path, args: &[&str]) -> Result<Output, String> {
    let _guard = GIT_PROCESS_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Git 操作队列不可用。".to_string())?;
    git_command()
        .args(args)
        .env("GIT_EDITOR", "true")
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
    let Ok(_guard) = GIT_PROCESS_LOCK.get_or_init(|| Mutex::new(())).lock() else {
        return false;
    };
    git_command()
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn git_version() -> String {
    let Ok(_guard) = GIT_PROCESS_LOCK.get_or_init(|| Mutex::new(())).lock() else {
        return String::new();
    };
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
        || lower.contains("http 401")
        || lower.contains("http 403")
        || lower.contains("error: 401")
        || lower.contains("error: 403")
        || lower.contains("access denied")
    {
        return (
            "authentication_required",
            "远程仓库需要登录，或当前账号没有访问权限。",
        );
    }
    if lower.contains("repository not found") || lower.contains("not found") {
        return (
            "repository_not_found",
            "没有找到远程仓库，请检查地址和仓库权限。",
        );
    }
    if lower.contains("could not resolve host")
        || lower.contains("failed to connect")
        || lower.contains("network")
        || lower.contains("timed out")
    {
        return (
            "network_unavailable",
            "无法连接远程服务，请检查网络后重试。",
        );
    }
    (
        "unreachable",
        "无法访问远程仓库，请检查地址、登录状态和权限。",
    )
}

fn rebase_in_progress(root: &Path) -> bool {
    let git_dir = root.join(".git");
    git_dir.join("rebase-apply").is_dir() || git_dir.join("rebase-merge").is_dir()
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
    if is_generated_gitignore_contents(&existing) {
        let next = format!("{}\n", RUNTIME_IGNORE_ENTRIES.join("\n"));
        if existing != next {
            fs::write(ignore_path, next).map_err(|error| error.to_string())?;
        }
        return Ok(());
    }

    let mut next = existing.trim_end().to_string();
    let mut changed = false;
    for entry in RUNTIME_IGNORE_ENTRIES {
        if !existing.lines().any(|line| line.trim() == *entry) {
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

fn is_generated_gitignore_contents(contents: &str) -> bool {
    let entries = contents
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    !entries.is_empty()
        && entries.iter().all(|line| {
            RUNTIME_IGNORE_ENTRIES.contains(line) || LEGACY_CONFIG_IGNORE_ENTRIES.contains(line)
        })
}

fn checkout_blocked_by_untracked_files(error: &str) -> bool {
    error
        .to_ascii_lowercase()
        .contains("untracked working tree files would be overwritten by checkout")
}

fn is_empty_generated_workspace_directory(root: &Path, name: &str) -> Result<bool, String> {
    let path = root.join(name);
    if !path.is_dir() {
        return Ok(false);
    }
    Ok(fs::read_dir(path)
        .map_err(|error| error.to_string())?
        .next()
        .is_none())
}

fn workspace_user_content(root: &Path) -> Result<Option<String>, String> {
    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == ".git" || name == ".onemind" {
            continue;
        }
        if name == ".gitignore" {
            continue;
        }
        if ["notes", "assets", "inbox", "sources"].contains(&name.as_str())
            && is_empty_generated_workspace_directory(root, &name)?
        {
            continue;
        }
        return Ok(Some(name));
    }
    Ok(None)
}

fn count_changes(root: &Path) -> u32 {
    list_changes(root)
        .map(|value| value.len() as u32)
        .unwrap_or(0)
}

fn status_change(kind: &str, path: &[u8], previous_path: Option<&[u8]>) -> SyncChange {
    SyncChange {
        kind: kind.to_string(),
        path: String::from_utf8_lossy(path).into_owned(),
        previous_path: previous_path.map(|value| String::from_utf8_lossy(value).into_owned()),
    }
}

fn classify_xy(xy: &[u8]) -> &'static str {
    if xy.contains(&b'D') {
        "deleted"
    } else if xy.contains(&b'A') {
        "added"
    } else {
        "modified"
    }
}

fn status_path(record: &[u8], field_count: usize) -> Option<(&[u8], &[u8])> {
    let mut fields = record.splitn(field_count, |value| *value == b' ');
    let marker = fields.next()?;
    let xy = fields.next()?;
    let path = fields.nth(field_count.checked_sub(3)?)?;
    (!marker.is_empty() && xy.len() == 2 && !path.is_empty()).then_some((xy, path))
}

fn parse_status_changes(raw: &[u8]) -> Result<Vec<SyncChange>, String> {
    let records = raw.split(|value| *value == 0).collect::<Vec<_>>();
    let mut changes = Vec::new();
    let mut index = 0;

    while index < records.len() {
        let record = records[index];
        index += 1;
        if record.is_empty() {
            continue;
        }

        match record[0] {
            b'1' => {
                let (xy, path) = status_path(record, 9)
                    .ok_or_else(|| "Git 返回了无效的普通变更记录。".to_string())?;
                changes.push(status_change(classify_xy(xy), path, None));
            }
            b'2' => {
                let (_, path) = status_path(record, 10)
                    .ok_or_else(|| "Git 返回了无效的重命名记录。".to_string())?;
                let previous_path = records
                    .get(index)
                    .copied()
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| "Git 重命名记录缺少原文件路径。".to_string())?;
                index += 1;
                changes.push(status_change("renamed", path, Some(previous_path)));
            }
            b'u' => {
                let (_, path) = status_path(record, 11)
                    .ok_or_else(|| "Git 返回了无效的冲突记录。".to_string())?;
                changes.push(status_change("conflicted", path, None));
            }
            b'?' => {
                let path = record
                    .strip_prefix(b"? ")
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| "Git 返回了无效的未跟踪文件记录。".to_string())?;
                changes.push(status_change("added", path, None));
            }
            b'!' | b'#' => {}
            _ => return Err("Git 返回了无法识别的变更记录。".to_string()),
        }
    }

    Ok(changes)
}

fn list_changes(root: &Path) -> Result<Vec<SyncChange>, String> {
    let output = git_output(
        root,
        &["status", "--porcelain=v2", "-z", "--untracked-files=all"],
    )?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(if stderr.is_empty() { stdout } else { stderr });
    }
    parse_status_changes(&output.stdout)
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

fn conflict_checkout_side(version: &ConflictVersion) -> &'static str {
    // During a rebase, "ours" is the upstream commit and "theirs" is the local commit being replayed.
    match version {
        ConflictVersion::Local => "--theirs",
        ConflictVersion::Remote => "--ours",
    }
}

fn is_safe_conflict_path(path: &str) -> bool {
    !path.trim().is_empty()
        && !Path::new(path).is_absolute()
        && !Path::new(path)
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
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
    let rebase_pending = repository_initialized && rebase_in_progress(root);
    let message = message.into();
    SyncStatus {
        available: git_available(),
        configured: repository_initialized && !remote_url(root).is_empty(),
        repository_initialized,
        phase: if rebase_pending { "conflicted" } else { phase }.to_string(),
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
        message: if rebase_pending {
            "请解决冲突文件后继续合并，或放弃本次远程合并。".to_string()
        } else {
            message
        },
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
pub async fn sync_get_status(
    state: State<'_, SyncState>,
    workspace_path: String,
) -> Result<SyncStatus, String> {
    run_git_operation(state.operation.clone(), move || {
        let root = workspace_root(&workspace_path)?;
        Ok(status(&root, "idle", ""))
    })
    .await
}

#[tauri::command]
pub async fn sync_list_changes(
    state: State<'_, SyncState>,
    workspace_path: String,
) -> Result<Vec<SyncChange>, String> {
    run_git_operation(state.operation.clone(), move || {
        let root = workspace_root(&workspace_path)?;
        if !is_repository(&root) {
            return Ok(Vec::new());
        }
        list_changes(&root)
    })
    .await
}

#[tauri::command]
pub async fn sync_preflight(
    state: State<'_, SyncState>,
    workspace_path: String,
) -> Result<SyncPreflight, String> {
    run_git_operation(state.operation.clone(), move || {
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
            identity_configured: !identity.name.trim().is_empty()
                && !identity.email.trim().is_empty(),
            identity,
            credential_helper_ready: !helper.trim().is_empty(),
            credential_helper: helper,
            remote_configured: !configured_remote.trim().is_empty(),
            remote_url: configured_remote,
        })
    })
    .await
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
    if !identity.email.contains('@')
        || identity.email.starts_with('@')
        || identity.email.ends_with('@')
    {
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
pub fn sync_test_remote(workspace_path: String, remote_url: String) -> Result<RemoteCheck, String> {
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
        .args([
            "credential-manager",
            "github",
            "login",
            "--browser",
            "--force",
        ])
        .current_dir(&root);
    if let Some(value) = username
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
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
pub fn sync_import_remote(
    app: AppHandle,
    state: State<'_, SyncState>,
    workspace_path: String,
    mut config: SyncConfig,
    overwrite_local_config: Option<bool>,
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
    if config.remote_url.is_empty() {
        return Err("请填写远程仓库地址。".to_string());
    }
    if let Some(path) = workspace_user_content(&root)? {
        return Err(format!(
            "当前工作区包含本地内容“{path}”，为避免覆盖数据，不能下载远程工作区。请在新的空工作区中接入远程仓库。"
        ));
    }
    if is_repository(&root) && git(&root, &["rev-parse", "--verify", "HEAD"]).is_ok() {
        return Err(
            "当前工作区已有本地提交，不能下载远程工作区。请在新的空工作区中接入远程仓库。"
                .to_string(),
        );
    }

    emit_status(&app, &status(&root, "initializing", "正在下载远程工作区…"));
    if !is_repository(&root) {
        git(&root, &["init", "-b", &config.branch])?;
    }
    set_remote(&root, &config.remote_url)?;
    git(&root, &["fetch", "--no-tags", "origin", &config.branch])?;
    let remote_ref = format!("origin/{}", config.branch);
    if git(&root, &["rev-parse", "--verify", &remote_ref]).is_err() {
        return Err(format!("远程仓库不存在分支 {}。", config.branch));
    }
    let checkout_args = if overwrite_local_config.unwrap_or(false) {
        vec![
            "checkout",
            "--force",
            "-B",
            &config.branch,
            "--track",
            &remote_ref,
        ]
    } else {
        vec!["checkout", "-B", &config.branch, "--track", &remote_ref]
    };
    if let Err(error) = git(&root, &checkout_args) {
        if !overwrite_local_config.unwrap_or(false) && checkout_blocked_by_untracked_files(&error) {
            return Err(format!(
                "{CONFIG_OVERWRITE_REQUIRED}: 远程仓库包含工作区配置，当前电脑也已生成配置。请选择保留本机配置，或确认使用远程配置覆盖本机配置。笔记、附件、收集箱和来源文件不会被覆盖。\n{error}"
            ));
        }
        return Err(error);
    }
    ensure_gitignore(&root)?;
    let mut imported_config = read_config(&root);
    imported_config.enabled = true;
    imported_config.remote_url = config.remote_url;
    imported_config.branch = config.branch;
    write_config(&root, &imported_config)?;
    let next = status(&root, "idle", "已下载远程工作区，可以开始同步");
    emit_status(&app, &next);
    Ok(SyncResult {
        success: true,
        status: next,
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
pub async fn sync_run(
    app: AppHandle,
    state: State<'_, SyncState>,
    workspace_path: String,
) -> Result<SyncResult, String> {
    run_git_operation(state.operation.clone(), move || {
        let root = workspace_root(&workspace_path)?;
        if !is_repository(&root) {
            return Err("当前工作区尚未初始化同步。".to_string());
        }
        if rebase_in_progress(&root) {
            let next = status(&root, "conflicted", "请先处理同步冲突。".to_string());
            emit_status(&app, &next);
            return Ok(SyncResult {
                success: false,
                status: next,
            });
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
    })
    .await
}

#[tauri::command]
pub fn sync_continue_rebase(
    app: AppHandle,
    state: State<'_, SyncState>,
    workspace_path: String,
) -> Result<SyncResult, String> {
    let _guard = state
        .operation
        .try_lock()
        .map_err(|_| "另一个同步操作正在进行。".to_string())?;
    let root = workspace_root(&workspace_path)?;
    if !is_repository(&root) || !rebase_in_progress(&root) {
        return Err("当前没有待继续的同步冲突。".to_string());
    }

    emit_status(&app, &status(&root, "rebasing", "正在继续合并远程更改…"));
    git(&root, &["add", "-A", "--", "."])?;
    let output = git_output_with_editor(&root, &["rebase", "--continue"])?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let mut next = status(&root, "conflicted", "仍有同步冲突需要处理");
        next.conflicts = conflict_files(&root);
        if !detail.is_empty() {
            next.message = detail;
        }
        emit_status(&app, &next);
        return Ok(SyncResult {
            success: false,
            status: next,
        });
    }

    let config = read_config(&root);
    emit_status(&app, &status(&root, "pushing", "正在上传已合并的更改…"));
    git(&root, &["push", "--set-upstream", "origin", &config.branch])?;
    let next = status(&root, "idle", "冲突已解决并完成同步");
    emit_status(&app, &next);
    Ok(SyncResult {
        success: true,
        status: next,
    })
}

#[tauri::command]
pub fn sync_resolve_conflicts(
    app: AppHandle,
    state: State<'_, SyncState>,
    workspace_path: String,
    resolutions: Vec<SyncConflictResolution>,
) -> Result<SyncResult, String> {
    let _guard = state
        .operation
        .try_lock()
        .map_err(|_| "另一个同步操作正在进行。".to_string())?;
    let root = workspace_root(&workspace_path)?;
    if !is_repository(&root) || !rebase_in_progress(&root) {
        return Err("当前没有待处理的同步冲突。".to_string());
    }
    if resolutions.is_empty() {
        return Err("请至少选择一个冲突文件的版本。".to_string());
    }

    let conflicts = conflict_files(&root).into_iter().collect::<HashSet<_>>();
    let mut resolved = HashSet::new();
    for resolution in resolutions {
        if !is_safe_conflict_path(&resolution.path) || !conflicts.contains(&resolution.path) {
            return Err("只能处理当前列表中的冲突文件。".to_string());
        }
        if !resolved.insert(resolution.path.clone()) {
            return Err("同一个冲突文件不能重复选择版本。".to_string());
        }
        let side = conflict_checkout_side(&resolution.version);
        git(&root, &["checkout", side, "--", &resolution.path])?;
        git(&root, &["add", "--", &resolution.path])?;
    }

    let remaining = conflict_files(&root);
    let message = if remaining.is_empty() {
        "已保存冲突文件的版本选择，请继续同步。"
    } else {
        "已保存版本选择，请继续处理其余冲突文件。"
    };
    let next = status(&root, "conflicted", message);
    emit_status(&app, &next);
    Ok(SyncResult {
        success: remaining.is_empty(),
        status: next,
    })
}

#[tauri::command]
pub fn sync_abort_rebase(
    app: AppHandle,
    state: State<'_, SyncState>,
    workspace_path: String,
) -> Result<SyncResult, String> {
    let _guard = state
        .operation
        .try_lock()
        .map_err(|_| "另一个同步操作正在进行。".to_string())?;
    let root = workspace_root(&workspace_path)?;
    if !is_repository(&root) || !rebase_in_progress(&root) {
        return Err("当前没有待放弃的同步冲突。".to_string());
    }
    git(&root, &["rebase", "--abort"])?;
    let next = status(&root, "idle", "已放弃本次远程合并，本地更改仍然保留");
    emit_status(&app, &next);
    Ok(SyncResult {
        success: true,
        status: next,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        checkout_blocked_by_untracked_files, conflict_checkout_side, ensure_gitignore,
        is_safe_conflict_path, parse_status_changes, workspace_user_content, ConflictVersion,
        SyncChange,
    };
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn change(kind: &str, path: &str, previous_path: Option<&str>) -> SyncChange {
        SyncChange {
            kind: kind.to_string(),
            path: path.to_string(),
            previous_path: previous_path.map(str::to_string),
        }
    }

    #[test]
    fn parses_added_modified_and_deleted_changes() {
        let raw = concat!(
            "? notes/新 笔记.md\0",
            "1 .M N... 100644 100644 100644 abcdef1 abcdef1 notes/需求 文档.md\0",
            "1 D. N... 100644 000000 000000 abcdef2 0000000 notes/旧文档.md\0",
            "1 A. N... 000000 100644 100644 0000000 abcdef3 notes/已暂存.md\0",
        );

        assert_eq!(
            parse_status_changes(raw.as_bytes()).unwrap(),
            vec![
                change("added", "notes/新 笔记.md", None),
                change("modified", "notes/需求 文档.md", None),
                change("deleted", "notes/旧文档.md", None),
                change("added", "notes/已暂存.md", None),
            ]
        );
    }

    #[test]
    fn parses_rename_with_both_paths() {
        let raw = concat!(
            "2 R. N... 100644 100644 100644 abcdef1 abcdef1 R100 notes/新 名称.md\0",
            "notes/旧 名称.md\0",
        );

        assert_eq!(
            parse_status_changes(raw.as_bytes()).unwrap(),
            vec![change(
                "renamed",
                "notes/新 名称.md",
                Some("notes/旧 名称.md")
            )]
        );
    }

    #[test]
    fn parses_conflict_and_preserves_newlines_in_paths() {
        let raw = concat!(
            "u UU N... 100644 100644 100644 100644 abcdef1 abcdef2 abcdef3 notes/冲突.md\0",
            "? notes/含\n换行.md\0",
        );

        assert_eq!(
            parse_status_changes(raw.as_bytes()).unwrap(),
            vec![
                change("conflicted", "notes/冲突.md", None),
                change("added", "notes/含\n换行.md", None),
            ]
        );
    }

    #[test]
    fn rejects_rename_without_previous_path() {
        let raw = b"2 R. N... 100644 100644 100644 aaaaaaa bbbbbbb R100 notes/new.md\0";
        assert!(parse_status_changes(raw).is_err());
    }

    #[test]
    fn accepts_empty_generated_workspace_directories_for_remote_import() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("onemind-sync-{suffix}"));
        for name in ["notes", "assets", "inbox", "sources", ".onemind"] {
            fs::create_dir_all(root.join(name)).unwrap();
        }

        assert_eq!(workspace_user_content(&root).unwrap(), None);
        fs::write(root.join("assets/image.png"), b"image").unwrap();
        assert_eq!(
            workspace_user_content(&root).unwrap(),
            Some("assets".to_string())
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recognizes_only_checkout_configuration_conflicts() {
        assert!(checkout_blocked_by_untracked_files(
            "error: The following untracked working tree files would be overwritten by checkout:"
        ));
        assert!(!checkout_blocked_by_untracked_files(
            "fatal: Unable to create '.git/index.lock': File exists."
        ));
    }

    #[test]
    fn maps_rebase_conflict_versions_to_the_correct_git_sides() {
        assert_eq!(conflict_checkout_side(&ConflictVersion::Local), "--theirs");
        assert_eq!(conflict_checkout_side(&ConflictVersion::Remote), "--ours");
    }

    #[test]
    fn accepts_only_workspace_relative_conflict_paths() {
        assert!(is_safe_conflict_path(".onemind/preferences.json"));
        assert!(is_safe_conflict_path("notes/项目.md"));
        assert!(!is_safe_conflict_path("../outside.txt"));
        assert!(!is_safe_conflict_path(""));
        assert!(!is_safe_conflict_path("C:\\outside.txt"));
    }

    #[test]
    fn tracks_workspace_configuration_and_ignores_only_runtime_state() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("onemind-sync-ignore-{suffix}"));
        fs::create_dir_all(&root).unwrap();

        ensure_gitignore(&root).unwrap();
        let ignore = fs::read_to_string(root.join(".gitignore")).unwrap();
        for path in [
            ".onemind/logs/",
            ".onemind/cache/",
            ".onemind/snapshots/",
            ".onemind/activity/",
        ] {
            assert!(ignore.lines().any(|line| line == path));
        }
        assert!(!ignore
            .lines()
            .any(|line| line == ".onemind/preferences.json"));

        fs::write(
            root.join(".gitignore"),
            ".onemind/logs/\n.onemind/preferences.json\n.onemind/sync.json\n",
        )
        .unwrap();
        ensure_gitignore(&root).unwrap();
        let migrated = fs::read_to_string(root.join(".gitignore")).unwrap();
        assert!(!migrated
            .lines()
            .any(|line| line == ".onemind/preferences.json"));
        assert!(!migrated.lines().any(|line| line == ".onemind/sync.json"));

        fs::remove_dir_all(root).unwrap();
    }
}
