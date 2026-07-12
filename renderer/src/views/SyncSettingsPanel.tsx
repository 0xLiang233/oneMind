import { useState } from "react"
import { AlertTriangle, Check, GitBranch, RefreshCw } from "../icons"

type Props = {
  config: SyncConfig
  status: SyncStatus
  preflight: SyncPreflight
  error: string
  onInitialize: (config: SyncConfig) => Promise<SyncResult | null>
  onRun: () => Promise<SyncResult | null>
  onSaveConfig: (config: SyncConfig) => Promise<SyncConfig>
  onSaveIdentity: (identity: GitIdentity) => Promise<GitIdentity>
  onTestRemote: (remoteUrl: string) => Promise<RemoteCheck | null>
  onAuthenticateGitHub: (username?: string) => Promise<AuthenticationResult | null>
}

const intervals = [
  { value: 0, label: "关闭" },
  { value: 5, label: "每 5 分钟" },
  { value: 10, label: "每 10 分钟" },
  { value: 30, label: "每 30 分钟" },
  { value: 60, label: "每小时" }
]

const busyPhases = new Set<SyncPhase>(["initializing", "committing", "fetching", "rebasing", "pushing"])

type LocalAction = "savingIdentity" | "testingRemote" | "openingAuth" | "initializing" | "savingRepository" | "savingPreferences" | "syncing"

const phaseLabels: Partial<Record<SyncPhase, string>> = {
  initializing: "正在准备工作区",
  committing: "正在提交本地更改",
  fetching: "正在获取远程更改",
  rebasing: "正在合并远程更改",
  pushing: "正在上传到远程仓库"
}

const actionLabels: Record<LocalAction, string> = {
  savingIdentity: "正在保存提交身份",
  testingRemote: "正在检查仓库和访问权限",
  openingAuth: "正在打开 GitHub 授权",
  initializing: "正在初始化同步配置",
  savingRepository: "正在保存仓库配置",
  savingPreferences: "正在保存同步偏好",
  syncing: "正在准备同步"
}

function statusLabel(status: SyncStatus) {
  if (!status.available) return "未安装 Git"
  if (status.phase === "conflicted") return "需要处理冲突"
  if (status.phase === "error") return "同步失败"
  if (busyPhases.has(status.phase)) return status.message || "正在同步"
  if (!status.repositoryInitialized) return "尚未配置"
  if (!status.configured) return "仅本地版本管理"
  if (status.changedFiles > 0) return `${status.changedFiles} 个本地更改`
  if (status.ahead > 0 || status.behind > 0) return `领先 ${status.ahead} · 落后 ${status.behind}`
  return status.message || "已同步"
}

function CheckMark({ ready, busy = false }: { ready: boolean; busy?: boolean }) {
  return (
    <span className={`sync-check-mark ${ready ? "ready" : "pending"} ${busy ? "busy" : ""}`} aria-hidden="true">
      {busy ? <RefreshCw size={14} /> : ready ? <Check size={14} /> : <span />}
    </span>
  )
}

function LoadingLabel({ label }: { label: string }) {
  return <><RefreshCw className="sync-loading-icon" size={14} aria-hidden="true" /><span>{label}</span></>
}

export function SyncSettingsPanel({
  config,
  status,
  preflight,
  error,
  onInitialize,
  onRun,
  onSaveConfig,
  onSaveIdentity,
  onTestRemote,
  onAuthenticateGitHub
}: Props) {
  const [draft, setDraft] = useState(config)
  const [sourceConfig, setSourceConfig] = useState(config)
  const [identity, setIdentity] = useState(preflight.identity)
  const [sourceIdentity, setSourceIdentity] = useState(preflight.identity)
  const [editingIdentity, setEditingIdentity] = useState(!preflight.identityConfigured)
  const [remoteCheck, setRemoteCheck] = useState<RemoteCheck | null>(null)
  const [localAction, setLocalAction] = useState<LocalAction | null>(null)
  const [authStarted, setAuthStarted] = useState(false)
  const [authMessage, setAuthMessage] = useState("")
  const [formError, setFormError] = useState("")
  const saving = localAction === "savingIdentity" || localAction === "initializing" || localAction === "savingRepository" || localAction === "savingPreferences"
  const checkingRemote = localAction === "testingRemote"
  const authenticating = localAction === "openingAuth"
  const syncing = localAction === "syncing" || busyPhases.has(status.phase)
  const isBusy = localAction !== null || busyPhases.has(status.phase)
  const needsSetup = !status.configured || !preflight.gitAvailable || !preflight.identityConfigured

  if (sourceConfig !== config) {
    setSourceConfig(config)
    setDraft(config)
  }
  if (sourceIdentity !== preflight.identity) {
    setSourceIdentity(preflight.identity)
    setIdentity(preflight.identity)
    if (!preflight.identityConfigured) setEditingIdentity(true)
  }

  async function saveIdentity() {
    setLocalAction("savingIdentity")
    setFormError("")
    try {
      await onSaveIdentity(identity)
      setEditingIdentity(false)
    } catch (nextError) {
      setFormError(String(nextError))
    } finally {
      setLocalAction(null)
    }
  }

  async function testRemote() {
    setLocalAction("testingRemote")
    setFormError("")
    setRemoteCheck(null)
    try {
      const result = await onTestRemote(draft.remoteUrl)
      setRemoteCheck(result)
    } catch (nextError) {
      setFormError(String(nextError))
    } finally {
      setLocalAction(null)
    }
  }

  async function connectRepository() {
    if (!remoteCheck?.success || (remoteCheck.state !== "empty" && !status.configured)) return
    const next = { ...draft, enabled: true }
    setDraft(next)
    setLocalAction("initializing")
    setFormError("")
    try {
      const saved = await onSaveConfig(next)
      await onInitialize(saved)
    } catch (nextError) {
      setFormError(String(nextError))
    } finally {
      setLocalAction(null)
    }
  }

  async function authenticateGitHub() {
    setLocalAction("openingAuth")
    setFormError("")
    setAuthMessage("")
    try {
      const username = draft.remoteUrl.match(/github\.com[/:]([^/]+)\//i)?.[1]
      const result = await onAuthenticateGitHub(username)
      if (!result?.success) return
      setAuthStarted(true)
      setAuthMessage(result.message)
    } catch (nextError) {
      setFormError(String(nextError))
    } finally {
      setLocalAction(null)
    }
  }

  async function updateRepository() {
    setLocalAction("savingRepository")
    setFormError("")
    try {
      const saved = await onSaveConfig(draft)
      await onInitialize(saved)
      setRemoteCheck(null)
    } catch (nextError) {
      setFormError(String(nextError))
    } finally {
      setLocalAction(null)
    }
  }

  async function updateConfig(next: SyncConfig) {
    setDraft(next)
    setLocalAction("savingPreferences")
    setFormError("")
    try {
      await onSaveConfig(next)
    } catch (nextError) {
      setFormError(String(nextError))
    } finally {
      setLocalAction(null)
    }
  }

  async function runSync() {
    setLocalAction("syncing")
    setFormError("")
    try {
      await onRun()
    } finally {
      setLocalAction(null)
    }
  }

  const remoteReady = remoteCheck?.success === true && (remoteCheck.state === "empty" || status.configured)
  const setupReady = preflight.gitAvailable && preflight.identityConfigured && remoteReady
  const httpsRemote = draft.remoteUrl.trim().toLowerCase().startsWith("http")
  const githubHttps = /^https?:\/\/github\.com\//i.test(draft.remoteUrl.trim())
  const authenticationRequired = /\b403\b|write access to repository not granted|authentication failed|permission denied/i.test(error || status.message)
  const authenticationReady = !githubHttps || authStarted || (!needsSetup && !authenticationRequired)
  const canCompleteSetup = setupReady && authenticationReady
  const operationLabel = localAction ? actionLabels[localAction] : phaseLabels[status.phase] || ""

  return (
    <div className="sync-settings-panel" aria-busy={isBusy}>
      <div className={`sync-operation-track ${operationLabel ? "active" : ""}`} role="status" aria-live="polite">
        {operationLabel ? <LoadingLabel label={operationLabel} /> : <span aria-hidden="true">同步操作就绪</span>}
      </div>
      {needsSetup ? (
        <>
          <div className="sync-setup-heading">
            <div className="sync-setup-icon" aria-hidden="true"><GitBranch size={18} /></div>
            <div>
              <div className="notes-panel-title">连接私有同步仓库</div>
              <p>先完成本机检查，再初始化当前工作区。登录信息由系统 Git 安全保存。</p>
            </div>
          </div>

          <div className="sync-check-track">
            <section className="sync-check-step">
              <CheckMark ready={preflight.gitAvailable} />
              <div className="sync-check-content">
                <div className="sync-check-title"><span>Git 环境</span><small>{preflight.gitVersion || "未检测到"}</small></div>
                <p>{preflight.gitAvailable ? "已检测到本机 Git。" : "请先安装 Git for Windows，然后重新启动 OneMind。"}</p>
              </div>
            </section>

            <section className="sync-check-step">
              <CheckMark ready={preflight.identityConfigured} busy={localAction === "savingIdentity"} />
              <div className="sync-check-content">
                <div className="sync-check-title">
                  <span>提交身份</span>
                  {preflight.identityConfigured && !editingIdentity ? (
                    <button type="button" className="sync-text-action" onClick={() => setEditingIdentity(true)}>修改</button>
                  ) : null}
                </div>
                {preflight.identityConfigured && !editingIdentity ? (
                  <p>{preflight.identity.name} · {preflight.identity.email}</p>
                ) : (
                  <div className="sync-inline-form">
                    <input
                      className="convert-input"
                      value={identity.name}
                      disabled={isBusy}
                      onChange={(event) => setIdentity({ ...identity, name: event.target.value })}
                      placeholder="提交者名称"
                      aria-label="提交者名称"
                    />
                    <input
                      className="convert-input"
                      value={identity.email}
                      disabled={isBusy}
                      onChange={(event) => setIdentity({ ...identity, email: event.target.value })}
                      placeholder="提交者邮箱"
                      aria-label="提交者邮箱"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      className="secondary compact"
                      disabled={saving || !identity.name.trim() || !identity.email.trim()}
                      onClick={() => void saveIdentity()}
                    >{localAction === "savingIdentity" ? <LoadingLabel label="保存中" /> : "保存"}</button>
                  </div>
                )}
              </div>
            </section>

            <section className="sync-check-step">
              <CheckMark ready={remoteReady} busy={checkingRemote} />
              <div className="sync-check-content">
                <div className="sync-check-title"><span>远程仓库</span><small>HTTPS 或 SSH</small></div>
                <div className="sync-repository-fields">
                  <input
                    className="convert-input"
                    value={draft.remoteUrl}
                    disabled={isBusy}
                    onChange={(event) => {
                      setDraft({ ...draft, remoteUrl: event.target.value })
                      setRemoteCheck(null)
                    }}
                    placeholder="https://github.com/owner/onemind-workspace.git"
                    aria-label="远程仓库地址"
                    spellCheck={false}
                  />
                  <label className="sync-branch-field">
                    <GitBranch size={15} aria-hidden="true" />
                    <input
                      className="convert-input"
                      value={draft.branch}
                      disabled={isBusy}
                      onChange={(event) => setDraft({ ...draft, branch: event.target.value })}
                      aria-label="同步分支"
                      spellCheck={false}
                    />
                  </label>
                </div>
                <div className="sync-remote-actions">
                  <p>{httpsRemote && !preflight.credentialHelperReady
                    ? "未检测到凭证管理器。测试时仍可尝试登录，但建议安装最新版 Git for Windows。"
                    : `首次建议使用空的私有仓库。${preflight.credentialHelper ? `凭证方式：${preflight.credentialHelper}。` : "SSH 登录由系统代理管理。"}`}</p>
                  <button
                    type="button"
                    className="secondary compact"
                    disabled={checkingRemote || !preflight.identityConfigured || !draft.remoteUrl.trim()}
                    onClick={() => void testRemote()}
                  >{checkingRemote ? <LoadingLabel label="检查中" /> : remoteCheck?.state === "authentication_required" ? "重新登录并检查" : "测试连接"}</button>
                </div>
                {remoteCheck ? (
                  <div className={`sync-check-result ${remoteReady ? "empty" : remoteCheck.success ? remoteCheck.state : "error"}`}>
                    {remoteReady ? <Check size={14} /> : <AlertTriangle size={14} />}
                    <span>{remoteCheck.message}</span>
                  </div>
                ) : null}
                {githubHttps && remoteReady ? (
                  <div className="sync-auth-box">
                    <div>
                      <strong>{authStarted ? "等待完成网页授权" : "登录 GitHub"}</strong>
                      <p>{authMessage || "通过浏览器授权 Git Credential Manager 写入这个私有仓库。OneMind 不会读取或保存 token。"}</p>
                    </div>
                    <button type="button" className="secondary compact" disabled={authenticating} onClick={() => void authenticateGitHub()}>
                      {authenticating ? <LoadingLabel label="正在打开" /> : authStarted ? "重新打开授权" : "登录 GitHub"}
                    </button>
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          {formError || error ? (
            <div className="sync-setup-error" role="status"><AlertTriangle size={15} /><span>{formError || error}</span></div>
          ) : null}
          <div className="sync-settings-actions">
            <button type="button" className="compact" disabled={isBusy || !canCompleteSetup} onClick={() => void connectRepository()}>
              {localAction === "initializing" ? <LoadingLabel label="正在初始化" /> : <><GitBranch size={14} aria-hidden="true" />{status.configured ? "完成配置并同步" : "初始化并同步"}</>}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="settings-row sync-status-row">
            <div className="sync-status-copy">
              <div className="notes-panel-title">同步状态</div>
              <p>{statusLabel(status)}</p>
              {(error || status.message) && status.phase !== "idle" ? <p className="sync-error-detail">{error || status.message}</p> : null}
            </div>
            <div className={`sync-state-mark ${status.phase}`} aria-hidden="true">
              {status.phase === "conflicted" || status.phase === "error" ? <AlertTriangle size={15} /> : busyPhases.has(status.phase) ? <RefreshCw size={15} /> : <Check size={15} />}
            </div>
          </div>

          <div className="sync-connection-summary">
            <span><CheckMark ready={preflight.gitAvailable} />Git</span>
            <span><CheckMark ready={preflight.identityConfigured} />{preflight.identity.name || "提交身份"}</span>
            <span><CheckMark ready={status.configured} />远程仓库</span>
          </div>

          {authenticationRequired ? (
            <div className="sync-auth-repair" role="status">
              <AlertTriangle size={18} aria-hidden="true" />
              <div>
                <strong>当前 GitHub 账号没有写入权限</strong>
                <p>可能保存了其他账号的旧凭证，或尚未授权当前私有仓库。重新登录后会自动再次同步。</p>
              </div>
              <div className="sync-auth-repair-actions">
                <button type="button" className="secondary compact" disabled={authenticating} onClick={() => void authenticateGitHub()}>
                  {authenticating ? <LoadingLabel label="正在打开" /> : authStarted ? "重新打开授权" : "登录 GitHub"}
                </button>
                {authStarted ? <button type="button" className="compact" disabled={isBusy} onClick={() => void runSync()}>{syncing ? <LoadingLabel label="正在重试" /> : "已完成授权，重试同步"}</button> : null}
              </div>
            </div>
          ) : null}

          <div className="settings-row">
            <div><div className="notes-panel-title">启用同步</div><p>按计划自动提交、拉取并推送当前工作区。</p></div>
            <button type="button" className={draft.enabled ? "settings-toggle active" : "settings-toggle"} aria-label="启用同步" aria-pressed={draft.enabled} disabled={isBusy} onClick={() => void updateConfig({ ...draft, enabled: !draft.enabled })} />
          </div>

          <div className="settings-row settings-row-stack">
            <div><div className="notes-panel-title">远程仓库</div><p>更改地址前请先测试登录和访问权限。</p></div>
            <div className="sync-repository-fields">
              <input className="convert-input" value={draft.remoteUrl} disabled={isBusy} onChange={(event) => { setDraft({ ...draft, remoteUrl: event.target.value }); setRemoteCheck(null) }} aria-label="远程仓库地址" spellCheck={false} />
              <label className="sync-branch-field"><GitBranch size={15} aria-hidden="true" /><input className="convert-input" value={draft.branch} disabled={isBusy} onChange={(event) => setDraft({ ...draft, branch: event.target.value })} aria-label="同步分支" spellCheck={false} /></label>
            </div>
            {remoteCheck ? <div className={`sync-check-result ${remoteCheck.success ? remoteCheck.state : "error"}`}>{remoteCheck.success ? <Check size={14} /> : <AlertTriangle size={14} />}<span>{remoteCheck.message}</span></div> : null}
          </div>

          <div className="settings-row">
            <div><div className="notes-panel-title">自动同步</div><p>仅在应用运行且工作区已配置时执行。</p></div>
            <select className="settings-select" value={draft.autoSyncIntervalMinutes} disabled={isBusy} onChange={(event) => void updateConfig({ ...draft, autoSyncIntervalMinutes: Number(event.target.value) })}>{intervals.map((interval) => <option key={interval.value} value={interval.value}>{interval.label}</option>)}</select>
          </div>

          <div className="settings-row">
            <div><div className="notes-panel-title">启动时同步</div><p>打开工作区后自动获取其他设备的更改。</p></div>
            <button type="button" className={draft.pullOnStartup ? "settings-toggle active" : "settings-toggle"} aria-label="启动时同步" aria-pressed={draft.pullOnStartup} disabled={isBusy} onClick={() => void updateConfig({ ...draft, pullOnStartup: !draft.pullOnStartup })} />
          </div>

          {status.conflicts.length > 0 ? <div className="sync-conflict-list"><div className="notes-panel-title">冲突文件</div>{status.conflicts.map((file) => <div key={file}>{file}</div>)}</div> : null}

          <div className="sync-settings-actions">
            <button type="button" className="secondary compact" disabled={isBusy || !draft.remoteUrl.trim()} onClick={() => void testRemote()}>{checkingRemote ? <LoadingLabel label="检查中" /> : "测试连接"}</button>
            <button type="button" className="secondary compact" disabled={isBusy || remoteCheck?.success !== true} onClick={() => void updateRepository()}>{localAction === "savingRepository" ? <LoadingLabel label="保存中" /> : "保存仓库配置"}</button>
            <button type="button" className="compact" disabled={isBusy || !status.repositoryInitialized} onClick={() => void runSync()}>{syncing ? <LoadingLabel label="同步中" /> : <><RefreshCw size={14} aria-hidden="true" />立即同步</>}</button>
          </div>
        </>
      )}
    </div>
  )
}
