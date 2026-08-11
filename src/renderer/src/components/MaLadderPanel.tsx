import React, { memo, useMemo } from 'react'
import type { MaLadderData, MaLevel } from '../utils/parseMaLadder'

interface MaLadderPanelProps {
  data: MaLadderData
}

function formatPrice(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

function LevelRow({
  level,
  kind,
  currentPrice,
  maxSpan
}: {
  level: MaLevel
  kind: 'resistance' | 'support'
  currentPrice: number
  maxSpan: number
}) {
  const span = Math.abs(level.value - currentPrice)
  const widthPct = maxSpan > 0 ? Math.max(18, Math.min(100, (span / maxSpan) * 100)) : 100
  const isResistance = kind === 'resistance'

  return (
    <div className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 py-1.5">
      <span className="font-mono text-xs font-medium text-[var(--fa-text)]">{level.label}</span>
      <div className="relative h-2 rounded-full bg-[var(--fa-border-subtle)]">
        <div
          className={`absolute top-0 h-2 rounded-full ${
            isResistance ? 'right-0 bg-red-500/75' : 'left-0 bg-emerald-500/75'
          }`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
      <span
        className={`min-w-[3.5rem] text-right font-mono text-xs tabular-nums ${
          isResistance ? 'text-red-400' : 'text-emerald-400'
        }`}
      >
        {formatPrice(level.value)}
      </span>
    </div>
  )
}

export const MaLadderPanel = memo(function MaLadderPanel({ data }: MaLadderPanelProps) {
  const maxSpan = useMemo(() => {
    const all = [...data.resistance, ...data.support]
    if (!all.length) return 1
    return Math.max(...all.map((l) => Math.abs(l.value - data.currentPrice)), 1)
  }, [data])

  return (
    <div className="not-prose my-4 overflow-hidden rounded-xl border border-[var(--fa-border)] bg-[var(--fa-surface)] shadow-sm">
      <div className="border-b border-[var(--fa-border-subtle)] px-4 py-2.5 text-xs font-medium text-[var(--fa-muted)]">
        均线压力 / 支撑分布
      </div>

      {data.headline && (
        <div className="border-b border-[var(--fa-border-subtle)] px-4 py-2.5 text-sm text-[var(--fa-muted)]">
          {data.headline}
        </div>
      )}

      <div className="space-y-4 px-4 py-3">
        {data.resistance.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-red-400/90">
              上方压力
            </div>
            <div className="space-y-0.5">
              {data.resistance.map((level) => (
                <LevelRow
                  key={`r-${level.label}-${level.value}`}
                  level={level}
                  kind="resistance"
                  currentPrice={data.currentPrice}
                  maxSpan={maxSpan}
                />
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 rounded-lg border border-[var(--fa-accent)]/35 bg-[var(--fa-accent-soft)] px-3 py-2.5">
          <span className="text-xs font-medium text-[var(--fa-muted)]">现价</span>
          <span className="font-mono text-base font-semibold tabular-nums text-[var(--fa-text)]">
            {formatPrice(data.currentPrice)}
          </span>
          <span className="ml-auto text-[11px] text-[var(--fa-faint)]">密集区参考轴</span>
        </div>

        {data.support.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-emerald-400/90">
              下方支撑
            </div>
            <div className="space-y-0.5">
              {data.support.map((level) => (
                <LevelRow
                  key={`s-${level.label}-${level.value}`}
                  level={level}
                  kind="support"
                  currentPrice={data.currentPrice}
                  maxSpan={maxSpan}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
})
