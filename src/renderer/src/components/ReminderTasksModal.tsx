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
}

function formatCreated(ts: number | undefined): string {
  if (ts == null || !Number.isFinite(ts)) return '—'
  try {
    return new Date(ts * 1000).toLocaleString('zh-CN')
  } catch {
    return '—'
  }
}

function describeTask(t: SchedulerTask): string {
  if (t.type === 'price_alert' && t.ts_code && t.operator != null && t.threshold != null) {
    return `${t.ts_code} 价格 ${t.operator} ${t.threshold}`
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
      return code.includes(q) || id.includes(q)
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
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm no-drag"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reminder-tasks-title"
      onClick={() => {
        if (pendingDelete) return
        onClose()
      }}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-xl border border-gray-700 bg-gray-900 shadow-xl text-gray-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <h2 id="reminder-tasks-title" className="text-base font-semibold">
            提醒任务
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            title="关闭"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-4 py-2 border-b border-gray-800/80 space-y-2">
          {error && <p className="text-sm text-red-400">{error}</p>}
          {loading && (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
              <Loader2 className="animate-spin" size={16} />
              加载中…
            </div>
          )}
          {!loading && tasks.length > 0 && (
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500"
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
                placeholder="按标的代码检索（如 600519、000001）"
                className="w-full rounded-lg border border-gray-700 bg-gray-950 py-2 pl-9 pr-3 text-sm text-gray-200 placeholder:text-gray-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
                aria-label="按代码检索提醒"
              />
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 min-h-[120px]">
          {!loading && tasks.length === 0 && !error && (
            <p className="text-sm text-gray-500 text-center py-8">暂无提醒任务</p>
          )}
          {!loading && tasks.length > 0 && filteredTasks.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-8">无匹配代码的提醒</p>
          )}
          {!loading && pagedTasks.length > 0 && (
            <ul className="space-y-2">
              {pagedTasks.map((t) => (
                <li
                  key={t.id}
                  className="flex gap-3 items-start rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2.5"
                >
                  <div className="flex-1 min-w-0 text-sm">
                    <div className="font-medium text-gray-200 truncate">{describeTask(t)}</div>
                    <div className="mt-1 text-xs text-gray-500 space-y-0.5">
                      <div>
                        状态：{t.enabled !== false ? '启用' : '已停用'}
                        {t.email ? ` · 通知邮箱：${t.email}` : ''}
                      </div>
                      <div className="font-mono text-[11px] opacity-80 truncate" title={t.id}>
                        ID：{t.id}
                      </div>
                      <div>创建：{formatCreated(t.created_at)}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(t)}
                    disabled={deletingId === t.id || !!pendingDelete}
                    className="shrink-0 p-2 rounded-lg text-red-400 hover:bg-red-950/40 hover:text-red-300 disabled:opacity-50 transition-colors"
                    title="删除"
                  >
                    {deletingId === t.id ? (
                      <Loader2 className="animate-spin" size={18} />
                    ) : (
                      <Trash2 size={18} />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!loading && filteredTasks.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-gray-800/80 pt-3 text-xs text-gray-400">
              <span>
                共 <span className="font-medium text-gray-300">{filteredTasks.length}</span> 条
                {codeQuery.trim() ? `（全部 ${tasks.length} 条）` : ''}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={effectivePage <= 1}
                  className="inline-flex items-center rounded-lg border border-gray-600 p-1.5 text-gray-300 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
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
                  className="inline-flex items-center rounded-lg border border-gray-600 p-1.5 text-gray-300 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                  title="下一页"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-gray-800 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => void loadTasks()}
            disabled={loading}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            刷新
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500"
          >
            关闭
          </button>
        </div>
      </div>
    </div>

    {pendingDelete && (
      <div
        className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm no-drag"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-confirm-title"
        aria-describedby="delete-confirm-desc"
        onClick={() => setPendingDelete(null)}
      >
        <div
          className="w-full max-w-sm rounded-xl border border-gray-600 bg-gray-900 shadow-2xl overflow-hidden ring-1 ring-white/10"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-5 pt-5 pb-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-950/60 text-red-400">
                <AlertTriangle size={22} strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <h3 id="delete-confirm-title" className="text-base font-semibold text-gray-100">
                  删除提醒任务
                </h3>
                <p id="delete-confirm-desc" className="mt-2 text-sm text-gray-400 leading-relaxed">
                  确定删除该提醒？删除后无法恢复。
                </p>
                <p className="mt-3 rounded-lg border border-gray-700/80 bg-gray-950/80 px-3 py-2 text-sm font-medium text-gray-200">
                  {describeTask(pendingDelete)}
                </p>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-gray-800 bg-gray-950/50 px-4 py-3">
            <button
              type="button"
              onClick={() => setPendingDelete(null)}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800 transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmDelete()}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors shadow-sm"
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
