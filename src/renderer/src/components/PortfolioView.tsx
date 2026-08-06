import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PositionEditModal from './PositionEditModal'

const money = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
const toneClass = (n: number) => (n > 0 ? 'text-red-500' : n < 0 ? 'text-green-500' : 'text-gray-500')
const signed = (n: number) => `${n > 0 ? '+' : ''}${money(n)}`

const PortfolioView: React.FC = () => {
  const navigate = useNavigate()
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
    const name = window.prompt('新组合名称')
    if (!name) return
    const res = await window.api.createPortfolio(name)
    if (!res.success) return window.alert(res.error || '创建失败')
    await loadPortfolios()
    if (res.id) setActiveId(res.id)
  }

  const handleDeletePortfolio = async () => {
    const current = portfolios.find((p) => p.id === activeId)
    if (!current) return
    if (!window.confirm(`确定删除组合「${current.name}」及其全部持仓？`)) return
    const res = await window.api.deletePortfolio(activeId)
    if (!res.success) return window.alert(res.error || '删除失败')
    setActiveId('')
    await loadPortfolios()
  }

  const handleDeletePosition = async (position: PortfolioPosition) => {
    if (!window.confirm(`确定删除持仓 ${position.ts_code}？`)) return
    const res = await window.api.deletePosition(activeId, position.ts_code)
    if (!res.success) return window.alert(res.error || '删除失败')
    refresh()
  }

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200">
      <div className="flex items-center justify-between h-12 px-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <button onClick={() => navigate(-1)} className="text-sm text-gray-500 hover:text-gray-800">
          ← 投资组合
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setModalMode('create')
              setEditing(undefined)
              setModalOpen(true)
            }}
            className="px-3 py-1 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded"
          >
            ＋ 添加持仓
          </button>
          <button
            onClick={() => void handleDeletePortfolio()}
            className="px-3 py-1 text-xs text-gray-500 hover:text-red-500 border rounded dark:border-gray-700"
          >
            删除组合
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto shrink-0">
        {portfolios.map((p) => (
          <button
            key={p.id}
            onClick={() => setActiveId(p.id)}
            className={[
              'px-3 py-1 text-xs rounded shrink-0',
              p.id === activeId
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
            ].join(' ')}
          >
            {p.name}
          </button>
        ))}
        <button
          onClick={() => void handleCreatePortfolio()}
          className="px-3 py-1 text-xs text-gray-500 border border-dashed rounded shrink-0 dark:border-gray-600"
        >
          ＋
        </button>
      </div>

      {detail && (
        <div className="flex gap-2 px-4 pb-2 shrink-0">
          <div className="flex-1 px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded border dark:border-gray-700">
            <div className="text-[11px] text-gray-500">总市值</div>
            <div className="text-base">¥ {money(detail.total_market_value)}</div>
          </div>
          <div className="flex-1 px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded border dark:border-gray-700">
            <div className="text-[11px] text-gray-500">总盈亏 / 收益率</div>
            <div className={`text-base ${toneClass(detail.total_pnl)}`}>
              {signed(detail.total_pnl)} · {signed(detail.total_pnl_pct)}%
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        {loading && <p className="text-xs text-gray-400 text-center mt-6">正在获取实时行情…</p>}
        {!loading && detail?.positions.length === 0 && (
          <p className="text-xs text-gray-400 text-center mt-6">这个组合还没有持仓</p>
        )}
        {!loading &&
          detail?.positions.map((position) => (
            <div
              key={position.ts_code}
              className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border dark:border-gray-700 rounded"
            >
              <div className="w-24 shrink-0">
                <div className="text-sm font-medium truncate">{position.name}</div>
                <div className="text-[11px] text-gray-500">{position.ts_code}</div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-gray-500">数量 / 成本</div>
                <div className="text-xs">
                  {position.amount} · {money(position.cost)}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-gray-500">现价 / 市值</div>
                <div className="text-xs">
                  {money(position.current_price)}
                  {position.estimated ? '(估)' : ''} · {money(position.market_value)}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-gray-500">买入 / 备注</div>
                <div className="text-xs truncate">
                  {position.bought_at || '—'} · {position.note || '—'}
                </div>
              </div>
              <div className="w-20 text-right shrink-0">
                <div className={`text-sm ${toneClass(position.pnl)}`}>{signed(position.pnl)}</div>
                <div className={`text-[11px] ${toneClass(position.pnl)}`}>{signed(position.pnl_pct)}%</div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => {
                    setModalMode('edit')
                    setEditing(position)
                    setModalOpen(true)
                  }}
                  title="编辑"
                  className="px-1 text-xs text-gray-500 hover:text-blue-500"
                >
                  ✎
                </button>
                <button
                  onClick={() => void handleDeletePosition(position)}
                  title="删除"
                  className="px-1 text-xs text-gray-500 hover:text-red-500"
                >
                  🗑
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
    </div>
  )
}

export default PortfolioView
