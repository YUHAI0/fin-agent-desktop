import React, { memo, useEffect, useRef } from 'react'
import {
  AreaSeries,
  ColorType,
  createChart,
  CrosshairMode,
  type AreaSeriesPartialOptions,
  type IChartApi,
  type ISeriesApi
} from 'lightweight-charts'
import type { SingleValueData } from 'lightweight-charts'
import { chartLocalizationZh, formatTickMarkZh } from '../utils/chartTimeZh'
import { readChartTheme } from '../utils/chartTheme'
import { useTheme } from '../contexts/ThemeContext'

const CHART_HEIGHT = 240

function buildChartOptions(colors: ReturnType<typeof readChartTheme>, width: number) {
  return {
    width,
    height: CHART_HEIGHT,
    layout: {
      background: { type: ColorType.Solid, color: colors.background },
      textColor: colors.text,
      attributionLogo: false
    },
    grid: {
      vertLines: { color: colors.grid },
      horzLines: { color: colors.grid }
    },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { borderColor: colors.border },
    localization: { ...chartLocalizationZh },
    timeScale: {
      borderColor: colors.border,
      tickMarkFormatter: (time: unknown, tickMarkType: unknown) =>
        formatTickMarkZh(time, tickMarkType as Parameters<typeof formatTickMarkZh>[1])
    }
  }
}

function buildSeriesOptions(colors: ReturnType<typeof readChartTheme>): AreaSeriesPartialOptions {
  return {
    lineColor: colors.areaLine,
    topColor: colors.areaTop,
    bottomColor: colors.areaBottom,
    lineWidth: 2,
    priceLineVisible: true,
    lastValueVisible: true,
    priceFormat: {
      type: 'custom',
      minMove: 0.01,
      formatter: (p: number) => `${Number(p).toFixed(2)}%`
    }
  }
}

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
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null)
  const { theme } = useTheme()

  useEffect(() => {
    const el = wrapRef.current
    if (!el || points.length === 0) return

    const colors = readChartTheme()
    const chart = createChart(el, buildChartOptions(colors, el.clientWidth))
    const series = chart.addSeries(AreaSeries, buildSeriesOptions(colors))
    series.setData(points)
    chart.timeScale().fitContent()

    chartRef.current = chart
    seriesRef.current = series

    const ro = new ResizeObserver(() => {
      if (!wrapRef.current || !chartRef.current) return
      chartRef.current.applyOptions({ width: wrapRef.current.clientWidth })
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [points])

  useEffect(() => {
    const chart = chartRef.current
    const series = seriesRef.current
    if (!chart || !series) return

    const colors = readChartTheme()
    chart.applyOptions(buildChartOptions(colors, wrapRef.current?.clientWidth ?? 0))
    series.applyOptions(buildSeriesOptions(colors))
  }, [theme])

  return (
    <div className="border-t border-[var(--fa-border-subtle)] bg-[var(--fa-chart-bg)] px-2 py-2">
      <div className="px-1 pb-1.5 text-[11px] font-medium tracking-wide text-[var(--fa-muted)]">
        回测累计收益 · {title}
      </div>
      <div
        ref={wrapRef}
        className="w-full overflow-hidden rounded-lg border border-[var(--fa-chart-border)]"
        style={{ minHeight: CHART_HEIGHT }}
      />
    </div>
  )
})
