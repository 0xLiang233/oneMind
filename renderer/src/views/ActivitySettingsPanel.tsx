import { type CSSProperties, useEffect, useMemo, useState } from "react"
import { flushActivity } from "../activity"

const moduleMeta: Record<string, { label: string; tone: string }> = {
  notes: { label: "写作", tone: "mint" },
  quickNote: { label: "记录", tone: "rose" },
  floatTool: { label: "工具", tone: "blue" },
  systemApp: { label: "应用", tone: "blue" },
  miniapp: { label: "小程序", tone: "violet" },
  search: { label: "搜索", tone: "amber" },
  ai: { label: "AI", tone: "violet" },
  settings: { label: "设置", tone: "slate" }
}

const actionLabels: Record<string, string> = {
  create: "创建",
  open: "打开",
  save: "保存",
  edit: "编辑",
  show: "唤起",
  search: "搜索",
  update: "修改"
}

function formatDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function getMondayWeekdayIndex(date: Date) {
  return (date.getDay() + 6) % 7
}

function getMondayOfWeek(date: Date) {
  return addDays(date, -getMondayWeekdayIndex(date))
}

function getSundayOfWeek(date: Date) {
  return addDays(getMondayOfWeek(date), 6)
}

function getDayLabel(date: string) {
  const parsed = new Date(date + "T00:00:00")
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日`
}

function getTimeLabel(value?: string) {
  if (!value) return ""
  const date = new Date(value)
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
}

function getModuleLabel(module: string) {
  return moduleMeta[module]?.label ?? module
}

function getActivityCopy(event: ActivityEvent) {
  const moduleLabel = getModuleLabel(event.module)
  const action = actionLabels[event.action] ?? event.action
  if (event.targetLabel) return `${action} ${event.targetLabel}`
  return `${moduleLabel}${action}`
}

function getIntensity(score: number) {
  if (score <= 0) return 0
  if (score <= 3) return 1
  if (score <= 8) return 2
  if (score <= 16) return 3
  return 4
}

function buildHeatmapDays(startDate: string, endDate: string) {
  const start = new Date(startDate + "T00:00:00")
  const end = new Date(endDate + "T00:00:00")
  const days: string[] = []
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    days.push(formatDate(cursor))
  }
  return days
}

function getDayScore(day: ActivityDaySummary | undefined, moduleFilter: string) {
  if (!day) return 0
  return moduleFilter === "all" ? day.score : day.moduleCounts[moduleFilter] ?? 0
}

type ActivitySettingsPanelProps = {
  workspacePath: string
}

export function ActivitySettingsPanel({ workspacePath }: ActivitySettingsPanelProps) {
  const today = useMemo(() => formatDate(new Date()), [])
  const startDate = useMemo(() => formatDate(getMondayOfWeek(addDays(new Date(), -90))), [])
  const displayEndDate = useMemo(() => formatDate(addDays(getSundayOfWeek(new Date()), 7)), [])
  const [report, setReport] = useState<ActivityReport | null>(null)
  const [selectedDate, setSelectedDate] = useState(today)
  const [moduleFilter, setModuleFilter] = useState("all")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!workspacePath) return
    let disposed = false
    async function loadReport() {
      setLoading(true)
      await flushActivity()
      const nextReport = await window.oneMind.activity.report(workspacePath, startDate, today)
      if (disposed) return
      setReport(nextReport)
      if (!nextReport.days.some((day) => day.date === selectedDate)) {
        const lastDay = nextReport.days[nextReport.days.length - 1]
        if (lastDay) setSelectedDate(lastDay.date)
      }
      setLoading(false)
    }
    void loadReport().catch(() => {
      if (!disposed) setLoading(false)
    })
    return () => {
      disposed = true
    }
  }, [selectedDate, startDate, today, workspacePath])

  const dayMap = useMemo(() => {
    const map = new Map<string, ActivityDaySummary>()
    report?.days.forEach((day) => map.set(day.date, day))
    return map
  }, [report])

  const modules = useMemo(() => {
    const entries = Object.entries(report?.totals.moduleCounts ?? {})
      .sort((left, right) => right[1] - left[1])
      .map(([module]) => module)
    return ["all", ...entries]
  }, [report])

  const heatmapDays = useMemo(() => buildHeatmapDays(startDate, displayEndDate), [displayEndDate, startDate])

  const calendarWeekCount = useMemo(() => Math.ceil(heatmapDays.length / 7), [heatmapDays])

  const moduleSummary = useMemo(() => {
    const counts = report?.totals.moduleCounts ?? {}
    const maxCount = Math.max(1, ...Object.values(counts))
    return Object.entries(counts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([module, count]) => ({
        module,
        count,
        share: Math.max(8, Math.round((count / maxCount) * 100))
      }))
  }, [report])

  const selectedEvents = useMemo(() => {
    const events = report?.events ?? []
    return events
      .filter((event) => event.occurredAt.startsWith(selectedDate))
      .filter((event) => moduleFilter === "all" || event.module === moduleFilter)
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
  }, [moduleFilter, report, selectedDate])

  const selectedSummary = dayMap.get(selectedDate)
  const totalEvents = report?.totals.totalEvents ?? 0
  const activeDays = report?.totals.activeDays ?? 0
  const streak = report?.totals.currentStreakDays ?? 0

  return (
    <div className="activity-settings-panel">
      <div className="activity-hero">
        <div>
          <p>最近 3 个月的使用节奏、功能分布和操作记录。</p>
        </div>
      </div>

      <section className="activity-metrics" aria-label="活跃概览">
        <div className="activity-metric">
          <span>操作</span>
          <strong>{totalEvents}</strong>
        </div>
        <div className="activity-metric">
          <span>天数</span>
          <strong>{activeDays}</strong>
        </div>
        <div className="activity-metric">
          <span>连续</span>
          <strong>{streak}</strong>
        </div>
      </section>

      <section className="activity-overview-grid">
        <div className="activity-card activity-rhythm-card">
          <div className="activity-card-header">
            <div>
              <h3>每日活跃</h3>
              <p>{loading ? "正在更新活跃记录..." : `${startDate} - ${today}`}</p>
            </div>
            <div className="activity-filter-row">
              {modules.map((module) => (
                <button
                  key={module}
                  type="button"
                  className={moduleFilter === module ? "activity-filter active" : "activity-filter"}
                  onClick={() => setModuleFilter(module)}
                >
                  {module === "all" ? "全部" : getModuleLabel(module)}
                </button>
              ))}
            </div>
          </div>
          <div
            className="activity-calendar"
            aria-label="每日活跃热力图"
            style={{ "--activity-weeks": calendarWeekCount } as CSSProperties}
          >
            {heatmapDays.map((date) => {
              const score = getDayScore(dayMap.get(date), moduleFilter)
              const isFuture = date > today
              return (
                <button
                  key={date}
                  type="button"
                  className={[
                    "activity-day",
                    selectedDate === date ? "active" : "",
                    isFuture ? "future" : ""
                  ].filter(Boolean).join(" ")}
                  data-level={getIntensity(score)}
                  title={isFuture ? `${date} · 预设` : `${date} · ${score} 次`}
                  disabled={isFuture}
                  onClick={() => !isFuture && setSelectedDate(date)}
                />
              )
            })}
          </div>
          <div className="activity-legend">
            <span>低频</span>
            <i data-level="1" />
            <i data-level="2" />
            <i data-level="3" />
            <i data-level="4" />
            <span>高频</span>
          </div>
        </div>

        <div className="activity-card activity-modules-card">
          <div className="activity-card-header compact">
            <div>
              <h3>功能分布</h3>
              <p>按记录次数排序</p>
            </div>
          </div>
          <div className="activity-module-list">
            {moduleSummary.map((item) => (
              <button
                key={item.module}
                type="button"
                className={moduleFilter === item.module ? "activity-module-row active" : "activity-module-row"}
                onClick={() => setModuleFilter(item.module)}
              >
                <span className={"activity-module " + (moduleMeta[item.module]?.tone ?? "slate")}>
                  {getModuleLabel(item.module)}
                </span>
                <span className="activity-module-track">
                  <i style={{ "--activity-share": `${item.share}%` } as CSSProperties} />
                </span>
                <strong>{item.count}</strong>
              </button>
            ))}
            {moduleSummary.length === 0 ? <div className="activity-empty compact">暂无功能记录。</div> : null}
          </div>
        </div>
      </section>

      <section className="activity-card activity-timeline-card">
        <div className="activity-card-header compact">
          <div>
            <h3>{selectedDate}</h3>
            <p>
              {selectedSummary
                ? Object.entries(selectedSummary.moduleCounts).map(([module, count]) => `${getModuleLabel(module)} ${count}`).join(" · ")
                : "这一天还没有活跃记录。"}
            </p>
          </div>
          <span className="activity-date-chip">{getDayLabel(selectedDate)}</span>
        </div>
        <div className="activity-timeline">
          {selectedEvents.map((event) => (
            <article className="activity-timeline-item" key={event.id}>
              <time>{getTimeLabel(event.startedAt ?? event.occurredAt)}</time>
              <span className={"activity-module " + (moduleMeta[event.module]?.tone ?? "slate")}>
                {getModuleLabel(event.module)}
              </span>
              <div>
                <strong>{getActivityCopy(event)}</strong>
                {event.kind === "session" && event.endedAt ? (
                  <small>{getTimeLabel(event.startedAt)} - {getTimeLabel(event.endedAt)}</small>
                ) : null}
              </div>
            </article>
          ))}
          {selectedEvents.length === 0 ? (
            <div className="activity-empty">开始创建笔记、打开工具或使用小程序后，这里会显示你的使用节奏。</div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
