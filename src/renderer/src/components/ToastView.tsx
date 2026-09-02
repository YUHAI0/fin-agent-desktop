import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Bell, X, ArrowUpRight } from 'lucide-react'
import { NEWS_SENTIMENT_LABELS, sentimentBadgeClass } from '../utils/news'
import { buildNewsImpactPrefill } from '../utils/chatPrefill'

type NewsSentiment = 'bullish' | 'bearish' | 'neutral'

type SentimentCounts = {
  bullish?: number
  bearish?: number
  neutral?: number
  unknown?: number
}

type ToastPayload = {
  _title: string
  _body: string
  type?: string
  news_id?: string | null
  merged?: boolean
  news_count?: number
  sentiment?: NewsSentiment | null
  sentiment_counts?: SentimentCounts
  subscription_id?: string | null
  task_id?: string
  ts_code?: string
  _winId?: number
}

function SentimentBadges({
  sentiment,
  counts,
  merged
}: {
  sentiment?: NewsSentiment | null
  counts?: SentimentCounts
  merged?: boolean
}): JSX.Element | null {
  if (merged && counts) {
    const chips: Array<{ key: NewsSentiment; n: number }> = []
    if ((counts.bullish || 0) > 0) chips.push({ key: 'bullish', n: counts.bullish || 0 })
    if ((counts.bearish || 0) > 0) chips.push({ key: 'bearish', n: counts.bearish || 0 })
    if ((counts.neutral || 0) > 0) chips.push({ key: 'neutral', n: counts.neutral || 0 })
    if (!chips.length) return null
    return (
      <>
        {chips.map(({ key, n }) => (
          <span key={key} className={`fa-toast-sentiment ${sentimentBadgeClass(key)}`}>
            {NEWS_SENTIMENT_LABELS[key]} {n}
          </span>
        ))}
      </>
    )
  }
  if (sentiment && NEWS_SENTIMENT_LABELS[sentiment]) {
    return (
      <span className={`fa-toast-sentiment ${sentimentBadgeClass(sentiment)}`}>
        {NEWS_SENTIMENT_LABELS[sentiment]}
      </span>
    )
  }
  return null
}

export default function ToastView(): JSX.Element {
  const [payload, setPayload] = useState<ToastPayload | null>(null)
  const [visible, setVisible] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const shownSentRef = useRef(false)

  useEffect(() => {
    document.documentElement.classList.add('fa-toast-page')

    const storedTheme = localStorage.getItem('fa-theme') || 'dark'
    document.documentElement.dataset.theme = storedTheme
    void window.api.setToastChrome?.(storedTheme)

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'fa-theme' && e.newValue) {
        document.documentElement.dataset.theme = e.newValue
        void window.api.setToastChrome?.(e.newValue)
      }
    }
    window.addEventListener('storage', onStorage)

    // electronBus 回调只有 data 一个参数（不是 Node 风格的 event, data）
    const onShow = (data: ToastPayload) => {
      const title = typeof data?._title === 'string' ? data._title.trim() : ''
      const body = typeof data?._body === 'string' ? data._body.trim() : ''
      if (!title && !body) return
      shownSentRef.current = false
      setPayload({ ...data, _title: data._title || title, _body: data._body || body })
      requestAnimationFrame(() => setVisible(true))
    }

    const onDismiss = () => {
      setVisible(false)
    }

    const bus = (window as any).electronBus
    const u1 = bus?.on?.('toast-show', onShow)
    const u2 = bus?.on?.('toast-dismiss', onDismiss)

    // 兜底：若 toast-show 在 React 挂载前已发出，从 main 拉取 pending
    void window.api.getPendingToast?.().then((pending) => {
      if (pending) onShow(pending)
    })

    return () => {
      u1?.()
      u2?.()
      document.documentElement.classList.remove('fa-toast-page')
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const isNews = payload?.type === 'news' || !!payload?.news_id || !!payload?.merged
  const isWatchlistMove = payload?.type === 'watchlist_move'
  const isPriceAlert = payload?.type === 'price_alert' || isWatchlistMove
  const isAppUpdate = payload?.type === 'app_update'
  const tagLabel = isWatchlistMove
    ? '自选异动'
    : payload?.type === 'price_alert'
      ? '价格提醒'
      : isAppUpdate
        ? '更新'
        : isNews
          ? '新闻'
          : ''

  // 按内容高度自适应窗口，避免固定高度留白
  useLayoutEffect(() => {
    if (!payload || !visible) return
    const root = rootRef.current
    if (!root) return

    const apply = () => {
      // scrollHeight 不受当前 BrowserWindow 裁剪影响，避免测到占位高度
      const h = Math.ceil(
        Math.max(root.scrollHeight || 0, root.offsetHeight || 0)
      )
      const confirmShown = () => {
        if (!shownSentRef.current) {
          shownSentRef.current = true
          window.api.toastShown?.()
        }
      }
      if (h > 0) {
        const variant = isPriceAlert ? 'price_alert' : isNews ? 'news' : 'default'
        void window.api.resizeToast?.(h, variant).finally(confirmShown)
      } else {
        // 高度尚未量到也先确认内容已渲染，避免主进程空窗超时关闭
        confirmShown()
      }
    }

    apply()
    const raf = requestAnimationFrame(apply)
    return () => cancelAnimationFrame(raf)
  }, [payload, visible, isPriceAlert, isNews])

  const handleClick = () => {
    setVisible(false)
    window.api.toastClick?.()
  }

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation()
    setVisible(false)
    window.api.toastClose?.()
  }

  const handleAnalyze = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!payload) return
    const text = buildNewsImpactPrefill(payload._title || '', payload._body || '')
    window.api.focusMainPrefill?.(text)
    setVisible(false)
    window.api.toastClose?.()
  }

  return (
    <div
      ref={rootRef}
      className="fa-toast-root"
      data-visible={visible}
      data-news={isNews ? 'true' : undefined}
      data-price-alert={isPriceAlert ? 'true' : undefined}
      onClick={handleClick}
      style={{ cursor: 'pointer' }}
    >
      {payload && (
        <>
          <div className="fa-toast-icon-col">
            <div className="fa-toast-icon">
              <Bell size={15} />
            </div>
          </div>

          <div className="fa-toast-content">
            <div className="fa-toast-header">
              <span className="fa-toast-app">Fin-Agent</span>
              {tagLabel && <span className="fa-toast-tag">{tagLabel}</span>}
              <SentimentBadges
                sentiment={payload.sentiment}
                counts={payload.sentiment_counts}
                merged={payload.merged}
              />
              <ArrowUpRight size={12} className="fa-toast-arrow" />
            </div>
            <div className="fa-toast-title">{payload._title}</div>
            {payload._body && (
              <div className="fa-toast-body">{payload._body}</div>
            )}
            {isNews && (
              <button
                type="button"
                className="fa-toast-analyze"
                onClick={handleAnalyze}
              >
                分析对持仓影响
              </button>
            )}
          </div>

          <button
            className="fa-toast-close"
            onClick={handleClose}
            tabIndex={-1}
            aria-label="关闭"
          >
            <X size={13} />
          </button>
        </>
      )}
    </div>
  )
}
