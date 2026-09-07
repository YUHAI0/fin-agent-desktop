import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Bookmark } from 'lucide-react'
import { useAppDialog } from '../contexts/AppDialogContext'
import type { ChatBlock } from '../contexts/ChatContext'
import { MarkdownExternalLink } from './ExternalLink'

type ChatBlockReport = Extract<ChatBlock, { type: 'report' }>

const KIND_LABEL: Record<ChatBlockReport['kind'], string> = {
  stock_checkup: '个股体检',
  portfolio_diagnose: '组合诊断',
  trade_memo: '买卖决策备忘录'
}

const DEPTH_LABEL: Record<ChatBlockReport['depth'], string> = {
  brief: '简版',
  standard: '适中',
  full: '完整'
}

const SECTION_ROWS: { key: keyof ChatBlockReport['sections']; label: string }[] = [
  { key: 'conclusion', label: '结论' },
  { key: 'evidence', label: '依据' },
  { key: 'risk', label: '风险' },
  { key: 'next', label: '下一步' }
]

export interface ReportCardProps {
  block: ChatBlockReport
  sessionId: string | null
  live?: boolean
  onFavoriteId: (id: string | undefined) => void
}

const ReportCard: React.FC<ReportCardProps> = ({ block, sessionId, live, onFavoriteId }) => {
  const { alert } = useAppDialog()
  const [busy, setBusy] = useState(false)
  const saved = Boolean(block.favorite_id)
  const pending = Boolean(block.pending)

  const toggleFavorite = async () => {
    if (busy || pending) return
    setBusy(true)
    try {
      if (saved && block.favorite_id) {
        const res = await window.api.deleteAnalysisFavorite(block.favorite_id)
        if (!res?.ok) {
          await alert({ title: res?.error || '取消收藏失败' })
          return
        }
        onFavoriteId(undefined)
      } else {
        const res = await window.api.saveAnalysisFavorite({
          kind: block.kind,
          title: block.title,
          depth: block.depth,
          symbols: block.symbols || [],
          portfolio_id: block.portfolio_id ?? null,
          sections: block.sections,
          disclaimer: block.disclaimer,
          source_session_id: sessionId || undefined
        })
        if (!res?.ok || !res.id) {
          await alert({ title: res?.error || '收藏失败' })
          return
        }
        onFavoriteId(res.id)
      }
    } catch (e) {
      await alert({ title: e instanceof Error ? e.message : saved ? '取消收藏失败' : '收藏失败' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`fa-report-card${live ? ' fa-stream-live' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="fa-report-kind">{pending ? '报告' : KIND_LABEL[block.kind]}</span>
        <span className="fa-report-depth">{pending ? '生成中' : DEPTH_LABEL[block.depth]}</span>
        {!pending && (
        <button
          type="button"
          className="fa-btn-ghost ml-auto px-2 py-1 text-xs"
          disabled={busy}
          onClick={() => void toggleFavorite()}
        >
          <Bookmark size={14} className="mr-1 inline" />
          {saved ? '已收藏' : '收藏'}
        </button>
        )}
      </div>
      <h2 className="mt-2 text-sm font-semibold">{pending ? '正在生成报告…' : block.title}</h2>
      {pending && (
        <div className="mt-3 flex items-center gap-1 text-[var(--fa-faint)]" aria-label="正在生成报告">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--fa-faint)]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--fa-faint)] [animation-delay:100ms]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--fa-faint)] [animation-delay:200ms]" />
        </div>
      )}
      {!pending && (
        <>
          <div className="mt-4 space-y-4">
            {SECTION_ROWS.map((row) => (
              <div key={row.key}>
                <h3 className="mb-1.5 text-[11px] font-medium tracking-wide text-[var(--fa-faint)]">
                  {row.label}
                </h3>
                <div className="prose prose-fa prose-sm max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: MarkdownExternalLink }}>
                    {block.sections?.[row.key] || '—'}
                  </ReactMarkdown>
                </div>
              </div>
            ))}
          </div>
          {block.disclaimer ? (
            <p className="mt-4 text-[11px] leading-relaxed text-[var(--fa-faint)]">{block.disclaimer}</p>
          ) : null}
        </>
      )}
    </div>
  )
}

export default ReportCard
