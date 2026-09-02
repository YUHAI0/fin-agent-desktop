import React, { useState } from 'react'
import { Bookmark } from 'lucide-react'
import { useAppDialog } from '../contexts/AppDialogContext'
import type { ChatBlock } from '../contexts/ChatContext'

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

export interface ReportCardProps {
  block: ChatBlockReport
  sessionId: string | null
  onFavoriteId: (id: string | undefined) => void
}

const ReportCard: React.FC<ReportCardProps> = ({ block, sessionId, onFavoriteId }) => {
  const { alert } = useAppDialog()
  const [busy, setBusy] = useState(false)
  const saved = Boolean(block.favorite_id)

  const toggleFavorite = async () => {
    if (busy) return
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
    <div className="fa-report-card">
      <div className="flex flex-wrap items-center gap-2">
        <span className="fa-report-kind">{KIND_LABEL[block.kind]}</span>
        <span className="fa-report-depth">{DEPTH_LABEL[block.depth]}</span>
        <button
          type="button"
          className="fa-btn-ghost ml-auto px-2 py-1 text-xs"
          disabled={busy}
          onClick={() => void toggleFavorite()}
        >
          <Bookmark size={14} className="mr-1 inline" />
          {saved ? '已收藏' : '收藏'}
        </button>
      </div>
      <h2 className="mt-2 text-sm font-semibold">{block.title}</h2>
    </div>
  )
}

export default ReportCard
