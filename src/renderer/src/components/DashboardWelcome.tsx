import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppDialog } from '../contexts/AppDialogContext'
import { useChat } from '../contexts/ChatContext'
import {
  buildAnalyzeStockPrefill,
  buildPortfolioDiagnosePrefill,
  buildWatchTodayPrefill
} from '../utils/chatPrefill'
import FaSelect from './FaSelect'
import StockSearchModal from './StockSearchModal'

const money = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
const toneClass = (n: number) =>
  n > 0 ? 'text-red-400' : n < 0 ? 'text-emerald-400' : 'text-[var(--fa-muted)]'
const signed = (n: number) => `${n > 0 ? '+' : ''}${money(n)}`

export interface DashboardWelcomeProps {
  onOpenReminders: () => void
}

const DashboardWelcome: React.FC<DashboardWelcomeProps> = ({ onOpenReminders }) => {
  const navigate = useNavigate()
  const { alert } = useAppDialog()
  const { requestPrefill } = useChat()
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState(false)
  const [commenting, setCommenting] = useState(false)
  const [comment, setComment] = useState<string | null>(null)
  const [commentUnavailable, setCommentUnavailable] = useState(false)
  const [stockSearchOpen, setStockSearchOpen] = useState(false)

  const loadSummary = useCallback(async () => {
    setLoadError(false)
    setLoading(true)
    try {
      const res = await window.api.getDashboardSummary()
      if (!res || res.ok === false) {
        setSummary(null)
        setLoadError(true)
        return
      }
      setSummary(res)
      setComment(null)
      setCommentUnavailable(false)
    } catch {
      setSummary(null)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  const handlePortfolioChange = async (id: string) => {
    if (!summary || id === summary.active_portfolio_id) return
    setSwitching(true)
    try {
      const res = await window.api.setActivePortfolio(id)
      if (!res?.ok) {
        await alert({ title: res?.error || '切换组合失败' })
        return
      }
      await loadSummary()
    } catch (e) {
      await alert({ title: e instanceof Error ? e.message : '切换组合失败' })
    } finally {
      setSwitching(false)
    }
  }

  const handleGenerateComment = async () => {
    if (!summary || commenting) return
    setCommenting(true)
    setCommentUnavailable(false)
    try {
      const newsTitles = (summary.news || []).map((n) => n.title).filter(Boolean).slice(0, 3)
      const res = await window.api.generateDashboardComment({
        portfolio_id: summary.snapshot.portfolio_id || summary.active_portfolio_id,
        index: summary.index
          ? { name: summary.index.name, change_pct: summary.index.change_pct }
          : undefined,
        news_titles: newsTitles
      })
      if (res?.ok && res.comment) {
        setComment(res.comment)
        setCommentUnavailable(false)
      } else {
        setComment(null)
        setCommentUnavailable(true)
      }
    } catch {
      setComment(null)
      setCommentUnavailable(true)
    } finally {
      setCommenting(false)
    }
  }

  const handleOpenNews = async (item: DashboardNewsItem) => {
    const url = (item.url || '').trim()
    if (url) {
      await window.api.openExternal(url)
    }
    const id = (item.id || '').trim()
    if (id) {
      await window.api.markNewsRead(id, true)
    }
  }

  const handleAnalyzePick = (item: StockSearchItem) => {
    void requestPrefill(buildAnalyzeStockPrefill(item.ts_code, item.name || undefined))
  }

  const handleDiagnose = async () => {
    const snapshot = summary?.snapshot
    if (!snapshot?.has_positions) {
      await alert({ title: '请先添加持仓' })
      return
    }
    await requestPrefill(buildPortfolioDiagnosePrefill(snapshot.portfolio_id, snapshot.portfolio_name))
  }

  const handleWatchToday = async () => {
    const snapshot = summary?.snapshot
    const index = summary?.index
    await requestPrefill(
      buildWatchTodayPrefill({
        portfolioName: snapshot?.portfolio_name,
        indexName: index?.name,
        changePct: index?.change_pct ?? null,
        newsTitles: (summary?.news || []).map((n) => n.title)
      })
    )
  }

  const snapshot = summary?.snapshot
  const hasPositions = Boolean(snapshot?.has_positions)
  const news = (summary?.news || []).slice(0, 3)
  const alerts = (summary?.alerts || []).slice(0, 5)
  const portfolioOptions = (summary?.portfolios || []).map((p) => ({ value: p.id, label: p.name }))

  return (
    <div className="fa-dashboard-welcome no-drag">
      <div className="fa-dashboard-welcome-inner">
        {loadError && (
          <div className="fa-card flex items-center justify-between gap-3 p-4 text-sm text-[var(--fa-muted)]">
            <span>仪表盘加载失败，可直接在下方提问</span>
            <button type="button" className="fa-btn-ghost px-3 py-1.5 text-xs" onClick={() => void loadSummary()}>
              重试
            </button>
          </div>
        )}

        {!loadError && loading && !summary && (
          <p className="text-center text-sm text-[var(--fa-faint)]">加载中…</p>
        )}

        {!loadError && summary && snapshot && (
          <>
            <section className="fa-card p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="min-w-0 truncate text-sm font-semibold">{snapshot.portfolio_name}</h2>
                {portfolioOptions.length > 0 && (
                  <FaSelect
                    className="w-40 shrink-0"
                    value={summary.active_portfolio_id}
                    options={portfolioOptions}
                    disabled={switching}
                    aria-label="切换组合"
                    onChange={(id) => void handlePortfolioChange(id)}
                  />
                )}
              </div>
              {hasPositions ? (
                <button
                  type="button"
                  onClick={() => navigate('/portfolio')}
                  className="fa-dashboard-metrics mt-4 w-full cursor-pointer text-left"
                >
                  <div>
                    <div className="text-[11px] text-[var(--fa-faint)]">总市值</div>
                    <div className="mt-0.5 text-base tabular-nums">
                      {snapshot.total_market_value == null ? '—' : `¥ ${money(snapshot.total_market_value)}`}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[var(--fa-faint)]">今日盈亏</div>
                    <div
                      className={`mt-0.5 text-base tabular-nums ${
                        snapshot.today_pnl == null ? 'text-[var(--fa-muted)]' : toneClass(snapshot.today_pnl)
                      }`}
                    >
                      {snapshot.today_pnl == null ? '—' : signed(snapshot.today_pnl)}
                      {snapshot.today_pnl_pct != null ? (
                        <span className="ml-1 text-xs">{signed(snapshot.today_pnl_pct)}%</span>
                      ) : null}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[var(--fa-faint)]">累计盈亏</div>
                    <div
                      className={`mt-0.5 text-base tabular-nums ${
                        snapshot.total_pnl == null ? 'text-[var(--fa-muted)]' : toneClass(snapshot.total_pnl)
                      }`}
                    >
                      {snapshot.total_pnl == null ? '—' : signed(snapshot.total_pnl)}
                      {snapshot.total_pnl_pct != null ? (
                        <span className="ml-1 text-xs">{signed(snapshot.total_pnl_pct)}%</span>
                      ) : null}
                    </div>
                  </div>
                </button>
              ) : (
                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="text-sm text-[var(--fa-muted)]">还没有持仓</p>
                  <button
                    type="button"
                    className="fa-btn-primary px-3 py-1.5 text-xs"
                    onClick={() => navigate('/portfolio')}
                  >
                    去添加
                  </button>
                </div>
              )}
            </section>

            <section className="fa-card p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">今日简报</h2>
                <button
                  type="button"
                  className="fa-btn-ghost px-3 py-1.5 text-xs"
                  disabled={commenting}
                  onClick={() => void handleGenerateComment()}
                >
                  生成点评
                </button>
              </div>
              {summary.index ? (
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span>{summary.index.name}</span>
                  <span className="tabular-nums">{money(summary.index.price)}</span>
                  <span className={`tabular-nums ${toneClass(summary.index.change_pct)}`}>
                    {summary.index.change_pct > 0 ? '+' : ''}
                    {summary.index.change_pct.toFixed(2)}%
                  </span>
                </div>
              ) : (
                <p className="text-sm text-[var(--fa-muted)]">大盘暂不可用</p>
              )}
              {news.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {news.map((item, idx) => (
                    <li key={item.id || `${item.title}-${idx}`}>
                      <button
                        type="button"
                        className="w-full cursor-pointer rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--fa-surface-hover)]"
                        onClick={() => void handleOpenNews(item)}
                      >
                        <div className="truncate text-sm">{item.title}</div>
                        {item.source ? (
                          <div className="mt-0.5 text-[11px] text-[var(--fa-faint)]">{item.source}</div>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {commentUnavailable && (
                <p className="mt-3 text-sm text-[var(--fa-muted)]">点评暂不可用</p>
              )}
              {comment && !commentUnavailable && (
                <p className="mt-3 text-sm leading-relaxed text-[var(--fa-text)]">{comment}</p>
              )}
            </section>

            <section className="fa-card p-4">
              <h2 className="mb-3 text-sm font-semibold">待关注</h2>
              {alerts.length > 0 ? (
                <ul className="space-y-1.5">
                  {alerts.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="w-full cursor-pointer rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--fa-surface-hover)]"
                        onClick={onOpenReminders}
                      >
                        {item.message}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-[var(--fa-muted)]">暂无预警</p>
              )}
              <p className="mt-3 text-xs text-[var(--fa-faint)]">投资日历即将推出</p>
            </section>

            <section className="fa-dashboard-actions">
              <button type="button" className="fa-btn-ghost" onClick={() => setStockSearchOpen(true)}>
                分析一只股票
              </button>
              <button type="button" className="fa-btn-ghost" onClick={() => void handleDiagnose()}>
                组合体检
              </button>
              <button type="button" className="fa-btn-ghost" onClick={() => void handleWatchToday()}>
                今日该关注什么
              </button>
            </section>
          </>
        )}
      </div>

      <StockSearchModal
        open={stockSearchOpen}
        onClose={() => setStockSearchOpen(false)}
        onPick={handleAnalyzePick}
      />
    </div>
  )
}

export default DashboardWelcome
