import React, { memo, useEffect, useRef } from 'react'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  type CandlestickSeriesPartialOptions,
  type IChartApi,
  type ISeriesApi
} from 'lightweight-charts'
import type { CandlestickData } from 'lightweight-charts'
import { chartLocalizationZh, formatTickMarkZh } from '../utils/chartTimeZh'
import { readChartTheme } from '../utils/chartTheme'
import { useTheme } from '../contexts/ThemeContext'

const CHART_HEIGHT = 260

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
        formatTickMarkZh(time as import('lightweight-charts').Time, tickMarkType as Parameters<typeof formatTickMarkZh>[1])
    }
  }
}

function buildSeriesOptions(colors: ReturnType<typeof readChartTheme>): CandlestickSeriesPartialOptions {
  return {
    upColor: colors.candleUp,
    downColor: colors.candleDown,
    borderVisible: false,
    wickUpColor: colors.candleUp,
    wickDownColor: colors.candleDown
  }
}

export interface KlinePanelProps {
  /** 展示在图上方，一般为 ts_code */
  title: string
  candles: CandlestickData[]
}

export const KlinePanel = memo(function KlinePanel({ title, candles }: KlinePanelProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const { theme } = useTheme()

  useEffect(() => {
    const el = wrapRef.current
    if (!el || candles.length === 0) return

    const colors = readChartTheme()
    const chart = createChart(el, buildChartOptions(colors, el.clientWidth))
    const series = chart.addSeries(CandlestickSeries, buildSeriesOptions(colors))
    series.setData(candles)
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
  }, [candles])

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
        日线 K 线 · {title}
      </div>
      <div
        ref={wrapRef}
        className="w-full overflow-hidden rounded-lg border border-[var(--fa-chart-border)]"
        style={{ minHeight: CHART_HEIGHT }}
      />
    </div>
  )
})
