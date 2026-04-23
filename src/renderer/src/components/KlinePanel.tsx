import React, { memo, useEffect, useRef } from 'react'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode
} from 'lightweight-charts'
import type { CandlestickData } from 'lightweight-charts'
import { chartLocalizationZh, formatTickMarkZh } from '../utils/chartTimeZh'

const CHART_HEIGHT = 260

export interface KlinePanelProps {
  /** 展示在图上方，一般为 ts_code */
  title: string
  candles: CandlestickData[]
}

export const KlinePanel = memo(function KlinePanel({ title, candles }: KlinePanelProps) {
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el || candles.length === 0) return

    const chart = createChart(el, {
      width: el.clientWidth,
      height: CHART_HEIGHT,
      layout: {
        background: { type: ColorType.Solid, color: '#0f172a' },
        textColor: '#94a3b8',
        attributionLogo: false
      },
      grid: {
        vertLines: { color: 'rgba(55, 65, 81, 0.45)' },
        horzLines: { color: 'rgba(55, 65, 81, 0.45)' }
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#374151' },
      localization: { ...chartLocalizationZh },
      timeScale: {
        borderColor: '#374151',
        tickMarkFormatter: (time, tickMarkType) => formatTickMarkZh(time, tickMarkType)
      }
    })

    // 中式习惯：红涨绿跌
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#ef4444',
      downColor: '#22c55e',
      borderVisible: false,
      wickUpColor: '#ef4444',
      wickDownColor: '#22c55e'
    })
    series.setData(candles)
    chart.timeScale().fitContent()

    const ro = new ResizeObserver(() => {
      if (!wrapRef.current) return
      chart.applyOptions({ width: wrapRef.current.clientWidth })
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      chart.remove()
    }
  }, [candles])

  return (
    <div className="border-t border-gray-700/50 bg-slate-950/80 px-2 py-2">
      <div className="px-1 pb-1 text-[11px] font-medium text-slate-400">日线 K 线 · {title}</div>
      <div ref={wrapRef} className="w-full rounded overflow-hidden" style={{ minHeight: CHART_HEIGHT }} />
    </div>
  )
})
