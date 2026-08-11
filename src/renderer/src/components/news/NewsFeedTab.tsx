import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ExternalLink, Loader2, Search, X } from 'lucide-react'
import FaSelect from '../FaSelect'
import { useAppDialog } from '../../contexts/AppDialogContext'
import { NEWS_SOURCE_LABELS, NEWS_TYPE_LABELS, formatNewsTime } from '../../utils/news'

const PAGE_SIZE = 20

export interface NewsFocusRequest {
  seq: number
  newsId?: string
  subscriptionId?: string
}

interface NewsFeedTabProps {
  subscriptions: NewsSubscription[]
  focusRequest: NewsFocusRequest | null
  manualRefreshToken: number
  reloadToken: number
  onUnreadChanged: () => void
}

type UnreadFilter = 'all' | 'unread'

const NewsFeedTab: React.FC<NewsFeedTabProps> = ({
  subscriptions,
  focusRequest,
  manualRefreshToken,
  reloadToken,
  onUnreadChanged
}) => {
  const [unreadFilter, setUnreadFilter] = useState<UnreadFilter>('all')
  const [typeFilter, setTypeFilter] = useState<'' | NewsSubscriptionType>('')
  const [sourceFilter, setSourceFilter] = useState<'' | NewsSource>('')
  const [subscriptionFilter, setSubscriptionFilter] = useState('')
  const [queryDraft, setQueryDraft] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')

  const [items, setItems] = useState<NotifiedNewsItem[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')

  const [monitorStatus, setMonitorStatus] = useState<NewsMonitorStatus | null>(null)
  const [manualRefreshing, setManualRefreshing] = useState(false)
  const [highlightId, setHighlightId] = useState('')

  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const skipFirstManualToken = useRef(true)
  const skipFirstReloadToken = useRef(true)
  const pageRef = useRef(1)
  pageRef.current = page
  const requestSeqRef = useRef(0)
  const ensuredFocusSeqRef = useRef<number | null>(null)
  const { alert } = useAppDialog()

  const subscriptionNameMap = useMemo(() => {
    const map = new Map<string, NewsSubscription>()
    for (const sub of subscriptions) map.set(sub.id, sub)
    return map
  }, [subscriptions])

  const buildFilters = useCallback(
    (pageNum: number): NewsListFilters => ({
      page: pageNum,
      pageSize: PAGE_SIZE,
      unread: unreadFilter === 'unread' ? true : undefined,
      type: typeFilter || undefined,
      source: sourceFilter || undefined,
      subscriptionId: subscriptionFilter || undefined,
      query: appliedQuery || undefined
    }),
    [unreadFilter, typeFilter, sourceFilter, subscriptionFilter, appliedQuery]
  )

  const loadPage = useCallback(
    async (pageNum: number, mode: 'reset' | 'append') => {
      const requestId = ++requestSeqRef.current
      if (mode === 'reset') {
        setLoading(true)
        setError('')
      } else {
        setLoadingMore(true)
      }
      try {
        const res = await window.api.listNews(buildFilters(pageNum))
        // 若在等待响应期间已发出更新的请求（筛选变化/翻页），丢弃这个过期响应，
        // 避免旧结果覆盖当前筛选条件下的最新数据
        if (requestSeqRef.current !== requestId) return
        setItems((prev) => {
          if (mode !== 'append') return res.items
          const seen = new Set(prev.map((i) => i.id))
          const merged = [...prev]
          for (const item of res.items) {
            if (!seen.has(item.id)) {
              seen.add(item.id)
              merged.push(item)
            }
          }
          return merged
        })
        setPage(res.page)
        setTotal(res.total)
        setHasMore(res.has_more)
      } catch (e) {
        if (requestSeqRef.current !== requestId) return
        setError(e instanceof Error ? e.message : '加载新闻失败')
        if (mode === 'reset') setItems([])
      } finally {
        if (requestSeqRef.current === requestId) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [buildFilters]
  )

  const loadMonitorStatus = useCallback(async () => {
    try {
      setMonitorStatus(await window.api.getNewsMonitorStatus())
    } catch {
      setMonitorStatus(null)
    }
  }, [])

  // 任意筛选条件变化都会重建 buildFilters -> loadPage，从而回到第一页重新加载
  useEffect(() => {
    void loadPage(1, 'reset')
  }, [loadPage])

  useEffect(() => {
    void loadMonitorStatus()
  }, [loadMonitorStatus])

  const performManualRefresh = useCallback(async () => {
    setManualRefreshing(true)
    try {
      await window.api.refreshNews()
    } catch {
      // 触发失败也继续尝试刷新列表，避免用户误以为完全无响应
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1500))
    await Promise.all([loadPage(1, 'reset'), loadMonitorStatus()])
    onUnreadChanged()
    setManualRefreshing(false)
  }, [loadPage, loadMonitorStatus, onUnreadChanged])

  useEffect(() => {
    if (skipFirstManualToken.current) {
      skipFirstManualToken.current = false
      return
    }
    void performManualRefresh()
    // manualRefreshToken 由父组件在点击刷新按钮时自增，仅需响应其变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualRefreshToken])

  useEffect(() => {
    if (skipFirstReloadToken.current) {
      skipFirstReloadToken.current = false
      return
    }
    void loadPage(pageRef.current, 'reset')
    // reloadToken 由父组件在全部已读等操作后自增，仅需响应其变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken])

  useEffect(() => {
    if (!focusRequest) return
    setUnreadFilter('all')
    setTypeFilter('')
    setSourceFilter('')
    setAppliedQuery('')
    setQueryDraft('')
    setSubscriptionFilter(focusRequest.subscriptionId || '')
    setHighlightId(focusRequest.newsId || '')
    // 只在收到新的定位请求（seq 变化）时重置筛选，避免覆盖用户后续手动调整
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.seq])

  // 精确定位：常规列表筛选完成后若目标新闻仍不在当前页中（例如它不满足筛选条件
  // 或排在更靠后的分页），通过后端 id 精确过滤补齐并置顶展示，避免依赖手动翻页查找
  useEffect(() => {
    if (!focusRequest?.newsId) return
    const targetId = focusRequest.newsId
    const seq = focusRequest.seq
    if (ensuredFocusSeqRef.current === seq) return
    if (items.some((i) => i.id === targetId)) {
      ensuredFocusSeqRef.current = seq
      return
    }
    if (loading) return
    ensuredFocusSeqRef.current = seq
    void (async () => {
      try {
        const res = await window.api.listNews({ newsId: targetId, pageSize: 1 })
        const target = res.items[0]
        if (target) {
          setItems((prev) => (prev.some((i) => i.id === target.id) ? prev : [target, ...prev]))
        }
      } catch {
        // 精确定位失败时静默降级，用户仍可在常规列表中手动查找
      }
    })()
  }, [focusRequest, items, loading])

  useEffect(() => {
    if (!highlightId) return
    const node = itemRefs.current.get(highlightId)
    node?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const timer = window.setTimeout(() => setHighlightId(''), 2600)
    return () => window.clearTimeout(timer)
  }, [highlightId, items])

  const handleLoadMore = () => {
    if (loadingMore || !hasMore) return
    void loadPage(page + 1, 'append')
  }

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setAppliedQuery(queryDraft.trim())
  }

  const handleClearQuery = () => {
    setQueryDraft('')
    setAppliedQuery('')
  }

  const handleOpenItem = async (item: NotifiedNewsItem) => {
    if (!item.read) {
      // 仅乐观更新本地列表；未读数刷新必须等 markNewsRead 落地后再触发，
      // 否则并发的 GET /news/unread-count 可能抢先返回，读到标记前的旧计数
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, read: true } : i)))
      let markFailed = false
      let markError = ''
      try {
        const res = await window.api.markNewsRead(item.id, true)
        if (!res?.success) {
          markFailed = true
          markError = res?.error || '标记失败'
        }
      } catch (e) {
        markFailed = true
        markError = e instanceof Error ? e.message : ''
      }
      if (markFailed) {
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, read: false } : i)))
        onUnreadChanged()
        await alert({ title: '标记已读失败', message: markError || '请稍后重试' })
      } else {
        onUnreadChanged()
      }
    }
    const rawUrl = (item.url || '').trim()
    if (rawUrl) {
      const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`
      try {
        const res = await window.api.openExternal(url)
        if (!res?.success) {
          await alert({
            title: '打开链接失败',
            message: res?.error || '无法打开外部链接'
          })
        }
      } catch (e) {
        await alert({
          title: '打开链接失败',
          message: e instanceof Error ? e.message : '无法打开外部链接'
        })
      }
    }
  }

  const monitorWarning = monitorStatus && !monitorStatus.running
  const monitorError = monitorStatus?.last_error
  const sourceHealth = monitorStatus?.source_health
  const backingOffSourceLabels = sourceHealth
    ? Object.keys(sourceHealth.sources).map((s) => NEWS_SOURCE_LABELS[s as NewsSource] || s)
    : []
  const backingOffSymbolCount = sourceHealth
    ? Object.values(sourceHealth.symbol_sources).reduce(
        (sum, symbols) => sum + Object.keys(symbols).length,
        0
      )
    : 0
  const hasSourceBackoff = backingOffSourceLabels.length > 0 || backingOffSymbolCount > 0

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--fa-border-subtle)] px-4 py-3">
        <div className="flex shrink-0 overflow-hidden rounded-xl border border-[var(--fa-border)]">
          <button
            type="button"
            onClick={() => setUnreadFilter('all')}
            aria-pressed={unreadFilter === 'all'}
            className={`cursor-pointer px-3 py-1.5 text-xs transition-colors duration-200 ${
              unreadFilter === 'all'
                ? 'bg-[var(--fa-text)] text-[var(--fa-bg)]'
                : 'text-[var(--fa-muted)] hover:bg-[var(--fa-surface-hover)]'
            }`}
          >
            全部
          </button>
          <button
            type="button"
            onClick={() => setUnreadFilter('unread')}
            aria-pressed={unreadFilter === 'unread'}
            className={`cursor-pointer px-3 py-1.5 text-xs transition-colors duration-200 ${
              unreadFilter === 'unread'
                ? 'bg-[var(--fa-text)] text-[var(--fa-bg)]'
                : 'text-[var(--fa-muted)] hover:bg-[var(--fa-surface-hover)]'
            }`}
          >
            未读
          </button>
        </div>

        <FaSelect
          className="w-28 shrink-0"
          value={typeFilter || 'all'}
          aria-label="按订阅类型筛选"
          onChange={(v) => setTypeFilter(v === 'all' ? '' : (v as NewsSubscriptionType))}
          options={[
            { value: 'all', label: '全部类型' },
            ...Object.entries(NEWS_TYPE_LABELS).map(([value, label]) => ({ value, label }))
          ]}
        />

        <FaSelect
          className="w-40 shrink-0"
          value={sourceFilter || 'all'}
          aria-label="按来源筛选"
          onChange={(v) => setSourceFilter(v === 'all' ? '' : (v as NewsSource))}
          options={[
            { value: 'all', label: '全部来源' },
            ...Object.entries(NEWS_SOURCE_LABELS).map(([value, label]) => ({ value, label }))
          ]}
        />

        <form onSubmit={handleSearchSubmit} className="relative min-w-[9rem] flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fa-faint)]"
            aria-hidden
          />
          <input
            value={queryDraft}
            onChange={(e) => setQueryDraft(e.target.value)}
            placeholder="按标题、摘要或代码搜索"
            className="fa-input !py-1.5 pl-8 pr-8 text-xs"
            aria-label="搜索关键词"
          />
          {queryDraft && (
            <button
              type="button"
              onClick={handleClearQuery}
              className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-[var(--fa-faint)] transition-colors duration-200 hover:text-[var(--fa-text)]"
              aria-label="清除搜索"
            >
              <X size={14} />
            </button>
          )}
        </form>

        {subscriptionFilter && (
          <button
            type="button"
            onClick={() => setSubscriptionFilter('')}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-[var(--fa-accent-soft)] px-2.5 py-1 text-xs text-[var(--fa-accent)] transition-opacity duration-200 hover:opacity-80"
            title="清除订阅定位"
          >
            订阅：{subscriptionNameMap.get(subscriptionFilter)?.name || subscriptionFilter}
            <X size={12} />
          </button>
        )}
      </div>

      {monitorWarning && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
          <AlertTriangle size={14} className="shrink-0" />
          新闻监控当前未运行，以下为历史记录，可点击刷新重试
        </div>
      )}
      {monitorError && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-[var(--fa-danger)]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">最近一次抓取出错：{monitorError}</span>
        </div>
      )}
      {hasSourceBackoff && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">
            {[
              ...backingOffSourceLabels,
              backingOffSymbolCount > 0 ? `${backingOffSymbolCount} 个个股来源` : ''
            ]
              .filter(Boolean)
              .join('、')}
            正在退避重试，不影响已抓取的历史新闻
          </span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-3">
        {loading && items.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--fa-muted)]">
            <Loader2 className="animate-spin" size={16} />
            正在加载新闻…
          </div>
        )}

        {!loading && error && items.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <AlertTriangle size={22} className="text-[var(--fa-danger)]" />
            <p className="text-sm text-[var(--fa-muted)]">{error}</p>
            <button
              type="button"
              onClick={() => void performManualRefresh()}
              disabled={manualRefreshing}
              className="fa-btn-ghost px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {manualRefreshing ? '重试中…' : '重试'}
            </button>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="text-sm text-[var(--fa-muted)]">暂无符合条件的新闻</p>
            <p className="fa-hint">调整筛选条件，或前往订阅管理添加关注</p>
          </div>
        )}

        {items.length > 0 && (
          <ul className="space-y-2">
            {items.map((item) => {
              const matchedSubs = (item.matched_subscription_ids || [])
                .map((id) => subscriptionNameMap.get(id))
                .filter((s): s is NewsSubscription => Boolean(s))
              const isHighlighted = highlightId === item.id
              return (
                <li key={item.id}>
                  <div
                    ref={(node) => {
                      if (node) itemRefs.current.set(item.id, node)
                      else itemRefs.current.delete(item.id)
                    }}
                    role="button"
                    tabIndex={0}
                    onClick={() => void handleOpenItem(item)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        void handleOpenItem(item)
                      }
                    }}
                    className={`fa-news-item focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fa-accent)] ${
                      !item.read ? 'fa-news-item-unread' : ''
                    } ${isHighlighted ? 'ring-2 ring-[var(--fa-accent)]' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        {!item.read && <span className="fa-news-dot" aria-hidden />}
                        <h3 className="min-w-0 truncate text-sm font-medium text-[var(--fa-text)]">
                          {item.title}
                        </h3>
                      </div>
                      <ExternalLink size={13} className="mt-0.5 shrink-0 text-[var(--fa-faint)]" aria-hidden />
                    </div>
                    {item.summary && (
                      <p className="line-clamp-2 text-xs leading-relaxed text-[var(--fa-muted)]">{item.summary}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--fa-faint)]">
                      <span>{NEWS_SOURCE_LABELS[item.source] || item.source}</span>
                      <span>{formatNewsTime(item.published_at)}</span>
                      {matchedSubs.map((sub) => (
                        <span key={sub.id} className="fa-news-tag">
                          {sub.name}
                        </span>
                      ))}
                      {item.matched_symbols.map((symbol) => (
                        <span key={symbol} className="fa-news-tag">
                          {symbol}
                        </span>
                      ))}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {hasMore && (
          <div className="flex justify-center py-4">
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="fa-btn-ghost px-4 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingMore ? '加载中…' : `加载更多（剩余 ${Math.max(total - items.length, 0)} 条）`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default NewsFeedTab
