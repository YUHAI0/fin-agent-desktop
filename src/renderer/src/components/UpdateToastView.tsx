import React, { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Download, X, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react'

type Stage = 'available' | 'downloading' | 'done' | 'error'

interface DownloadProgress {
  percent: number
  received: number
  total: number
}

const COMPACT_HEIGHT = 176
const MAX_HEIGHT = 560
const NOTES_MAX = 400

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

export default function UpdateToastView(): JSX.Element {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [visible, setVisible] = useState(false)
  const [stage, setStage] = useState<Stage>('available')
  const [progress, setProgress] = useState<DownloadProgress>({ percent: 0, received: 0, total: 0 })
  const [errorMsg, setErrorMsg] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const notesRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Stage>('available')
  const readySentRef = useRef(false)

  const notifyReady = useCallback(() => {
    if (readySentRef.current) return
    readySentRef.current = true
    window.api.updateToastReady?.()
  }, [])

  const applyWindowHeight = useCallback(
    (height: number) => {
      const h = Math.max(COMPACT_HEIGHT, Math.min(MAX_HEIGHT, Math.round(height)))
      const run = async () => {
        if (typeof window.api?.resizeUpdateToast === 'function') {
          await window.api.resizeUpdateToast(h)
        }
        // 首帧尺寸到位后再揭幕，避免空窗/白闪
        notifyReady()
      }
      void run()
    },
    [notifyReady]
  )

  const syncWindowSize = useCallback(
    (nextStage: Stage = stageRef.current) => {
      stageRef.current = nextStage
      if (nextStage !== 'available') {
        applyWindowHeight(COMPACT_HEIGHT)
        return
      }
      const root = rootRef.current
      const notes = notesRef.current
      if (!root) {
        applyWindowHeight(320)
        return
      }
      const header = root.querySelector('.fa-update-toast-header') as HTMLElement | null
      const actions = root.querySelector('.fa-update-toast-actions') as HTMLElement | null
      const body = root.querySelector('.fa-update-toast-body') as HTMLElement | null
      const headerH = header?.offsetHeight ?? 48
      const actionsH = actions?.offsetHeight ?? 52
      const bodyStyles = body ? getComputedStyle(body) : null
      const bodyPad = bodyStyles
        ? (parseFloat(bodyStyles.paddingTop) || 0) + (parseFloat(bodyStyles.paddingBottom) || 0)
        : 8
      // 用 scrollHeight 拿 markdown 真实高度（不受当前窗口裁剪影响）
      const notesFull = notes?.scrollHeight ?? 0
      const notesH = Math.min(NOTES_MAX, Math.max(notesFull, notes ? 80 : 0))
      applyWindowHeight(headerH + bodyPad + notesH + actionsH + 8)
    },
    [applyWindowHeight]
  )

  useEffect(() => {
    document.documentElement.classList.add('fa-toast-page')
    document.documentElement.classList.add('fa-update-toast-page')

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

    const onShow = (data: UpdateInfo) => {
      readySentRef.current = false
      setInfo(data)
      setStage('available')
      stageRef.current = 'available'
      setErrorMsg('')
      requestAnimationFrame(() => {
        setVisible(true)
        requestAnimationFrame(() => syncWindowSize('available'))
      })
    }

    const onDismiss = () => setVisible(false)

    const onProgress = (p: DownloadProgress) => setProgress(p)
    const onDone = () => {
      setStage('done')
      syncWindowSize('done')
    }
    const onError = (err: string) => {
      setErrorMsg(err)
      setStage('error')
      syncWindowSize('error')
    }

    const bus = (window as any).electronBus
    const u1 = bus?.on?.('update-show', onShow)
    const u2 = bus?.on?.('update-dismiss', onDismiss)
    const u3 = bus?.on?.('update-download-progress', onProgress)
    const u4 = bus?.on?.('update-download-done', onDone)
    const u5 = bus?.on?.('update-download-error', onError)

    void window.api.getPendingUpdate?.().then((pending) => {
      if (pending) onShow(pending)
    })

    return () => {
      u1?.()
      u2?.()
      u3?.()
      u4?.()
      u5?.()
      document.documentElement.classList.remove('fa-toast-page')
      document.documentElement.classList.remove('fa-update-toast-page')
      window.removeEventListener('storage', onStorage)
    }
  }, [syncWindowSize])

  // Markdown 渲染完成后持续校正高度
  useEffect(() => {
    if (!info || !visible || stage !== 'available') return
    const timers = [50, 150, 350, 700].map((ms) =>
      window.setTimeout(() => syncWindowSize('available'), ms)
    )
    const notes = notesRef.current
    let ro: ResizeObserver | null = null
    if (notes && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => syncWindowSize('available'))
      ro.observe(notes)
    }
    return () => {
      timers.forEach((id) => window.clearTimeout(id))
      ro?.disconnect()
    }
  }, [info, visible, stage, info?.releaseNotes, syncWindowSize])

  const handleDismiss = useCallback(() => {
    setVisible(false)
    window.api.updateToastDismiss?.()
  }, [])

  const handleDownload = useCallback(async () => {
    setStage('downloading')
    syncWindowSize('downloading')
    setProgress({ percent: 0, received: 0, total: 0 })
    const res = await window.api.startUpdateDownload()
    if (res?.cancelled) {
      setStage('available')
      syncWindowSize('available')
      return
    }
    if (res?.error) {
      setErrorMsg(res.error)
      setStage('error')
      syncWindowSize('error')
    }
  }, [syncWindowSize])

  const [installing, setInstalling] = useState(false)

  const handleInstall = useCallback(async () => {
    setInstalling(true)
    try {
      const res = await window.api.installUpdate()
      if (res?.error) {
        setErrorMsg(res.error)
        setStage('error')
        syncWindowSize('error')
      }
    } finally {
      setInstalling(false)
    }
  }, [syncWindowSize])

  const showNotes = stage === 'available' && Boolean(info?.releaseNotes)

  if (!info) {
    return <div className="fa-update-toast-root" data-visible="true" aria-hidden />
  }

  return (
    <div
      ref={rootRef}
      className="fa-update-toast-root"
      data-visible="true"
      data-compact={stage !== 'available' ? 'true' : 'false'}
    >
      <div className="fa-update-toast-header">
        <div className="fa-update-toast-header-left">
          <div className="fa-toast-icon">
            <Download size={15} />
          </div>
          <span className="fa-update-toast-title">发现新版本</span>
          <span className="fa-update-toast-version">v{info.version}</span>
        </div>
        <button type="button" className="fa-toast-close" onClick={handleDismiss} aria-label="关闭">
          <X size={13} />
        </button>
      </div>

      <div className="fa-update-toast-body">
        {showNotes && (
          <div ref={notesRef} className="fa-update-toast-notes prose prose-fa prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{info.releaseNotes}</ReactMarkdown>
          </div>
        )}

        {stage === 'downloading' && (
          <div className="fa-update-toast-progress">
            <div className="fa-update-toast-progress-track">
              <div
                className="fa-update-toast-progress-bar"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <div className="fa-update-toast-progress-meta">
              <span className="flex items-center gap-1">
                <Loader2 size={11} className="animate-spin" />
                正在下载…
              </span>
              <span>
                {progress.total > 0
                  ? `${formatBytes(progress.received)} / ${formatBytes(progress.total)}`
                  : `${progress.percent}%`}
              </span>
            </div>
          </div>
        )}

        {stage === 'done' && (
          <div className="fa-update-toast-status fa-update-toast-status--ok">
            <CheckCircle size={13} />
            <span>下载完成，点击安装将关闭程序并更新</span>
          </div>
        )}

        {stage === 'error' && (
          <div className="fa-update-toast-status fa-update-toast-status--err">
            <AlertTriangle size={13} />
            <span>下载失败：{errorMsg}</span>
          </div>
        )}
      </div>

      <div className="fa-update-toast-actions">
        {stage === 'available' && (
          <>
            <button type="button" className="fa-update-toast-btn fa-update-toast-btn--ghost" onClick={handleDismiss}>
              稍后
            </button>
            <button type="button" className="fa-update-toast-btn fa-update-toast-btn--primary" onClick={handleDownload}>
              下载更新
            </button>
          </>
        )}
        {stage === 'downloading' && (
          <>
            <button type="button" className="fa-update-toast-btn fa-update-toast-btn--ghost" onClick={handleDismiss}>
              取消下载
            </button>
            <button type="button" className="fa-update-toast-btn fa-update-toast-btn--primary" disabled>
              下载中…
            </button>
          </>
        )}
        {stage === 'done' && (
          <button
            type="button"
            className="fa-update-toast-btn fa-update-toast-btn--primary"
            onClick={handleInstall}
            disabled={installing}
          >
            {installing ? '正在启动安装…' : '立即安装'}
          </button>
        )}
        {stage === 'error' && (
          <>
            <button type="button" className="fa-update-toast-btn fa-update-toast-btn--ghost" onClick={handleDismiss}>
              关闭
            </button>
            <button type="button" className="fa-update-toast-btn fa-update-toast-btn--primary" onClick={handleDownload}>
              重试
            </button>
          </>
        )}
      </div>
    </div>
  )
}
