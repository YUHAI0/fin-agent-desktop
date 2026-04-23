import { normalizeTradeDate } from './parseToolOhlc'

export interface ParsedBacktestEquity {
  /** 用于标题：标的 + 策略 */
  label: string
  /** 累计收益率（%），对应图表纵轴 */
  points: { time: string; value: number }[]
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * 解析 run_backtest 工具返回的 JSON，提取 equity_curve 绘制收益曲线。
 */
export function parseRunBacktestEquity(
  toolName: string,
  argsStr: string,
  result: string | undefined
): ParsedBacktestEquity | null {
  if (!result || toolName !== 'run_backtest') return null
  const t = result.trim()
  if (!t.startsWith('{')) return null
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(t) as Record<string, unknown>
  } catch {
    return null
  }
  if (obj.error != null) return null

  const curve = obj.equity_curve
  if (!Array.isArray(curve) || curve.length === 0) return null

  const points: { time: string; value: number }[] = []
  for (const row of curve) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const time = normalizeTradeDate(r.trade_date)
    if (!time) continue
    let ret = num(r.return_pct)
    if (ret == null) {
      const val = num(r.value)
      const init = num(obj.initial_capital)
      if (val != null && init != null && init > 0) {
        ret = (val / init - 1) * 100
      }
    }
    if (ret == null) continue
    points.push({ time, value: ret })
  }
  if (points.length === 0) return null

  points.sort((a, b) => String(a.time).localeCompare(String(b.time)))

  let tsCode = typeof obj.ts_code === 'string' ? obj.ts_code : '回测'
  const strategy = typeof obj.strategy === 'string' ? obj.strategy : ''
  try {
    const args = JSON.parse(argsStr) as Record<string, unknown>
    if (typeof args.ts_code === 'string' && args.ts_code) tsCode = args.ts_code
  } catch {
    /* 流式参数可能不完整 */
  }
  const label = strategy ? `${tsCode} · ${strategy}` : tsCode

  return { label, points }
}
