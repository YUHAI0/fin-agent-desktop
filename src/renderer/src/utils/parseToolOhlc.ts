import type { CandlestickData } from 'lightweight-charts'

/** 返回 JSON 日线 OHLC 的工具名（与 Python tushare_tools 一致） */
export const KLINE_TOOL_NAMES = new Set([
  'get_daily_price',
  'get_index_daily',
  'get_hk_daily_price',
  'get_us_daily_price',
  'get_etf_daily_price',
  'get_cb_daily_price',
  'get_futures_daily_price'
])

export function normalizeTradeDate(raw: unknown): string | null {
  if (raw == null) return null
  const s = String(raw).trim()
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return null
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function extractTsCodeFromArgs(argsStr: string): string | undefined {
  try {
    const o = JSON.parse(argsStr) as Record<string, unknown>
    if (typeof o.ts_code === 'string' && o.ts_code) return o.ts_code
  } catch {
    /* 参数可能未完整 JSON */
  }
  return undefined
}

export interface ParsedToolKline {
  label: string
  candles: CandlestickData[]
}

/**
 * 将日线类工具的 JSON 文本解析为 K 线数据；失败返回 null。
 */
export function parseToolResultToKline(
  toolName: string,
  argsStr: string,
  result: string | undefined
): ParsedToolKline | null {
  if (!result || !KLINE_TOOL_NAMES.has(toolName)) return null
  const t = result.trim()
  if (!t.startsWith('[')) return null
  let rows: Record<string, unknown>[]
  try {
    rows = JSON.parse(t) as Record<string, unknown>[]
  } catch {
    return null
  }
  if (!Array.isArray(rows) || rows.length === 0) return null

  const candles: CandlestickData[] = []
  for (const row of rows) {
    const time = normalizeTradeDate(row.trade_date ?? row.trade_datetime)
    if (!time) continue
    const open = num(row.open)
    const high = num(row.high)
    const low = num(row.low)
    const close = num(row.close)
    if (open == null || high == null || low == null || close == null) continue
    candles.push({ time, open, high, low, close })
  }
  if (candles.length === 0) return null

  candles.sort((a, b) => String(a.time).localeCompare(String(b.time)))

  const fromRow = typeof rows[0].ts_code === 'string' ? rows[0].ts_code : undefined
  const fromArgs = extractTsCodeFromArgs(argsStr)
  const label = fromRow || fromArgs || toolName

  return { label, candles }
}
