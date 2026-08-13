import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import PositionEditModal from './PositionEditModal'
import { useAppDialog } from '../contexts/AppDialogContext'
import { useChat } from '../contexts/ChatContext'
import { buildPortfolioDiagnosePrefill } from '../utils/chatPrefill'
import SubPageShell from './SubPageShell'

const money = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
const toneClass = (n: number) =>
  n > 0 ? 'text-red-400' : n < 0 ? 'text-emerald-400' : 'text-[var(--fa-muted)]'
const signed = (n: number) => `${n > 0 ? '+' : ''}${money(n)}`

const PortfolioView: React.FC = () => {
  const navigate = useNavigate()
  const { confirm, alert, prompt } = useAppDialog()
  const { requestPrefill } = useChat()
  const [portfolios, setPortfolios] = useState<PortfolioMeta[]>([])
  const [activeId, setActiveId] = useState<string>('')
  const [detail, setDetail] = useState<PortfolioDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create')
  const [editing, setEditing] = useState<PortfolioPosition | undefined>(undefined)

  const loadPortfolios = useCallback(async () => {
    const res = await window.api.listPortfolios()
    setPortfolios(res.portfolios)
    setActiveId((prev) => prev || res.active_portfolio_id)
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    if (!id) return
    setLoading(true)
    try {
      setDetail(await window.api.getPortfolioDetail(id))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPortfolios()
  }, [loadPortfolios])

  useEffect(() => {
    void loadDetail(activeId)
  }, [activeId, loadDetail])

  const refresh = () => {
    void loadPortfolios()
    void loadDetail(activeId)
  }

  const handleCreatePortfolio = async () => {
    const name = await prompt({
      title: '新建组合',
      placeholder: '输入组合名称'
    })
    if (!name) return
    const res = await window.api.createPortfolio(name)
    if (!res.success) {
      await alert({ title: '创建失败', message: res.error || '创建失败' })
      return
    }
    await loadPortfolios()
    if (res.id) setActiveId(res.id)
  }

  const handleDeletePortfolio = async () => {
    const current = portfolios.find((p) => p.id === activeId)
    if (!current) return
    const ok = await confirm({
      title: '删除组合',
      message: `确定删除组合「${current.name}」及其全部持仓？`,
      confirmLabel: '删除',
      danger: true
    })
    if (!ok) return
    const res = await window.api.deletePortfolio(activeId)
    if (!res.success) {
      await alert({ title: '删除失败', message: res.error || '删除失败' })
      return
    }
    setActiveId('')
    await loadPortfolios()
  }

  const handleDeletePosition = async (position: PortfolioPosition) => {
    const ok = await confirm({
      title: '删除持仓',
      message: `确定删除持仓 ${position.ts_code}？`,
      confirmLabel: '删除',
      danger: true
    })
    if (!ok) return
    const res = await window.api.deletePosition(activeId, position.ts_code)
    if (!res.success) {
      await alert({ title: '删除失败', message: res.error || '删除失败' })
      return
    }
    refresh()
  }

  const handleDiagnose = async () => {
    if (!detail?.positions.length) {
      await alert({ title: '请先添加持仓' })
      return
    }
    await requestPrefill(
      buildPortfolioDiagnosePrefill(detail.portfolio_id, detail.portfolio_name)
    )
  }

  const breakdown = detail?.breakdown
  const hasHoldings = Boolean(detail?.positions.length)

  return (
    <SubPageShell>
      <div className="fa-page-header justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="cursor-pointer rounded-lg p-2 text-[var(--fa-muted)] transition-colors duration-200 hover:bg-[var(--fa-surface-hover)] hover:text-[var(--fa-text)]"
            title="返回"
            aria-label="返回"
          >
            <ArrowLeft size={18} />
          </button>
          <h1 className="text-sm font-semibold">投资组合</h1>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void handleDiagnose()}
            className="fa-btn-ghost inline-flex items-center gap-1 px-3 py-1.5 text-xs"
          >
            <Sparkles size={14} aria-hidden />
            组合诊断
          </button>
          <button
            type="button"
            onClick={() => {
              setModalMode('create')
              setEditing(undefined)
              setModalOpen(true)
            }}
            className="fa-btn-primary inline-flex items-center gap-1 px-3 py-1.5 text-xs"
          >
            <Plus size={14} aria-hidden />
            添加持仓
          </button>
          <button
            type="button"
            onClick={() => void handleDeletePortfolio()}
            className="fa-btn-ghost px-3 py-1.5 text-xs hover:!text-[var(--fa-danger)]"
          >
            删除组合
          </button>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-[var(--fa-border-subtle)] px-4 py-2.5">
        {portfolios.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setActiveId(p.id)}
            className={[
              'cursor-pointer shrink-0 rounded-full px-3 py-1.5 text-xs transition-colors duration-200',
              p.id === activeId
                ? 'bg-[var(--fa-text)] text-[var(--fa-bg)]'
                : 'bg-[var(--fa-surface)] text-[var(--fa-muted)] hover:bg-[var(--fa-surface-hover)] hover:text-[var(--fa-text)]'
            ].join(' ')}
          >
            {p.name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void handleCreatePortfolio()}
          className="cursor-pointer shrink-0 rounded-full border border-dashed border-[var(--fa-border)] px-3 py-1.5 text-xs text-[var(--fa-faint)] transition-colors hover:border-[var(--fa-accent)] hover:text-[var(--fa-accent)]"
          title="新建组合"
          aria-label="新建组合"
        >
          <Plus size={14} />
        </button>
      </div>

      {detail && (
        <div className="flex shrink-0 gap-2 px-4 py-3">
          <div className="fa-card flex-1 px-3 py-2.5">
            <div className="text-[11px] text-[var(--fa-faint)]">总市值</div>
            <div className="text-base tabular-nums">¥ {money(detail.total_market_value)}</div>
          </div>
          <div className="fa-card flex-1 px-3 py-2.5">
            <div className="text-[11px] text-[var(--fa-faint)]">总盈亏 / 收益率</div>
            <div className={`text-base tabular-nums ${toneClass(detail.total_pnl)}`}>
              {signed(detail.total_pnl)} · {signed(detail.total_pnl_pct)}%
            </div>
          </div>
        </div>
      )}

      {!loading && hasHoldings && breakdown && (
        <div className="shrink-0 px-4 pb-3">
          <div className="fa-card px-3 py-2.5">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <span className="text-[11px] text-[var(--fa-faint)]">行业分布</span>
              <span className="text-[11px] tabular-nums text-[var(--fa-muted)]">
                前一 {breakdown.concentration.top1_pct.toFixed(1)}% · 前三 {breakdown.concentration.top3_pct.toFixed(1)}%
              </span>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[var(--fa-faint)]">
                  <th className="pb-1 text-left font-normal">行业</th>
                  <th className="pb-1 text-right font-normal">权重%</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.by_industry.map((row) => (
                  <tr key={row.industry}>
                    <td className="py-0.5">{row.industry}</td>
                    <td className="py-0.5 text-right tabular-nums">{row.weight_pct.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex-1 space-y-2 overflow-y-auto px-4 pb-4">
        {loading && (
          <p className="mt-6 text-center text-xs text-[var(--fa-faint)]">正在获取实时行情…</p>
        )}
        {!loading && detail?.positions.length === 0 && (
          <p className="mt-6 text-center text-xs text-[var(--fa-faint)]">这个组合还没有持仓</p>
        )}
        {!loading &&
          detail?.positions.map((position) => (
            <div
              key={position.ts_code}
              role="link"
              tabIndex={0}
              className="fa-card flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--fa-surface-hover)]"
              onClick={() => navigate(`/stock/${encodeURIComponent(position.ts_code)}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  navigate(`/stock/${encodeURIComponent(position.ts_code)}`)
                }
              }}
            >
              <div className="w-24 shrink-0">
                <div className="truncate text-sm font-medium">{position.name}</div>
                <div className="font-mono text-[11px] text-[var(--fa-faint)]">{position.ts_code}</div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-[var(--fa-faint)]">数量 / 成本</div>
                <div className="text-xs tabular-nums">
                  {position.amount} · {money(position.cost)}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-[var(--fa-faint)]">现价 / 市值</div>
                <div className="text-xs tabular-nums">
                  {money(position.current_price)}
                  {position.estimated ? '(估)' : ''} · {money(position.market_value)}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-[var(--fa-faint)]">买入 / 备注</div>
                <div className="truncate text-xs text-[var(--fa-muted)]">
                  {position.bought_at || '—'} · {position.note || '—'}
                </div>
              </div>
              <div className="w-20 shrink-0 text-right">
                <div className={`text-sm tabular-nums ${toneClass(position.pnl)}`}>
                  {signed(position.pnl)}
                </div>
                <div className={`text-[11px] tabular-nums ${toneClass(position.pnl)}`}>
                  {signed(position.pnl_pct)}%
                </div>
              </div>
              <div className="flex shrink-0 gap-0.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setModalMode('edit')
                    setEditing(position)
                    setModalOpen(true)
                  }}
                  title="编辑"
                  aria-label="编辑持仓"
                  className="cursor-pointer rounded-lg p-1.5 text-[var(--fa-muted)] transition-colors hover:bg-[var(--fa-surface-hover)] hover:text-[var(--fa-accent)]"
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleDeletePosition(position)
                  }}
                  title="删除"
                  aria-label="删除持仓"
                  className="cursor-pointer rounded-lg p-1.5 text-[var(--fa-muted)] transition-colors hover:bg-[var(--fa-surface-hover)] hover:text-[var(--fa-danger)]"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
      </div>

      <PositionEditModal
        open={modalOpen}
        mode={modalMode}
        portfolioId={activeId}
        initial={editing}
        onClose={() => setModalOpen(false)}
        onSaved={refresh}
      />
    </SubPageShell>
  )
}

export default PortfolioView
