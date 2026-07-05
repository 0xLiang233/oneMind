type ActivityPolicy =
  | { type: "instant" }
  | { type: "session"; idleMs: number; maxDurationMs: number; mergeKey: (event: ActivityEventInput) => string }

type ActivitySession = {
  workspacePath: string
  event: ActivityEventInput
  startedAt: number
  updatedAt: number
  eventCount: number
  timer: number | null
}

const activityPolicies: Record<string, ActivityPolicy> = {
  "notes.save": {
    type: "session",
    idleMs: 60_000,
    maxDurationMs: 30 * 60_000,
    mergeKey: (event) => `notes.save:${event.targetId ?? event.targetLabel ?? "unknown"}`
  },
  "search.note": {
    type: "session",
    idleMs: 10_000,
    maxDurationMs: 2 * 60_000,
    mergeKey: () => "search.note"
  },
  "floatTool.show": {
    type: "session",
    idleMs: 10_000,
    maxDurationMs: 60_000,
    mergeKey: () => "floatTool.show"
  }
}

const queue: Array<{ workspacePath: string; event: ActivityEventInput }> = []
const sessions = new Map<string, ActivitySession>()
let flushTimer: number | null = null

function toLocalIsoString(time: number = Date.now()) {
  const date = new Date(time)
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? "+" : "-"
  const absoluteOffset = Math.abs(offsetMinutes)
  const offsetHours = String(Math.floor(absoluteOffset / 60)).padStart(2, "0")
  const offsetRemainder = String(absoluteOffset % 60).padStart(2, "0")
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  const seconds = String(date.getSeconds()).padStart(2, "0")
  const millis = String(date.getMilliseconds()).padStart(3, "0")
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${millis}${sign}${offsetHours}:${offsetRemainder}`
}

function getPolicy(event: ActivityEventInput): ActivityPolicy {
  return activityPolicies[`${event.module}.${event.action}`] ?? { type: "instant" }
}

function scheduleFlush() {
  if (flushTimer !== null) return
  flushTimer = window.setTimeout(() => {
    flushTimer = null
    void flushActivity()
  }, 1000)
}

function enqueue(workspacePath: string, event: ActivityEventInput) {
  queue.push({ workspacePath, event })
  if (queue.length > 500) queue.splice(0, queue.length - 500)
  scheduleFlush()
}

function closeSession(workspacePath: string, key: string) {
  const session = sessions.get(key)
  if (!session) return
  if (session.timer !== null) window.clearTimeout(session.timer)
  sessions.delete(key)

  enqueue(workspacePath, {
    ...session.event,
    kind: "session",
    action: session.event.action === "save" ? "edit" : session.event.action,
    occurredAt: toLocalIsoString(session.updatedAt),
    startedAt: toLocalIsoString(session.startedAt),
    endedAt: toLocalIsoString(session.updatedAt),
    metadata: {
      ...(session.event.metadata ?? {}),
      eventCount: session.eventCount
    }
  })
}

function scheduleSessionClose(workspacePath: string, key: string, idleMs: number) {
  const session = sessions.get(key)
  if (!session) return
  if (session.timer !== null) window.clearTimeout(session.timer)
  session.timer = window.setTimeout(() => {
    closeSession(workspacePath, key)
  }, idleMs)
}

function trackSession(workspacePath: string, event: ActivityEventInput, policy: Extract<ActivityPolicy, { type: "session" }>) {
  const now = Date.now()
  const key = policy.mergeKey(event)
  const current = sessions.get(key)

  if (!current || now - current.startedAt >= policy.maxDurationMs) {
    if (current) closeSession(workspacePath, key)
    sessions.set(key, {
      workspacePath,
      event: {
        ...event,
        occurredAt: toLocalIsoString(now)
      },
      startedAt: now,
      updatedAt: now,
      eventCount: 1,
      timer: null
    })
    scheduleSessionClose(workspacePath, key, policy.idleMs)
    return
  }

  current.updatedAt = now
  current.eventCount += 1
  current.event = {
    ...current.event,
    ...event,
    occurredAt: current.event.occurredAt
  }
  scheduleSessionClose(workspacePath, key, policy.idleMs)
}

export function trackActivity(workspacePath: string | undefined, event: ActivityEventInput) {
  if (!workspacePath || !window.oneMind?.activity) return
  const policy = getPolicy(event)
  if (policy.type === "session") {
    trackSession(workspacePath, event, policy)
    return
  }

  enqueue(workspacePath, {
    kind: "instant",
    occurredAt: toLocalIsoString(),
    ...event
  })
}

export async function flushActivity(options: { closeSessions?: boolean } = {}) {
  if (options.closeSessions) {
    for (const [key, session] of Array.from(sessions.entries())) {
      closeSession(session.workspacePath, key)
    }
  }

  if (queue.length === 0) return
  const groups = new Map<string, ActivityEventInput[]>()
  for (const item of queue.splice(0)) {
    const events = groups.get(item.workspacePath) ?? []
    events.push(item.event)
    groups.set(item.workspacePath, events)
  }

  await Promise.all(Array.from(groups.entries()).map(async ([workspacePath, events]) => {
    try {
      await window.oneMind.activity.append(workspacePath, events)
    } catch {
      // Activity data is best-effort and must never block the primary workflow.
    }
  }))
}
