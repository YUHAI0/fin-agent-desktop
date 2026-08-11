import React, { useCallback, useEffect, useState } from 'react'
import { Download, X, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react'

type Stage = 'available' | 'downloading' | 'done' | 'error'

interface DownloadProgress {
  percent: number
  received: number
  total: number
}

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

  useEffect(() => {
    document.documentElement.classList.add('fa-toast-page')

    const storedTheme = localStorage.getItem('fa-theme') || 'dark'
    document.documentElement.dataset.theme = storedTheme

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'fa-theme' && e.newValue) {
        document.documentElement.dataset.theme = e.newValue
      }
    }
    window.addEventListener('storage', onStorage)

    const onShow = (_: unknown, data: UpdateInfo) => {
      setInfo(data)
      setStage('available')
      setErrorMsg('')
      requestAnimationFrame(() => setVisible(true))
    }

    const onDismiss = () => setVisible(false)

    const onProgress = (_: unknown, p: DownloadProgress) => setProgress(p)
    const onDone = () => setStage('done')
    const onError = (_: unknown, err: string) => {
      setErrorMsg(err)
      setStage('error')
    }

    const bus = (window as any).electronBus
    const u1 = bus?.on?.('update-show', onShow)
    const u2 = bus?.on?.('update-dismiss', onDismiss)
    const u3 = bus?.on?.('update-download-progress', onProgress)
    const u4 = bus?.on?.('update-download-done', onDone)
    const u5 = bus?.on?.('update-download-error', onError)

    window.api.getPendingUpdate?.().then((pending) => {
      if (pending) onShow(null, pending)
    })

    return () => {
      u1?.()
      u2?.()
      u3?.()
      u4?.()
      u5?.()
      document.documentElement.classList.remove('fa-toast-page')
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const handleDismiss = useCallback(() => {
    if (stage === 'downloading') return
    setVisible(false)
    window.api.updateToastDismiss?.()
  }, [stage])

  const handleDownload = useCallback(async () => {
    setStage('downloading')
    setProgress({ percent: 0, received: 0, total: 0 })
    const res = await window.api.startUpdateDownload()
    if (res?.error) {
      setErrorMsg(res.error)
      setStage('error')
    }
  }, [])

  const handleInstall = useCallback(async () => {
    await window.api.installUpdate()
  }, [])

  if (!info) return <div className="fa-update-toast-root" />

  return (
    <div className="fa-update-toast-root" data-visible={visible}>
      <div className="fa-update-toast-header">
        <div className="fa-update-toast-header-left">
          <div className="fa-toast-icon">
            <Download size={15} />
          </div>
          <span className="fa-update-toast-title">发现新版本</span>
          <span className="fa-update-toast-version">v{info.version}</span>
        </div>
        {stage !== 'downloading' && (
          <button type="button" className="fa-toast-close" onClick={handleDismiss} aria-label="关闭">
            <X size={13} />
          </button>
        )}
      </div>

      <div className="fa-update-toast-body">
        {info.releaseNotes && (
          <div className="fa-update-toast-notes">{info.releaseNotes}</div>
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
          <button type="button" className="fa-update-toast-btn fa-update-toast-btn--primary" disabled>
            下载中…
          </button>
        )}
        {stage === 'done' && (
          <button type="button" className="fa-update-toast-btn fa-update-toast-btn--primary" onClick={handleInstall}>
            立即安装
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
