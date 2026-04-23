import React, { memo, useEffect, useRef } from 'react'
import { AreaSeries, ColorType, createChart, CrosshairMode } from 'lightweight-charts'
import type { SingleValueData } from 'lightweight-charts'

const CHART_HEIGHT = 240

export interface BacktestEquityPanelProps {
  title: string
  /** 累计收益率曲线，value 单位为 % */
  points: SingleValueData[]
}

export const BacktestEquityPanel = memo(function BacktestEquityPanel({
  title,
  points
}: BacktestEquityPanelProps) {
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el || points.length === 0) return

    const chart = createChart(el, {
      width: el.clientWidth,
      height: CHART_HEIGHT,
      layout: {
        background: { type: ColorType.Solid, color: '#0f172a' },
        textColor: '#94a3b8'
      },
      grid: {
        vertLines: { color: 'rgba(55, 65, 81, 0.45)' },
        horzLines: { color: 'rgba(55, 65, 81, 0.45)' }
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#374151' },
      timeScale: { borderColor: '#374151' }
    })

    const series = chart.addSeries(AreaSeries, {
      lineColor: '#38bdf8',
      topColor: 'rgba(56, 189, 248, 0.35)',
      bottomColor: 'rgba(56, 189, 248, 0)',
      lineWidth: 2,
      priceLineVisible: true,
      lastValueVisible: true,
      priceFormat: {
        type: 'custom',
        minMove: 0.01,
        formatter: (p) => `${Number(p).toFixed(2)}%`
      }
    })
    series.setData(points)
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
  }, [points])

  return (
    <div className="border-t border-gray-700/50 bg-slate-950/80 px-2 py-2">
      <div className="px-1 pb-1 text-[11px] font-medium text-slate-400">
        回测累计收益 · {title}
      </div>
      <div ref={wrapRef} className="w-full rounded overflow-hidden" style={{ minHeight: CHART_HEIGHT }} />
    </div>
  )
})
