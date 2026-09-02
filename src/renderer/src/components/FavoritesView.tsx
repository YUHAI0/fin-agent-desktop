import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Bookmark, RefreshCw, Trash2 } from 'lucide-react'
import { useAppDialog } from '../contexts/AppDialogContext'
import SubPageShell from './SubPageShell'

const KIND_LABEL: Record<AnalysisReportKind, string> = {
  stock_checkup: '个股体检',
  portfolio_diagnose: '组合诊断',
  trade_memo: '买卖决策备忘录'
}

const DEPTH_LABEL: Record<AnalysisReportDepth, string> = {
  brief: '简版',
  standard: '适中',
  full: '完整'
}

const SECTION_ROWS: { key: keyof AnalysisReportSections; label: string }[] = [
  { key: 'conclusion', label: '结论' },
  { key: 'evidence', label: '依据' },
  { key: 'risk', label: '风险' },
  { key: 'next', label: '下一步' }
]

function formatFavoriteTime(ts: number): string {
  if (!ts) return ''
  const date = new Date(ts * 1000)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const FavoritesView: React.FC = () => {
  const navigate = useNavigate()
  const { alert, confirm } = useAppDialog()
  const [items, setItems] = useState<AnalysisFavoriteItem[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState(false)

  const loadItems = useCallback(async (keepId?: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await window.api.listAnalysisFavorites()
      if (!res?.ok) {
        setItems([])
        setSelectedId('')
        setError(res?.error || '加载收藏失败')
        return
      }
      const next = Array.isArray(res.items) ? res.items : []
      setItems(next)
      setSelectedId((prev) => {
        const preferred = keepId || prev
        return next.some((item) => item.id === preferred) ? preferred : next[0]?.id || ''
      })
    } catch (e) {
      setItems([])
      setSelectedId('')
      setError(e instanceof Error ? e.message : '加载收藏失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) || null,
    [items, selectedId]
  )

  const handleRemove = async () => {
    if (!selected || removing) return
    const ok = await confirm({
      title: '取消收藏',
      message: `从研报夹移除「${selected.title}」？`,
      confirmLabel: '取消收藏',
      danger: true
    })
    if (!ok) return
    setRemoving(true)
    try {
      const res = await window.api.deleteAnalysisFavorite(selected.id)
      if (!res?.ok) {
        await alert({ title: res?.error || '取消收藏失败' })
        return
      }
      const remaining = items.filter((item) => item.id !== selected.id)
      setItems(remaining)
      setSelectedId(remaining[0]?.id || '')
    } catch (e) {
      await alert({ title: e instanceof Error ? e.message : '取消收藏失败' })
    } finally {
      setRemoving(false)
    }
  }

  return (
    <SubPageShell>
      <div className="fa-page-header justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="cursor-pointer rounded-lg p-2 text-[var(--fa-muted)] transition-colors duration-200 hover:bg-[var(--fa-surface-hover)] hover:text-[var(--fa-text)]"
            title="返回"
            aria-label="返回"
          >
            <ArrowLeft size={18} />
          </button>
          <h1 className="truncate text-sm font-semibold">研报夹</h1>
          {items.length > 0 && (
            <span className="text-xs tabular-nums text-[var(--fa-faint)]">{items.length}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void loadItems(selectedId)}
          className="fa-icon-btn"
          title="刷新"
          aria-label="刷新研报夹"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {loading && items.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-[var(--fa-muted)]">正在加载…</p>
      ) : error && items.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-[var(--fa-muted)]">{error}</p>
      ) : items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <Bookmark size={22} className="text-[var(--fa-faint)]" aria-hidden />
          <p className="text-sm text-[var(--fa-muted)]">还没有收藏的报告</p>
          <p className="text-xs text-[var(--fa-faint)]">在分析卡片上点「收藏」，之后可以在这里回看</p>
        </div>
      ) : (
        <div className="fa-favorites-body">
          <aside className="fa-favorites-list" aria-label="收藏列表">
            {items.map((item) => {
              const active = item.id === selectedId
              return (
                <button
                  key={item.id}
                  type="button"
                  className={['fa-favorites-item', active ? 'fa-favorites-item-active' : ''].join(' ')}
                  onClick={() => setSelectedId(item.id)}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="fa-report-kind">{KIND_LABEL[item.kind] || item.kind}</span>
                    <span className="fa-report-depth">{DEPTH_LABEL[item.depth] || item.depth}</span>
                  </div>
                  <div className="mt-1.5 line-clamp-2 text-left text-sm font-medium leading-snug">
                    {item.title}
                  </div>
                  <div className="mt-1 text-left text-[11px] text-[var(--fa-faint)]">
                    {formatFavoriteTime(item.created_at)}
                    {item.symbols?.length ? ` · ${item.symbols.join(' / ')}` : ''}
                  </div>
                </button>
              )
            })}
          </aside>
          <section className="fa-favorites-detail" aria-label="报告详情">
            {selected ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="fa-report-kind">{KIND_LABEL[selected.kind] || selected.kind}</span>
                      <span className="fa-report-depth">
                        {DEPTH_LABEL[selected.depth] || selected.depth}
                      </span>
                    </div>
                    <h2 className="mt-2 text-base font-semibold leading-snug">{selected.title}</h2>
                    <p className="mt-1 text-xs text-[var(--fa-faint)]">
                      {formatFavoriteTime(selected.created_at)}
                      {selected.symbols?.length ? ` · ${selected.symbols.join(' / ')}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="fa-btn-ghost inline-flex items-center gap-1 px-3 py-1.5 text-xs hover:!text-[var(--fa-danger)]"
                    disabled={removing}
                    onClick={() => void handleRemove()}
                  >
                    <Trash2 size={14} aria-hidden />
                    取消收藏
                  </button>
                </div>
                <div className="mt-5 space-y-4">
                  {SECTION_ROWS.map((row) => (
                    <div key={row.key}>
                      <h3 className="mb-1.5 text-[11px] font-medium tracking-wide text-[var(--fa-faint)]">
                        {row.label}
                      </h3>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--fa-text)]">
                        {selected.sections?.[row.key] || '—'}
                      </p>
                    </div>
                  ))}
                </div>
                {selected.disclaimer ? (
                  <p className="mt-6 text-[11px] leading-relaxed text-[var(--fa-faint)]">
                    {selected.disclaimer}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-[var(--fa-muted)]">选择左侧一条报告查看</p>
            )}
          </section>
        </div>
      )}
    </SubPageShell>
  )
}

export default FavoritesView
