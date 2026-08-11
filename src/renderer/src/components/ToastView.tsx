import React, { useEffect, useRef, useState } from 'react'
import { Bell, X, ArrowUpRight } from 'lucide-react'

type ToastPayload = {
  _title: string
  _body: string
  type?: string
  news_id?: string | null
  subscription_id?: string | null
  task_id?: string
  ts_code?: string
  // window id passed from main so click/close ipc channel can be targeted
  _winId?: number
}

export default function ToastView(): JSX.Element {
  const [payload, setPayload] = useState<ToastPayload | null>(null)
  const [visible, setVisible] = useState(false)
  const winIdRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    document.documentElement.classList.add('fa-toast-page')

    // 同步主题
    const storedTheme = localStorage.getItem('fa-theme') || 'dark'
    document.documentElement.dataset.theme = storedTheme

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'fa-theme' && e.newValue) {
        document.documentElement.dataset.theme = e.newValue
      }
    }
    window.addEventListener('storage', onStorage)

    const onShow = (_: unknown, data: ToastPayload) => {
      winIdRef.current = data._winId
      setPayload(data)
      // tiny delay so CSS transition can run
      requestAnimationFrame(() => setVisible(true))
    }

    const onDismiss = () => {
      setVisible(false)
    }

    // electron exposes these via preload
    const u1 = (window as any).electronBus?.on?.('toast-show', onShow)
    const u2 = (window as any).electronBus?.on?.('toast-dismiss', onDismiss)
    return () => {
      u1?.()
      u2?.()
      document.documentElement.classList.remove('fa-toast-page')
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const handleClick = () => {
    setVisible(false)
    ;(window as any).api?.toastClick?.()
  }

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation()
    setVisible(false)
    ;(window as any).api?.toastClose?.()
  }

  const isNews = payload?.type === 'news' || !!payload?.news_id
  const isPriceAlert = payload?.type === 'price_alert'

  return (
    <div
      className="fa-toast-root"
      data-visible={visible}
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
              {(isNews || isPriceAlert) && (
                <span className="fa-toast-tag">
                  {isPriceAlert ? '价格提醒' : '新闻'}
                </span>
              )}
              <ArrowUpRight size={12} className="fa-toast-arrow" />
            </div>
            <div className="fa-toast-title">{payload._title}</div>
            {payload._body && (
              <div className="fa-toast-body">{payload._body}</div>
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
