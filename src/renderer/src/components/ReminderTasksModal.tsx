import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { X, Trash2, Loader2, AlertTriangle, Search, ChevronLeft, ChevronRight } from 'lucide-react'

const PAGE_SIZE = 10

export interface ReminderTasksModalProps {
  open: boolean
  onClose: () => void
}

type SchedulerTask = {
  id: string
  type?: string
  ts_code?: string
  operator?: string
  threshold?: number
  email?: string
  enabled?: boolean
  created_at?: number
  stock_name?: string | null
  current_price?: number | null
  change?: number | null
  pct_chg?: number | null
}

function formatCreated(ts: number | undefined): string {
  if (ts == null || !Number.isFinite(ts)) return '—'
  try {
    return new Date(ts * 1000).toLocaleString('zh-CN')
  } catch {
    return '—'
  }
}

function formatPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toFixed(2)
}

function formatPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

/** A 股习惯：涨红跌绿 */
function changeColorClass(change: number | null | undefined): string {
  if (change == null || !Number.isFinite(change) || change === 0) return 'text-[var(--fa-muted)]'
  return change > 0 ? 'text-red-400' : 'text-emerald-400'
}

function describeTask(t: SchedulerTask): string {
  if (t.type === 'price_alert' && t.ts_code && t.operator != null && t.threshold != null) {
    const name = t.stock_name ? `${t.stock_name} ` : ''
    return `${name}${t.ts_code} 价格 ${t.operator} ${t.threshold}`
  }
  return t.type ? `${t.type}（${t.id}）` : t.id
}

export const ReminderTasksModal: React.FC<ReminderTasksModalProps> = ({ open, onClose }) => {
  const [tasks, setTasks] = useState<SchedulerTask[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<SchedulerTask | null>(null)
  const [codeQuery, setCodeQuery] = useState('')
  const [page, setPage] = useState(1)

  const loadTasks = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.api.listSchedulerTasks()
      if (res.error && !Array.isArray(res.tasks)) {
        setTasks([])
        setError(res.error)
      } else if (Array.isArray(res.tasks)) {
        setTasks(res.tasks as SchedulerTask[])
      } else {
        setTasks([])
        setError('无法加载任务列表')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setTasks([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      setCodeQuery('')
      setPage(1)
      void loadTasks()
    } else {
      setPendingDelete(null)
    }
  }, [open, loadTasks])

  const filteredTasks = useMemo(() => {
    const q = codeQuery.trim().toLowerCase()
    if (!q) return tasks
    return tasks.filter((t) => {
      const code = (t.ts_code || '').toLowerCase()
      const id = (t.id || '').toLowerCase()
      const name = (t.stock_name || '').toLowerCase()
      return code.includes(q) || id.includes(q) || name.includes(q)
    })
  }, [tasks, codeQuery])

  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / PAGE_SIZE))
  const effectivePage = Math.min(Math.max(1, page), totalPages)
  const pagedTasks = useMemo(() => {
    const start = (effectivePage - 1) * PAGE_SIZE
    return filteredTasks.slice(start, start + PAGE_SIZE)
  }, [filteredTasks, effectivePage])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return
    const taskId = pendingDelete.id
    setPendingDelete(null)
    setDeletingId(taskId)
    setError(null)
    try {
      const res = await window.api.removeSchedulerTask(taskId)
      if (res.success && res.removed) {
        setTasks((prev) => prev.filter((t) => t.id !== taskId))
      } else if (res.success && !res.removed) {
        setError('未找到该任务，可能已被删除')
        await loadTasks()
      } else {
        setError(res.error || '删除失败')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeletingId(null)
    }
  }

  if (!open) return null

  return (
    <>
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px] no-drag animate-fade-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reminder-tasks-title"
        onClick={() => {
          if (pendingDelete) return
          onClose()
        }}
      >
        <div
          className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-[var(--fa-border)] bg-[var(--fa-sidebar)] text-[var(--fa-text)] shadow-2xl animate-scale-in"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-[var(--fa-border-subtle)] px-4 py-3">
            <h2 id="reminder-tasks-title" className="text-sm font-semibold">
              提醒任务
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-lg p-1.5 text-[var(--fa-muted)] transition-colors hover:bg-[var(--fa-surface-hover)] hover:text-[var(--fa-text)]"
              title="关闭"
              aria-label="关闭"
            >
              <X size={18} />
            </button>
          </div>

          <div className="space-y-2 border-b border-[var(--fa-border-subtle)] px-4 py-2">
            {error && <p className="text-sm text-red-400">{error}</p>}
            {loading && (
              <div className="flex items-center gap-2 py-2 text-sm text-[var(--fa-muted)]">
                <Loader2 className="animate-spin" size={16} />
                加载中…
              </div>
            )}
            {!loading && tasks.length > 0 && (
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--fa-faint)]"
                  size={16}
                  aria-hidden
                />
                <input
                  type="search"
                  value={codeQuery}
                  onChange={(e) => {
                    setCodeQuery(e.target.value)
                    setPage(1)
                  }}
                  placeholder="按名称或代码检索（如 平安、000001）"
                  className="fa-input !py-2 pl-9"
                  aria-label="按名称或代码检索提醒"
                />
              </div>
            )}
          </div>

          <div className="min-h-[120px] flex-1 overflow-y-auto px-4 py-3">
            {!loading && tasks.length === 0 && !error && (
              <p className="py-8 text-center text-sm text-[var(--fa-faint)]">暂无提醒任务</p>
            )}
            {!loading && tasks.length > 0 && filteredTasks.length === 0 && (
              <p className="py-8 text-center text-sm text-[var(--fa-faint)]">无匹配的提醒</p>
            )}
            {!loading && pagedTasks.length > 0 && (
              <ul className="space-y-2">
                {pagedTasks.map((t) => {
                  const chgClass = changeColorClass(t.change)
                  const hasQuote = t.current_price != null && Number.isFinite(t.current_price)
                  return (
                    <li key={t.id} className="fa-card flex items-start gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1 text-sm">
                        <div className="flex min-w-0 items-baseline gap-2">
                          <span className="truncate font-medium text-[var(--fa-text)]">
                            {t.stock_name || t.ts_code || '未知标的'}
                          </span>
                          {t.ts_code && t.stock_name && (
                            <span className="shrink-0 font-mono text-xs text-[var(--fa-faint)]">
                              {t.ts_code}
                            </span>
                          )}
                        </div>
                        <div
                          className={`mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 tabular-nums ${chgClass}`}
                        >
                          <span className="text-base font-semibold">
                            {hasQuote ? formatPrice(t.current_price) : '现价 —'}
                          </span>
                          {hasQuote && (
                            <span className="text-xs">
                              {t.change != null && Number.isFinite(t.change)
                                ? `${t.change > 0 ? '+' : ''}${t.change.toFixed(2)}`
                                : '—'}{' '}
                              ({formatPct(t.pct_chg)})
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5 text-xs text-[var(--fa-muted)]">
                          条件：价格 {t.operator} {t.threshold}
                          {t.email ? ` · ${t.email}` : ''}
                        </div>
                        <div className="mt-0.5 text-[11px] text-[var(--fa-faint)]">
                          创建：{formatCreated(t.created_at)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(t)}
                        disabled={deletingId === t.id || !!pendingDelete}
                        className="shrink-0 cursor-pointer rounded-lg p-2 text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                        title="删除"
                        aria-label="删除提醒"
                      >
                        {deletingId === t.id ? (
                          <Loader2 className="animate-spin" size={18} />
                        ) : (
                          <Trash2 size={18} />
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {!loading && filteredTasks.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--fa-border-subtle)] pt-3 text-xs text-[var(--fa-muted)]">
                <span>
                  共{' '}
                  <span className="font-medium text-[var(--fa-text)]">{filteredTasks.length}</span> 条
                  {codeQuery.trim() ? `（全部 ${tasks.length} 条）` : ''}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={effectivePage <= 1}
                    className="inline-flex cursor-pointer items-center rounded-lg border border-[var(--fa-border)] p-1.5 text-[var(--fa-muted)] transition-colors hover:bg-[var(--fa-surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                    title="上一页"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="min-w-[5.5rem] text-center tabular-nums">
                    第 {effectivePage} / {totalPages} 页
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={effectivePage >= totalPages}
                    className="inline-flex cursor-pointer items-center rounded-lg border border-[var(--fa-border)] p-1.5 text-[var(--fa-muted)] transition-colors hover:bg-[var(--fa-surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                    title="下一页"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-[var(--fa-border-subtle)] px-4 py-3">
            <button
              type="button"
              onClick={() => void loadTasks()}
              disabled={loading}
              className="fa-btn-ghost px-3 py-1.5 text-sm disabled:opacity-50"
            >
              刷新
            </button>
            <button type="button" onClick={onClose} className="fa-btn-primary px-3 py-1.5 text-sm">
              关闭
            </button>
          </div>
        </div>
      </div>

      {pendingDelete && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm no-drag animate-fade-in"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-confirm-title"
          aria-describedby="delete-confirm-desc"
          onClick={() => setPendingDelete(null)}
        >
          <div
            className="w-full max-w-sm overflow-hidden rounded-2xl border border-[var(--fa-border)] bg-[var(--fa-sidebar)] shadow-2xl animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pb-4 pt-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-400">
                  <AlertTriangle size={22} strokeWidth={2} />
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                  <h3 id="delete-confirm-title" className="text-base font-semibold text-[var(--fa-text)]">
                    删除提醒任务
                  </h3>
                  <p
                    id="delete-confirm-desc"
                    className="mt-2 text-sm leading-relaxed text-[var(--fa-muted)]"
                  >
                    确定删除该提醒？删除后无法恢复。
                  </p>
                  <p className="fa-card mt-3 px-3 py-2 text-sm font-medium text-[var(--fa-text)]">
                    {describeTask(pendingDelete)}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--fa-border-subtle)] bg-[var(--fa-surface)]/40 px-4 py-3">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="fa-btn-ghost px-4 py-2 text-sm"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDelete()}
                className="cursor-pointer rounded-xl bg-[var(--fa-danger)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
