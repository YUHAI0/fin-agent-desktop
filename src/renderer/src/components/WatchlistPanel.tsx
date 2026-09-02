import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { useAppDialog } from '../contexts/AppDialogContext'
import FaSelect from './FaSelect'
import StockSearchModal from './StockSearchModal'

const GROUP_OPTIONS: { value: WatchlistGroup; label: string }[] = [
  { value: 'candidate', label: '候选买入' },
  { value: 'track', label: '长期跟踪' }
]

const money = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
}

const toneClass = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n) || n === 0) return 'text-[var(--fa-muted)]'
  return n > 0 ? 'text-red-400' : 'text-emerald-400'
}

const signedPct = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

export const WatchlistPanel: React.FC = () => {
  const navigate = useNavigate()
  const { alert, confirm, prompt } = useAppDialog()
  const [items, setItems] = useState<WatchlistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [pending, setPending] = useState<StockSearchItem | null>(null)
  const [busyId, setBusyId] = useState('')

  const loadItems = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await window.api.listWatchlist()
      if (!res?.ok) {
        setItems([])
        setError(res?.error || '加载自选失败')
        return
      }
      setItems(Array.isArray(res.items) ? res.items : [])
    } catch (e) {
      setItems([])
      setError(e instanceof Error ? e.message : '加载自选失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  const grouped = useMemo(() => {
    const candidate = items.filter((it) => it.group === 'candidate')
    const track = items.filter((it) => it.group === 'track')
    return { candidate, track }
  }, [items])

  const addWithGroup = async (stock: StockSearchItem, group: WatchlistGroup) => {
    try {
      const res = await window.api.addWatchlist({
        ts_code: stock.ts_code,
        group,
        name: stock.name || undefined
      })
      if (!res?.ok) {
        await alert({ title: res?.error || '加入自选失败' })
        return
      }
      setPending(null)
      await loadItems()
    } catch (e) {
      await alert({ title: e instanceof Error ? e.message : '加入自选失败' })
    }
  }

  const handleGroup = async (item: WatchlistItem, group: string) => {
    if (group !== 'candidate' && group !== 'track') return
    if (group === item.group) return
    setBusyId(item.id)
    try {
      const res = await window.api.setWatchlistGroup({ id: item.id, group })
      if (!res?.ok) {
        await alert({ title: res?.error || '改组失败' })
        return
      }
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, group } : it)))
    } catch (e) {
      await alert({ title: e instanceof Error ? e.message : '改组失败' })
    } finally {
      setBusyId('')
    }
  }

  const handlePct = async (item: WatchlistItem) => {
    const raw = await prompt({
      title: '异动阈值（%）',
      defaultValue: String(item.alert_pct || 5),
      placeholder: '1 到 20 的整数'
    })
    if (raw == null) return
    const pct = Number.parseInt(raw, 10)
    if (!Number.isInteger(pct) || pct < 1 || pct > 20) {
      await alert({ title: '阈值须为 1 到 20 的整数' })
      return
    }
    setBusyId(item.id)
    try {
      const res = await window.api.setWatchlistAlertPct({ id: item.id, pct })
      if (!res?.ok) {
        await alert({ title: res?.error || '改阈值失败' })
        return
      }
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, alert_pct: pct } : it)))
    } catch (e) {
      await alert({ title: e instanceof Error ? e.message : '改阈值失败' })
    } finally {
      setBusyId('')
    }
  }

  const handleRemove = async (item: WatchlistItem) => {
    const ok = await confirm({
      title: '移出自选',
      message: `从自选移除「${item.name || item.ts_code}」？异动提醒会一并取消。`,
      confirmLabel: '移除',
      danger: true
    })
    if (!ok) return
    setBusyId(item.id)
    try {
      const res = await window.api.removeWatchlist(item.id)
      if (!res?.ok) {
        await alert({ title: res?.error || '移除失败' })
        return
      }
      setItems((prev) => prev.filter((it) => it.id !== item.id))
    } catch (e) {
      await alert({ title: e instanceof Error ? e.message : '移除失败' })
    } finally {
      setBusyId('')
    }
  }

  const renderRow = (item: WatchlistItem) => (
    <div
      key={item.id}
      role="link"
      tabIndex={0}
      className="fa-card flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--fa-surface-hover)]"
      onClick={() => navigate(`/stock/${encodeURIComponent(item.ts_code)}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          navigate(`/stock/${encodeURIComponent(item.ts_code)}`)
        }
      }}
    >
      <div className="min-w-0 w-28 shrink-0">
        <div className="truncate text-sm font-medium">{item.name || item.ts_code}</div>
        <div className="font-mono text-[11px] text-[var(--fa-faint)]">{item.ts_code}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-[var(--fa-faint)]">现价</div>
        <div className="text-xs tabular-nums">{money(item.price)}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-[var(--fa-faint)]">今日涨跌</div>
        <div className={`text-xs tabular-nums ${toneClass(item.pct_chg)}`}>{signedPct(item.pct_chg)}</div>
      </div>
      <div
        className="w-[7.5rem] shrink-0"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <FaSelect
          value={item.group}
          options={GROUP_OPTIONS}
          disabled={busyId === item.id}
          aria-label="分组"
          onChange={(value) => void handleGroup(item, value)}
        />
      </div>
      <button
        type="button"
        className="fa-btn-ghost shrink-0 px-2 py-1 text-[11px] tabular-nums"
        disabled={busyId === item.id}
        onClick={(e) => {
          e.stopPropagation()
          void handlePct(item)
        }}
      >
        ±{item.alert_pct}%
      </button>
      <button
        type="button"
        className="cursor-pointer rounded-lg p-1.5 text-[var(--fa-muted)] transition-colors hover:bg-[var(--fa-surface-hover)] hover:text-[var(--fa-danger)]"
        disabled={busyId === item.id}
        title="移除"
        aria-label="移出自选"
        onClick={(e) => {
          e.stopPropagation()
          void handleRemove(item)
        }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  )

  const renderSection = (key: WatchlistGroup, rows: WatchlistItem[]) => (
    <section className="space-y-2">
      <h2 className="px-0.5 text-[11px] font-medium tracking-wide text-[var(--fa-faint)]">
        {GROUP_OPTIONS.find((o) => o.value === key)?.label}
      </h2>
      {rows.length === 0 ? (
        <p className="px-0.5 text-xs text-[var(--fa-faint)]">暂无</p>
      ) : (
        rows.map(renderRow)
      )}
    </section>
  )

  return (
    <>
      <div className="flex shrink-0 justify-end px-4 py-2">
        <button
          type="button"
          className="fa-btn-primary inline-flex items-center gap-1 px-3 py-1.5 text-xs"
          onClick={() => setSearchOpen(true)}
        >
          <Plus size={14} aria-hidden />
          添加自选
        </button>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
        {loading && items.length === 0 ? (
          <p className="mt-6 text-center text-xs text-[var(--fa-faint)]">正在加载…</p>
        ) : error && items.length === 0 ? (
          <p className="mt-6 text-center text-xs text-[var(--fa-muted)]">{error}</p>
        ) : items.length === 0 ? (
          <p className="mt-6 text-center text-xs text-[var(--fa-faint)]">还没有自选股，点右上角「添加自选」</p>
        ) : (
          <>
            {renderSection('candidate', grouped.candidate)}
            {renderSection('track', grouped.track)}
          </>
        )}
      </div>

      <StockSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onPick={(item) => {
          setSearchOpen(false)
          setPending(item)
        }}
      />

      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
            onClick={() => setPending(null)}
            aria-hidden
          />
          <div
            className="relative w-full max-w-[360px] rounded-2xl border border-[var(--fa-border)] bg-[var(--fa-sidebar)] p-5 shadow-2xl animate-scale-in"
            role="dialog"
            aria-modal="true"
            aria-labelledby="watchlist-group-title"
          >
            <h3 id="watchlist-group-title" className="mb-1 text-sm font-semibold">
              加入观察
            </h3>
            <p className="mb-4 text-xs text-[var(--fa-muted)]">
              {pending.name} {pending.ts_code}
            </p>
            <div className="flex flex-col gap-2">
              {GROUP_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className="fa-btn-ghost w-full px-3 py-2 text-left text-sm"
                  onClick={() => void addWithGroup(pending, opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default WatchlistPanel
