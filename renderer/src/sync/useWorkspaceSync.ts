import { useCallback, useEffect, useRef, useState } from "react"
import { flushBeforeSync } from "./saveBarrier"

export const defaultSyncConfig: SyncConfig = {
  enabled: false,
  remoteUrl: "",
  branch: "main",
  autoSyncIntervalMinutes: 0,
  pullOnStartup: false
}

const emptySyncStatus: SyncStatus = {
  available: true,
  configured: false,
  repositoryInitialized: false,
  phase: "idle",
  branch: "main",
  remoteUrl: "",
  ahead: 0,
  behind: 0,
  changedFiles: 0,
  conflicts: [],
  message: ""
}

const emptyPreflight: SyncPreflight = {
  gitAvailable: true,
  gitVersion: "",
  repositoryInitialized: false,
  identityConfigured: false,
  identity: { name: "", email: "" },
  credentialHelper: "",
  credentialHelperReady: false,
  remoteUrl: "",
  remoteConfigured: false
}

export function useWorkspaceSync(workspacePath: string, onWorkspaceChanged: () => Promise<void>) {
  const [config, setConfig] = useState<SyncConfig>(defaultSyncConfig)
  const [status, setStatus] = useState<SyncStatus>(emptySyncStatus)
  const [preflight, setPreflight] = useState<SyncPreflight>(emptyPreflight)
  const [error, setError] = useState("")
  const startedForWorkspaceRef = useRef("")
  const runningRef = useRef(false)

  const refresh = useCallback(async () => {
    if (!workspacePath) return
    const [nextConfig, nextStatus, nextPreflight] = await Promise.all([
      window.oneMind.sync.readConfig(workspacePath),
      window.oneMind.sync.getStatus(workspacePath),
      window.oneMind.sync.preflight(workspacePath)
    ])
    setConfig(nextConfig)
    setStatus(nextStatus)
    setPreflight(nextPreflight)
  }, [workspacePath])

  const run = useCallback(async () => {
    if (!workspacePath || runningRef.current) return null
    runningRef.current = true
    setError("")
    try {
      await flushBeforeSync()
      const result = await window.oneMind.sync.run(workspacePath)
      setStatus(result.status)
      await onWorkspaceChanged()
      window.dispatchEvent(new CustomEvent("onemind-workspace-changed"))
      return result
    } catch (nextError) {
      setError(String(nextError))
      setStatus((current) => ({ ...current, phase: "error", message: String(nextError) }))
      return null
    } finally {
      runningRef.current = false
    }
  }, [onWorkspaceChanged, workspacePath])

  const saveConfig = useCallback(async (nextConfig: SyncConfig) => {
    if (!workspacePath) return nextConfig
    setError("")
    const saved = await window.oneMind.sync.writeConfig(workspacePath, nextConfig)
    setConfig(saved)
    return saved
  }, [workspacePath])

  const initialize = useCallback(async (nextConfig: SyncConfig) => {
    if (!workspacePath || runningRef.current) return null
    runningRef.current = true
    setError("")
    try {
      await flushBeforeSync()
      const result = await window.oneMind.sync.initialize(workspacePath, nextConfig)
      setConfig(nextConfig)
      setStatus(result.status)
      return result
    } catch (nextError) {
      setError(String(nextError))
      setStatus((current) => ({ ...current, phase: "error", message: String(nextError) }))
      return null
    } finally {
      runningRef.current = false
    }
  }, [workspacePath])

  useEffect(() => {
    if (!workspacePath) {
      setConfig(defaultSyncConfig)
      setStatus(emptySyncStatus)
      setPreflight(emptyPreflight)
      setError("")
      return
    }
    void refresh().catch((nextError) => setError(String(nextError)))
  }, [refresh, workspacePath])

  useEffect(() => window.oneMind.sync.onStatusChanged(setStatus), [])

  useEffect(() => {
    if (
      !workspacePath ||
      startedForWorkspaceRef.current === workspacePath ||
      !config.enabled ||
      !config.pullOnStartup ||
      !status.configured
    ) return
    startedForWorkspaceRef.current = workspacePath
    void run()
  }, [config.enabled, config.pullOnStartup, run, status.configured, workspacePath])

  useEffect(() => {
    if (!workspacePath || !config.enabled || !status.configured || config.autoSyncIntervalMinutes <= 0) return
    const timer = window.setInterval(() => void run(), config.autoSyncIntervalMinutes * 60_000)
    return () => window.clearInterval(timer)
  }, [config.autoSyncIntervalMinutes, config.enabled, run, status.configured, workspacePath])

  const saveIdentity = useCallback(async (identity: GitIdentity) => {
    if (!workspacePath) return identity
    setError("")
    const saved = await window.oneMind.sync.writeIdentity(workspacePath, identity)
    await refresh()
    return saved
  }, [refresh, workspacePath])

  const testRemote = useCallback(async (remoteUrl: string) => {
    if (!workspacePath) return null
    setError("")
    return window.oneMind.sync.testRemote(workspacePath, remoteUrl)
  }, [workspacePath])

  const listChanges = useCallback(async () => {
    if (!workspacePath) return []
    return window.oneMind.sync.listChanges(workspacePath)
  }, [workspacePath])

  const authenticateGitHub = useCallback(async (username?: string) => {
    if (!workspacePath) return null
    setError("")
    try {
      return await window.oneMind.sync.authenticateGitHub(workspacePath, username)
    } catch (nextError) {
      setError(String(nextError))
      return null
    }
  }, [workspacePath])

  return { config, status, preflight, error, refresh, run, saveConfig, saveIdentity, testRemote, listChanges, authenticateGitHub, initialize }
}
