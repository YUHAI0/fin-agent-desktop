import type { Time } from 'lightweight-charts'
import { TickMarkType } from 'lightweight-charts'

function parseChartTime(time: Time): { y: number; m: number; d: number } | null {
  if (time == null) return null
  if (typeof time === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(time)
    if (m) return { y: +m[1], m: +m[2], d: +m[3] }
    return null
  }
  if (typeof time === 'number') {
    const d = new Date(time * 1000)
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }
  }
  if (typeof time === 'object' && 'year' in time) {
    const o = time as { year: number; month: number; day: number }
    return { y: o.year, m: o.month, d: o.day }
  }
  return null
}

/** 十字线悬浮：完整中文日期 */
export function formatCrosshairTimeZh(time: Time): string {
  const p = parseChartTime(time)
  if (!p) return String(time)
  return `${p.y}年${p.m}月${p.d}日`
}

/**
 * 时间轴刻度（控制长度，避免与库默认一样出现 'yy）
 * Year: 2025年 · Month: 2025年5月 · Day: 5月13日
 */
export function formatTickMarkZh(time: Time, tickMarkType: TickMarkType): string {
  const p = parseChartTime(time)
  if (!p) return ''
  switch (tickMarkType) {
    case TickMarkType.Year:
      return `${p.y}年`
    case TickMarkType.Month:
      return `${p.y}年${p.m}月`
    case TickMarkType.DayOfMonth:
      return `${p.m}月${p.d}日`
    case TickMarkType.Time:
    case TickMarkType.TimeWithSeconds:
      return `${p.m}月${p.d}日`
    default:
      return `${p.y}年${p.m}月${p.d}日`
  }
}

/** createChart 的 localization 片段 */
export const chartLocalizationZh = {
  locale: 'zh-CN',
  dateFormat: 'yyyy-MM-dd',
  timeFormatter: formatCrosshairTimeZh
} as const
