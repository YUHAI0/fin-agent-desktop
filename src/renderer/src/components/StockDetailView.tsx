import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import type { CandlestickData } from 'lightweight-charts'
import SubPageShell from './SubPageShell'
import { KlinePanel } from './KlinePanel'
import { useChat } from '../contexts/ChatContext'
import { buildAnalyzeStockPrefill } from '../utils/chatPrefill'

type KlinePeriod = '1M' | '3M' | '6M' | '1Y' | '3Y' | '5Y'

type SectionState<T> = {
  loading: boolean
  error: string | null
  code?: string
  data: T | null
}

const PERIODS: KlinePeriod[] = ['1M', '3M', '6M', '1Y', '3Y', '5Y']

const money = (n: number | null | undefined, digits = 2) => {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

const pct = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

const toneClass = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n) || n === 0) return 'text-[var(--fa-muted)]'
  return n > 0 ? 'text-red-400' : 'text-emerald-400'
}

const fmtYi = (wan: number | null | undefined) => {
  if (wan == null || !Number.isFinite(wan)) return '—'
  // daily_basic 市值为万元
  return `${(wan / 10000).toFixed(2)} 亿`
}

const fmtDate = (raw: string | null | undefined) => {
  if (!raw) return '—'
  const s = String(raw).replace(/\D/g, '')
  if (s.length >= 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  return String(raw)
}

function emptySection<T>(): SectionState<T> {
  return { loading: true, error: null, data: null }
}

const StockDetailView: React.FC = () => {
  const navigate = useNavigate()
  const { requestPrefill } = useChat()
  const params = useParams()
  const tsCode = decodeURIComponent(params.tsCode || '').trim().toUpperCase()

  const [period, setPeriod] = useState<KlinePeriod>('6M')
  const [quote, setQuote] = useState<SectionState<StockQuote>>(emptySection)
  const [kline, setKline] = useState<SectionState<StockKlineData>>(emptySection)
  const [valuation, setValuation] = useState<SectionState<StockValuation>>(emptySection)
  const [financials, setFinancials] = useState<SectionState<StockFinancialRow[]>>(emptySection)
  const [moneyflow, setMoneyflow] = useState<SectionState<StockMoneyflowRow[]>>(emptySection)

  const loadQuote = useCallback(async (code: string) => {
    setQuote((s) => ({ ...s, loading: true, error: null }))
    try {
      const res = await window.api.getStockQuote(code)
      if (res.ok && res.data) setQuote({ loading: false, error: null, data: res.data })
      else setQuote({ loading: false, error: res.error || '加载失败', code: res.code, data: null })
    } catch (e) {
      setQuote({ loading: false, error: e instanceof Error ? e.message : String(e), data: null })
    }
  }, [])

  const loadKline = useCallback(async (code: string, p: KlinePeriod) => {
    setKline((s) => ({ ...s, loading: true, error: null }))
    try {
      const res = await window.api.getStockKline(code, p)
      if (res.ok && res.data) setKline({ loading: false, error: null, data: res.data })
      else setKline({ loading: false, error: res.error || '加载失败', code: res.code, data: null })
    } catch (e) {
      setKline({ loading: false, error: e instanceof Error ? e.message : String(e), data: null })
    }
  }, [])

  const loadValuation = useCallback(async (code: string) => {
    setValuation((s) => ({ ...s, loading: true, error: null }))
    try {
      const res = await window.api.getStockValuation(code)
      if (res.ok && res.data) setValuation({ loading: false, error: null, data: res.data })
      else setValuation({ loading: false, error: res.error || '加载失败', code: res.code, data: null })
    } catch (e) {
      setValuation({ loading: false, error: e instanceof Error ? e.message : String(e), data: null })
    }
  }, [])

  const loadFinancials = useCallback(async (code: string) => {
    setFinancials((s) => ({ ...s, loading: true, error: null }))
    try {
      const res = await window.api.getStockFinancials(code)
      if (res.ok && res.data) setFinancials({ loading: false, error: null, data: res.data })
      else setFinancials({ loading: false, error: res.error || '加载失败', code: res.code, data: null })
    } catch (e) {
      setFinancials({ loading: false, error: e instanceof Error ? e.message : String(e), data: null })
    }
  }, [])

  const loadMoneyflow = useCallback(async (code: string) => {
    setMoneyflow((s) => ({ ...s, loading: true, error: null }))
    try {
      const res = await window.api.getStockMoneyflow(code)
      if (res.ok && res.data) setMoneyflow({ loading: false, error: null, data: res.data })
      else
        setMoneyflow({
          loading: false,
          error: res.error || '加载失败',
          code: res.code,
          data: null
        })
    } catch (e) {
      setMoneyflow({ loading: false, error: e instanceof Error ? e.message : String(e), data: null })
    }
  }, [])

  const refreshAll = useCallback(() => {
    if (!tsCode) return
    void loadQuote(tsCode)
    void loadKline(tsCode, period)
    void loadValuation(tsCode)
    void loadFinancials(tsCode)
    void loadMoneyflow(tsCode)
  }, [tsCode, period, loadQuote, loadKline, loadValuation, loadFinancials, loadMoneyflow])

  const handleAnalyze = useCallback(async () => {
    if (!tsCode) return
    const text = buildAnalyzeStockPrefill(tsCode, quote.data?.name)
    await requestPrefill(text)
  }, [tsCode, quote.data?.name, requestPrefill])

  useEffect(() => {
    if (!tsCode) return
    void loadQuote(tsCode)
    void loadValuation(tsCode)
    void loadFinancials(tsCode)
    void loadMoneyflow(tsCode)
  }, [tsCode, loadQuote, loadValuation, loadFinancials, loadMoneyflow])

  useEffect(() => {
    if (!tsCode) return
    void loadKline(tsCode, period)
  }, [tsCode, period, loadKline])

  const candles: CandlestickData[] = useMemo(() => {
    const list = kline.data?.candles || []
    return list.map((c) => ({
      time: c.time as CandlestickData['time'],
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close
    }))
  }, [kline.data])

  const titleName = quote.data?.name || tsCode || '股票详情'
  const change = quote.data?.change
  const pctChg = quote.data?.pct_chg

  if (!tsCode) {
    return (
      <SubPageShell>
        <div className="fa-page-header justify-between">
          <button type="button" className="fa-icon-btn" onClick={() => navigate(-1)} aria-label="返回">
            <ArrowLeft size={18} />
          </button>
          <span className="text-sm font-semibold">股票详情</span>
          <span className="w-8" />
        </div>
        <p className="px-4 py-8 text-center text-sm text-[var(--fa-muted)]">缺少股票代码</p>
      </SubPageShell>
    )
  }

  return (
    <SubPageShell>
      <div className="fa-page-header justify-between">
        <button
          type="button"
          className="fa-icon-btn"
          onClick={() => navigate(-1)}
          title="返回"
          aria-label="返回"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1 px-2 text-center">
          <div className="truncate text-sm font-semibold">{titleName}</div>
          <div className="font-mono text-[11px] text-[var(--fa-faint)]">{tsCode}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="fa-icon-btn inline-flex items-center gap-1 px-2 text-[11px] font-medium"
            onClick={() => void handleAnalyze()}
            title="让 Agent 分析此股"
            aria-label="让 Agent 分析此股"
          >
            <Sparkles size={14} />
            让 Agent 分析此股
          </button>
          <button
            type="button"
            className="fa-icon-btn"
            onClick={refreshAll}
            title="刷新"
            aria-label="刷新"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-6">
        {/* 抬头行情 */}
        <section className="rounded-xl border border-[var(--fa-border-subtle)] bg-[var(--fa-surface)]/40 p-4">
          {quote.loading && (
            <div className="flex items-center gap-2 text-sm text-[var(--fa-muted)]">
              <Loader2 className="animate-spin" size={16} />
              加载行情…
            </div>
          )}
          {!quote.loading && quote.error && (
            <p className="text-sm text-red-400">{quote.error}</p>
          )}
          {!quote.loading && quote.data && (
            <>
              <div className="flex items-end gap-3">
                <div className={`text-3xl font-semibold tabular-nums ${toneClass(change)}`}>
                  {money(quote.data.price)}
                </div>
                <div className={`pb-1 text-sm tabular-nums ${toneClass(change)}`}>
                  {change != null && Number.isFinite(change)
                    ? `${change > 0 ? '+' : ''}${change.toFixed(2)}`
                    : '—'}{' '}
                  ({pct(pctChg)})
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs sm:grid-cols-6">
                <Metric label="今开" value={money(quote.data.open)} />
                <Metric label="最高" value={money(quote.data.high)} />
                <Metric label="最低" value={money(quote.data.low)} />
                <Metric label="昨收" value={money(quote.data.pre_close)} />
                <Metric label="成交量" value={money(quote.data.vol, 0)} />
                <Metric label="成交额" value={money(quote.data.amount, 0)} />
              </div>
              {quote.data.industry && (
                <p className="mt-2 text-[11px] text-[var(--fa-faint)]">行业 · {quote.data.industry}</p>
              )}
            </>
          )}
        </section>

        {/* 近期表现 */}
        <section>
          <h3 className="mb-2 text-xs font-medium text-[var(--fa-muted)]">近期表现</h3>
          {kline.loading && !kline.data && (
            <div className="flex items-center gap-2 text-sm text-[var(--fa-muted)]">
              <Loader2 className="animate-spin" size={14} />
              计算中…
            </div>
          )}
          {kline.data?.performance && (
            <div className="grid grid-cols-4 gap-2">
              <PerfChip label="近1周" value={kline.data.performance.w1} />
              <PerfChip label="近1月" value={kline.data.performance.m1} />
              <PerfChip label="近3月" value={kline.data.performance.m3} />
              <PerfChip label="今年" value={kline.data.performance.ytd} />
            </div>
          )}
        </section>

        {/* K 线 */}
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium text-[var(--fa-muted)]">日 K</h3>
            <div className="flex flex-wrap justify-end gap-1">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={`rounded-md px-2 py-1 text-[11px] transition-colors ${
                    period === p
                      ? 'bg-[var(--fa-accent)]/20 text-[var(--fa-accent)]'
                      : 'text-[var(--fa-muted)] hover:bg-[var(--fa-surface-hover)]'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          {kline.loading && (
            <div className="flex items-center gap-2 py-8 text-sm text-[var(--fa-muted)]">
              <Loader2 className="animate-spin" size={16} />
              加载 K 线…
            </div>
          )}
          {!kline.loading && kline.error && <p className="text-sm text-red-400">{kline.error}</p>}
          {!kline.loading && candles.length > 0 && <KlinePanel title={tsCode} candles={candles} />}
          {!kline.loading && !kline.error && candles.length === 0 && (
            <p className="text-sm text-[var(--fa-faint)]">暂无 K 线数据</p>
          )}
        </section>

        {/* 估值 */}
        <section>
          <h3 className="mb-2 text-xs font-medium text-[var(--fa-muted)]">估值</h3>
          {valuation.loading && (
            <div className="flex items-center gap-2 text-sm text-[var(--fa-muted)]">
              <Loader2 className="animate-spin" size={14} />
              加载中…
            </div>
          )}
          {!valuation.loading && valuation.error && (
            <p className="text-sm text-red-400">{valuation.error}</p>
          )}
          {!valuation.loading && valuation.data && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MetricCard label="PE" value={money(valuation.data.pe)} />
              <MetricCard label="PE(TTM)" value={money(valuation.data.pe_ttm)} />
              <MetricCard label="PB" value={money(valuation.data.pb)} />
              <MetricCard label="总市值" value={fmtYi(valuation.data.total_mv)} />
              <MetricCard label="流通市值" value={fmtYi(valuation.data.circ_mv)} />
              <MetricCard label="股息率" value={pct(valuation.data.dv_ratio)} />
              <MetricCard label="PS(TTM)" value={money(valuation.data.ps_ttm)} />
              <MetricCard label="日期" value={fmtDate(valuation.data.trade_date)} />
            </div>
          )}
        </section>

        {/* 财务摘要 */}
        <section>
          <h3 className="mb-2 text-xs font-medium text-[var(--fa-muted)]">财务摘要</h3>
          {financials.loading && (
            <div className="flex items-center gap-2 text-sm text-[var(--fa-muted)]">
              <Loader2 className="animate-spin" size={14} />
              加载中…
            </div>
          )}
          {!financials.loading && financials.error && (
            <p className="text-sm text-red-400">{financials.error}</p>
          )}
          {!financials.loading && financials.data && financials.data.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-[var(--fa-border-subtle)]">
              <table className="w-full min-w-[480px] text-left text-xs">
                <thead className="bg-[var(--fa-surface)]/60 text-[var(--fa-faint)]">
                  <tr>
                    <th className="px-3 py-2 font-medium">报告期</th>
                    <th className="px-3 py-2 font-medium">营收</th>
                    <th className="px-3 py-2 font-medium">营业利润</th>
                    <th className="px-3 py-2 font-medium">净利润</th>
                  </tr>
                </thead>
                <tbody>
                  {financials.data.map((row, i) => (
                    <tr key={`${row.end_date}-${i}`} className="border-t border-[var(--fa-border-subtle)]">
                      <td className="px-3 py-2 tabular-nums">{fmtDate(row.end_date)}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {fmtFin(row.total_revenue ?? row.revenue)}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{fmtFin(row.operate_profit)}</td>
                      <td className="px-3 py-2 tabular-nums">{fmtFin(row.n_income)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* 资金流 */}
        <section>
          <h3 className="mb-2 text-xs font-medium text-[var(--fa-muted)]">资金流</h3>
          {moneyflow.loading && (
            <div className="flex items-center gap-2 text-sm text-[var(--fa-muted)]">
              <Loader2 className="animate-spin" size={14} />
              加载中…
            </div>
          )}
          {!moneyflow.loading && moneyflow.code === 'tushare_required' && (
            <p className="text-sm text-[var(--fa-muted)]">
              请在设置中配置 Tushare Token 后查看资金流
              <button
                type="button"
                className="ml-2 text-[var(--fa-accent)] underline-offset-2 hover:underline"
                onClick={() => navigate('/config')}
              >
                去设置
              </button>
            </p>
          )}
          {!moneyflow.loading && moneyflow.code !== 'tushare_required' && moneyflow.error && (
            <p className="text-sm text-red-400">{moneyflow.error}</p>
          )}
          {!moneyflow.loading && moneyflow.data && moneyflow.data.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-[var(--fa-border-subtle)]">
              <table className="w-full min-w-[420px] text-left text-xs">
                <thead className="bg-[var(--fa-surface)]/60 text-[var(--fa-faint)]">
                  <tr>
                    <th className="px-3 py-2 font-medium">日期</th>
                    <th className="px-3 py-2 font-medium">净流入(万)</th>
                    <th className="px-3 py-2 font-medium">大单净额</th>
                    <th className="px-3 py-2 font-medium">超大单净额</th>
                  </tr>
                </thead>
                <tbody>
                  {moneyflow.data.map((row, i) => {
                    const net = numOrNull(row.net_mf_amount)
                    const lg =
                      numOrNull(row.buy_lg_amount) != null && numOrNull(row.sell_lg_amount) != null
                        ? (row.buy_lg_amount as number) - (row.sell_lg_amount as number)
                        : null
                    const elg =
                      numOrNull(row.buy_elg_amount) != null && numOrNull(row.sell_elg_amount) != null
                        ? (row.buy_elg_amount as number) - (row.sell_elg_amount as number)
                        : null
                    return (
                      <tr
                        key={`${row.trade_date}-${i}`}
                        className="border-t border-[var(--fa-border-subtle)]"
                      >
                        <td className="px-3 py-2 tabular-nums">{fmtDate(row.trade_date as string)}</td>
                        <td className={`px-3 py-2 tabular-nums ${toneClass(net)}`}>{money(net)}</td>
                        <td className={`px-3 py-2 tabular-nums ${toneClass(lg)}`}>{money(lg)}</td>
                        <td className={`px-3 py-2 tabular-nums ${toneClass(elg)}`}>{money(elg)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </SubPageShell>
  )
}

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function fmtFin(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—'
  const yi = n / 1e8
  if (Math.abs(yi) >= 1) return `${yi.toFixed(2)} 亿`
  return money(n / 1e4, 2) + ' 万'
}

const Metric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <div className="text-[10px] text-[var(--fa-faint)]">{label}</div>
    <div className="tabular-nums text-[var(--fa-text)]">{value}</div>
  </div>
)

const MetricCard: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-lg border border-[var(--fa-border-subtle)] px-3 py-2">
    <div className="text-[10px] text-[var(--fa-faint)]">{label}</div>
    <div className="mt-0.5 text-sm tabular-nums">{value}</div>
  </div>
)

const PerfChip: React.FC<{ label: string; value?: number | null }> = ({ label, value }) => (
  <div className="rounded-lg border border-[var(--fa-border-subtle)] px-2 py-2 text-center">
    <div className="text-[10px] text-[var(--fa-faint)]">{label}</div>
    <div className={`mt-0.5 text-sm tabular-nums ${toneClass(value)}`}>{pct(value)}</div>
  </div>
)

export default StockDetailView
