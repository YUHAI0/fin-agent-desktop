import React from 'react'
import { ExternalLink, FileText } from 'lucide-react'
import { MarkdownExternalLink } from '../ExternalLink'
import {
  NEWS_SOURCE_LABELS,
  NEWS_SENTIMENT_LABELS,
  formatNewsTime,
  hasNewsUrl,
  sentimentBadgeClass
} from '../../utils/news'
import { NEWS_CARD_INTENT_LABELS, type NewsCardPayload } from '../../utils/chatPrefill'

const NewsChatCard: React.FC<{ payload: NewsCardPayload }> = ({ payload }) => {
  const { intent, news } = payload
  const linkable = hasNewsUrl(news)
  return (
    <div className="fa-news-chat-card">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className="fa-news-chat-intent">{NEWS_CARD_INTENT_LABELS[intent]}</span>
        {news.sentiment ? (
          <span className={sentimentBadgeClass(news.sentiment as NewsSentiment)}>
            {NEWS_SENTIMENT_LABELS[news.sentiment as NewsSentiment]}
          </span>
        ) : null}
        <span className={`fa-news-item-kind ${linkable ? 'fa-news-item-kind--link' : 'fa-news-item-kind--summary'}`}>
          {linkable ? '原文' : '仅摘要'}
        </span>
      </div>
      <div className="flex items-start gap-1.5">
        {linkable ? (
          <MarkdownExternalLink href={news.url} className="fa-news-item-title fa-news-item-title--link min-w-0 flex-1 font-medium">
            {news.title}
          </MarkdownExternalLink>
        ) : (
          <h3 className="fa-news-item-title min-w-0 flex-1 font-medium">{news.title}</h3>
        )}
        {linkable ? (
          <ExternalLink size={13} className="mt-0.5 shrink-0 text-[var(--fa-faint)]" aria-hidden />
        ) : (
          <FileText size={13} className="mt-0.5 shrink-0 text-[var(--fa-faint)]" aria-hidden />
        )}
      </div>
      {news.summary ? (
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--fa-muted)]">{news.summary}</p>
      ) : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--fa-faint)]">
        <span>{NEWS_SOURCE_LABELS[news.source as NewsSource] || news.source}</span>
        <span>{formatNewsTime(news.published_at)}</span>
        {(news.matched_symbols || []).map((symbol) => (
          <span key={symbol} className="fa-news-tag">
            {symbol}
          </span>
        ))}
      </div>
    </div>
  )
}

export default NewsChatCard
