import React, { useState } from 'react'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useAppDialog } from '../../contexts/AppDialogContext'
import { NEWS_SOURCE_LABELS, NEWS_TYPE_LABELS, formatWatchlistGroups } from '../../utils/news'
import NewsSubscriptionDialog from './NewsSubscriptionDialog'

interface NewsSubscriptionsTabProps {
  subscriptions: NewsSubscription[]
  loading: boolean
  error: string
  onChanged: () => void
}

const TYPE_ORDER: NewsSubscriptionType[] = ['sector', 'topic', 'portfolio', 'watchlist']

const NewsSubscriptionsTab: React.FC<NewsSubscriptionsTabProps> = ({
  subscriptions,
  loading,
  error,
  onChanged
}) => {
  const { confirm, alert } = useAppDialog()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create')
  const [editing, setEditing] = useState<NewsSubscription | undefined>(undefined)
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())

  const sorted = [...subscriptions].sort((a, b) => {
    const orderDiff = TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)
    if (orderDiff !== 0) return orderDiff
    return a.name.localeCompare(b.name, 'zh-CN')
  })

  const openCreate = () => {
    setDialogMode('create')
    setEditing(undefined)
    setDialogOpen(true)
  }

  const openEdit = (sub: NewsSubscription) => {
    setDialogMode('edit')
    setEditing(sub)
    setDialogOpen(true)
  }

  const handleToggle = async (sub: NewsSubscription) => {
    setTogglingIds((prev) => new Set(prev).add(sub.id))
    try {
      const res = await window.api.toggleNewsSubscription(sub.id, !sub.enabled)
      if (!res.success) {
        await alert({ title: '操作失败', message: res.error || '切换启用状态失败' })
      } else {
        onChanged()
      }
    } catch (e) {
      await alert({ title: '操作失败', message: e instanceof Error ? e.message : '切换启用状态失败' })
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev)
        next.delete(sub.id)
        return next
      })
    }
  }

  const handleDelete = async (sub: NewsSubscription) => {
    const ok = await confirm({
      title: '删除订阅',
      message: `确定删除订阅「${sub.name}」？删除后将不再收到相关新闻提醒。`,
      confirmLabel: '删除',
      danger: true
    })
    if (!ok) return
    setDeletingIds((prev) => new Set(prev).add(sub.id))
    try {
      const res = await window.api.deleteNewsSubscription(sub.id)
      if (!res.success) {
        await alert({ title: '删除失败', message: res.error || '删除失败' })
      } else {
        onChanged()
      }
    } catch (e) {
      await alert({ title: '删除失败', message: e instanceof Error ? e.message : '删除失败' })
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev)
        next.delete(sub.id)
        return next
      })
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--fa-border-subtle)] px-4 py-3">
        <p className="min-w-0 flex-1 text-xs text-[var(--fa-muted)]">
          按板块、主题或持仓组合订阅新闻，命中后计入未读并弹出系统通知
        </p>
        <button
          type="button"
          onClick={openCreate}
          className="fa-btn-primary inline-flex shrink-0 items-center gap-1 px-3 py-1.5 text-xs"
        >
          <Plus size={14} aria-hidden />
          新增订阅
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--fa-muted)]">
            <Loader2 className="animate-spin" size={16} />
            正在加载订阅…
          </div>
        )}
        {!loading && error && <p className="py-8 text-center text-sm text-[var(--fa-danger)]">{error}</p>}
        {!loading && !error && sorted.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="text-sm text-[var(--fa-muted)]">还没有订阅</p>
            <p className="fa-hint">新增板块、主题或组合订阅，第一时间获取相关新闻</p>
          </div>
        )}
        {!loading && sorted.length > 0 && (
          <ul className="space-y-2">
            {sorted.map((sub) => {
              const toggling = togglingIds.has(sub.id)
              const deleting = deletingIds.has(sub.id)
              return (
                <li key={sub.id} className="fa-card px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-[var(--fa-text)]">{sub.name}</span>
                        <span className="fa-news-tag">{NEWS_TYPE_LABELS[sub.type]}</span>
                        {!sub.enabled && (
                          <span className="rounded-full bg-[var(--fa-border)] px-2 py-0.5 text-[11px] text-[var(--fa-faint)]">
                            已停用
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {sub.sources.map((source) => (
                          <span key={source} className="fa-news-tag">
                            {NEWS_SOURCE_LABELS[source] || source}
                          </span>
                        ))}
                      </div>
                      <div className="mt-1.5 break-words text-xs leading-relaxed text-[var(--fa-muted)]">
                        {sub.type === 'watchlist' ? (
                          <span>
                            自动跟随自选：{formatWatchlistGroups(sub.groups)}
                            {sub.keywords.length > 0 ? `，并需包含：${sub.keywords.join('、')}` : ''}
                          </span>
                        ) : sub.type === 'portfolio' ? (
                          <span>
                            自动跟随全部组合的当前持仓
                            {sub.keywords.length > 0 ? `，并需包含：${sub.keywords.join('、')}` : ''}
                          </span>
                        ) : (
                          <>
                            {sub.keywords.length > 0 && <span>包含：{sub.keywords.join('、')}</span>}
                            {sub.exclude_keywords.length > 0 && (
                              <span className="ml-3">排除：{sub.exclude_keywords.join('、')}</span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void handleToggle(sub)}
                        disabled={toggling}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          sub.enabled ? 'fa-toggle-on' : 'fa-toggle-off'
                        }`}
                        title={sub.enabled ? '停用订阅' : '启用订阅'}
                        aria-label={sub.enabled ? '停用订阅' : '启用订阅'}
                        aria-pressed={sub.enabled}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                            sub.enabled ? 'translate-x-[18px]' : 'translate-x-1'
                          }`}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(sub)}
                        className="cursor-pointer rounded-lg p-1.5 text-[var(--fa-muted)] transition-colors hover:bg-[var(--fa-surface-hover)] hover:text-[var(--fa-accent)]"
                        title="编辑"
                        aria-label="编辑订阅"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(sub)}
                        disabled={deleting}
                        className="cursor-pointer rounded-lg p-1.5 text-[var(--fa-muted)] transition-colors hover:bg-[var(--fa-surface-hover)] hover:text-[var(--fa-danger)] disabled:cursor-not-allowed disabled:opacity-50"
                        title="删除"
                        aria-label="删除订阅"
                      >
                        {deleting ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <NewsSubscriptionDialog
        open={dialogOpen}
        mode={dialogMode}
        initial={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={() => {
          setDialogOpen(false)
          onChanged()
        }}
      />
    </div>
  )
}

export default NewsSubscriptionsTab
