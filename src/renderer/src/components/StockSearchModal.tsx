import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Search, X } from 'lucide-react'

export interface StockSearchModalProps {
  open: boolean
  onClose: () => void
  onPick?: (item: StockSearchItem) => void
}

const DEBOUNCE_MS = 280

export const StockSearchModal: React.FC<StockSearchModalProps> = ({ open, onClose, onPick }) => {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<StockSearchItem[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const seqRef = useRef(0)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setItems([])
    setError(null)
    const t = window.setTimeout(() => inputRef.current?.focus(), 50)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q) {
      setItems([])
      setError(null)
      setLoading(false)
      return
    }
    const seq = ++seqRef.current
    setLoading(true)
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await window.api.searchStocks(q)
          if (seq !== seqRef.current) return
          if (res.ok && Array.isArray(res.data)) {
            setItems(res.data)
            setError(null)
          } else {
            setItems([])
            setError(res.error || '搜索失败')
          }
        } catch (e) {
          if (seq !== seqRef.current) return
          setItems([])
          setError(e instanceof Error ? e.message : String(e))
        } finally {
          if (seq === seqRef.current) setLoading(false)
        }
      })()
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query, open])

  if (!open) return null

  const openStock = (item: StockSearchItem) => {
    onClose()
    if (onPick) {
      onPick(item)
      return
    }
    navigate(`/stock/${encodeURIComponent(item.ts_code)}`)
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/55 p-4 pt-[12vh] backdrop-blur-[2px] no-drag animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="stock-search-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[70vh] w-full max-w-md flex-col rounded-2xl border border-[var(--fa-border)] bg-[var(--fa-sidebar)] text-[var(--fa-text)] shadow-2xl animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--fa-border-subtle)] px-4 py-3">
          <h2 id="stock-search-title" className="text-sm font-semibold">
            搜索股票
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

        <div className="border-b border-[var(--fa-border-subtle)] px-4 py-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--fa-faint)]"
              size={16}
            />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="输入代码或名称，如 600519 / 茅台"
              className="w-full rounded-xl border border-[var(--fa-border)] bg-[var(--fa-surface)] py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--fa-accent)]"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {loading && (
            <div className="flex items-center gap-2 px-3 py-4 text-sm text-[var(--fa-muted)]">
              <Loader2 className="animate-spin" size={16} />
              搜索中…
            </div>
          )}
          {!loading && error && <p className="px-3 py-3 text-sm text-red-400">{error}</p>}
          {!loading && !error && query.trim() && items.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-[var(--fa-faint)]">无匹配结果</p>
          )}
          {!loading &&
            items.map((item) => (
              <button
                key={item.ts_code}
                type="button"
                onClick={() => openStock(item)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-[var(--fa-surface-hover)]"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{item.name || '—'}</div>
                  <div className="font-mono text-[11px] text-[var(--fa-faint)]">{item.ts_code}</div>
                </div>
                {item.industry && (
                  <span className="shrink-0 text-[11px] text-[var(--fa-faint)]">{item.industry}</span>
                )}
              </button>
            ))}
          {!query.trim() && (
            <p className="px-3 py-6 text-center text-xs text-[var(--fa-faint)]">
              支持按股票代码或名称搜索
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export default StockSearchModal
