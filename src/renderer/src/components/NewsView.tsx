import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCheck, RefreshCw } from 'lucide-react'
import SubPageShell from './SubPageShell'
import NewsFeedTab, { NewsFocusRequest } from './news/NewsFeedTab'
import NewsSubscriptionsTab from './news/NewsSubscriptionsTab'

type NewsTab = 'feed' | 'subscriptions'

const NewsView: React.FC = () => {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<NewsTab>('feed')
  const [unreadCount, setUnreadCount] = useState(0)
  const [markingAll, setMarkingAll] = useState(false)
  const [manualRefreshToken, setManualRefreshToken] = useState(0)
  const [feedReloadToken, setFeedReloadToken] = useState(0)

  const [subscriptions, setSubscriptions] = useState<NewsSubscription[]>([])
  const [subscriptionsLoading, setSubscriptionsLoading] = useState(false)
  const [subscriptionsError, setSubscriptionsError] = useState('')

  const [focusRequest, setFocusRequest] = useState<NewsFocusRequest | null>(null)
  const focusSeqRef = useRef(0)
  const lastConsumedParamsRef = useRef('')

  const loadUnreadCount = useCallback(async () => {
    try {
      const res = await window.api.getNewsUnreadCount()
      setUnreadCount(res.count || 0)
    } catch {
      // 静默失败，保留上一次数值，避免闪烁误导
    }
  }, [])

  const loadSubscriptions = useCallback(async () => {
    setSubscriptionsLoading(true)
    setSubscriptionsError('')
    try {
      const res = await window.api.listNewsSubscriptions()
      if (Array.isArray(res.subscriptions)) {
        setSubscriptions(res.subscriptions)
      } else {
        setSubscriptionsError(res.error || '加载订阅失败')
      }
    } catch (e) {
      setSubscriptionsError(e instanceof Error ? e.message : '加载订阅失败')
    } finally {
      setSubscriptionsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadUnreadCount()
    void loadSubscriptions()
  }, [loadUnreadCount, loadSubscriptions])

  // 支持通过 URL query（如系统通知点击后跳转）定位到具体新闻/订阅。
  // 不能只消费一次：应用已停留在 /news 页面时，若再次通过 navigate-route 收到
  // 带有新 newsId/subscriptionId 的跳转（例如 onNewsNotificationOpen 事件被错过），
  // 也需要按值的变化持续响应，而不是被首次消费后永久锁死。
  useEffect(() => {
    const newsId = searchParams.get('newsId') || ''
    const subscriptionId = searchParams.get('subscriptionId') || ''
    if (!newsId && !subscriptionId) return
    const signature = `${newsId}|${subscriptionId}`
    if (signature === lastConsumedParamsRef.current) return
    lastConsumedParamsRef.current = signature
    focusSeqRef.current += 1
    setTab('feed')
    setFocusRequest({
      seq: focusSeqRef.current,
      newsId: newsId || undefined,
      subscriptionId: subscriptionId || undefined
    })
    setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams])

  // 应用已在 /news 页面时，点击系统通知需要直接定位，而非依赖路由参数变化
  useEffect(() => {
    const removeListener = window.api.onNewsNotificationOpen((payload) => {
      focusSeqRef.current += 1
      setTab('feed')
      setFocusRequest({
        seq: focusSeqRef.current,
        newsId: payload.newsId,
        subscriptionId: payload.subscriptionId
      })
      void loadUnreadCount()
    })
    return removeListener
  }, [loadUnreadCount])

  const handleMarkAllRead = async () => {
    if (unreadCount === 0 || markingAll) return
    setMarkingAll(true)
    try {
      await window.api.markAllNewsRead()
      await loadUnreadCount()
      setFeedReloadToken((v) => v + 1)
    } catch {
      // 静默失败，用户可再次点击重试
    } finally {
      setMarkingAll(false)
    }
  }

  const handleHeaderRefresh = () => {
    if (tab === 'feed') {
      setManualRefreshToken((v) => v + 1)
    } else {
      void loadSubscriptions()
    }
    void loadUnreadCount()
  }

  return (
    <SubPageShell>
      <div className="fa-page-header justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="cursor-pointer rounded-lg p-2 text-[var(--fa-muted)] transition-colors duration-200 hover:bg-[var(--fa-surface-hover)] hover:text-[var(--fa-text)]"
            title="返回"
            aria-label="返回"
          >
            <ArrowLeft size={18} />
          </button>
          <h1 className="truncate text-sm font-semibold">新闻中心</h1>
          {unreadCount > 0 && (
            <span className="fa-news-badge" aria-label={`${unreadCount} 条未读`}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={handleHeaderRefresh}
            className="fa-icon-btn"
            title="刷新"
            aria-label="刷新新闻"
          >
            <RefreshCw size={16} />
          </button>
          <button
            type="button"
            onClick={() => void handleMarkAllRead()}
            disabled={unreadCount === 0 || markingAll}
            className="fa-icon-btn inline-flex items-center gap-1.5 px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
            title="全部已读"
            aria-label="全部已读"
          >
            <CheckCheck size={16} />
            全部已读
          </button>
        </div>
      </div>

      <div className="fa-news-tabs">
        <button
          type="button"
          onClick={() => setTab('feed')}
          className={`fa-news-tab ${tab === 'feed' ? 'fa-news-tab-active' : ''}`}
        >
          新闻动态
        </button>
        <button
          type="button"
          onClick={() => setTab('subscriptions')}
          className={`fa-news-tab ${tab === 'subscriptions' ? 'fa-news-tab-active' : ''}`}
        >
          订阅管理
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'feed' ? (
          <NewsFeedTab
            subscriptions={subscriptions}
            focusRequest={focusRequest}
            manualRefreshToken={manualRefreshToken}
            reloadToken={feedReloadToken}
            onUnreadChanged={loadUnreadCount}
          />
        ) : (
          <NewsSubscriptionsTab
            subscriptions={subscriptions}
            loading={subscriptionsLoading}
            error={subscriptionsError}
            onChanged={loadSubscriptions}
          />
        )}
      </div>
    </SubPageShell>
  )
}

export default NewsView
