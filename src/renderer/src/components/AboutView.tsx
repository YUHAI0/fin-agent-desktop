import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react'
import donateWechat from '../assets/donate-wechat.png'
import SubPageShell from './SubPageShell'

const GITHUB_REPO = 'https://github.com/YUHAI0/fin-agent-desktop'
const GITHUB_SPONSORS = 'https://github.com/sponsors/YUHAI0'
const OFFICIAL_SITE = 'https://fin-agent.chat'
/** 暂时隐藏 GitHub Sponsors 入口，需要时改回 true */
const SHOW_GITHUB_SPONSORS = false

const AboutView: React.FC = () => {
  const navigate = useNavigate()
  const [version, setVersion] = useState('')
  const [checking, setChecking] = useState(false)
  const [checkMsg, setCheckMsg] = useState<string | null>(null)
  const [checkTone, setCheckTone] = useState<'muted' | 'ok' | 'err'>('muted')

  useEffect(() => {
    void window.api.getVersion().then(setVersion)
  }, [])

  const open = (url: string) => () => void window.api.openExternal(url)

  const handleCheckUpdate = async () => {
    if (checking) return
    setChecking(true)
    setCheckMsg('正在检查更新…')
    setCheckTone('muted')
    try {
      const res = await window.api.checkForUpdates()
      if (res.status === 'available') {
        setCheckMsg(`发现新版本 v${res.version}，已打开更新窗口`)
        setCheckTone('ok')
      } else if (res.status === 'uptodate') {
        setCheckMsg(`已是最新版本（v${res.currentVersion}）`)
        setCheckTone('ok')
      } else if (res.status === 'no_asset') {
        setCheckMsg(`远端有 v${res.version}，但未找到当前平台的安装包`)
        setCheckTone('err')
      } else {
        setCheckMsg(res.error || '检查失败')
        setCheckTone('err')
      }
    } catch (e) {
      setCheckMsg(e instanceof Error ? e.message : String(e))
      setCheckTone('err')
    } finally {
      setChecking(false)
    }
  }

  return (
    <SubPageShell>
      <div className="fa-page-header shrink-0">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="cursor-pointer rounded-lg p-2 text-[var(--fa-muted)] transition-colors duration-200 hover:bg-[var(--fa-surface-hover)] hover:text-[var(--fa-text)]"
          title="返回"
          aria-label="返回"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-sm font-semibold">关于 / 支持</h1>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-xl px-6 py-10">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--fa-accent-soft)] text-lg font-semibold text-[var(--fa-accent)]">
            FA
          </div>
          <h2 className="text-xl font-semibold tracking-tight">Fin-Agent</h2>
          <p className="mt-1 text-sm text-[var(--fa-muted)]">v{version}</p>
          <p className="mt-4 text-sm leading-relaxed text-[var(--fa-muted)]">
            一个跑在本地的 AI 金融助手：用自然语言查行情、读财报、管持仓、设价格提醒，
            数据与配置全部保存在你自己的电脑上。
          </p>
          <div className="mt-5 flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCheckUpdate()}
              disabled={checking}
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--fa-border)] bg-[var(--fa-surface)] px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--fa-surface-hover)] disabled:cursor-wait disabled:opacity-60"
            >
              {checking ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              {checking ? '检查中…' : '检查并更新'}
            </button>
            {checkMsg && (
              <p
                className={`text-xs ${
                  checkTone === 'ok'
                    ? 'text-emerald-400'
                    : checkTone === 'err'
                      ? 'text-red-400'
                      : 'text-[var(--fa-faint)]'
                }`}
              >
                {checkMsg}
              </p>
            )}
          </div>
        </div>

        <div className="mt-8 space-y-3">
          <button
            type="button"
            onClick={open(GITHUB_REPO)}
            className="fa-card w-full cursor-pointer px-4 py-3 text-left transition-colors duration-200 hover:bg-[var(--fa-surface-hover)]"
          >
            <div className="text-sm font-medium">在 GitHub 上给个 Star</div>
            <div className="mt-0.5 text-xs text-[var(--fa-faint)]">不花钱的支持，也是最实在的鼓励</div>
          </button>

          {SHOW_GITHUB_SPONSORS && (
            <button
              type="button"
              onClick={open(GITHUB_SPONSORS)}
              className="fa-card w-full cursor-pointer px-4 py-3 text-left transition-colors duration-200 hover:bg-[var(--fa-surface-hover)]"
            >
              <div className="text-sm font-medium">GitHub Sponsors</div>
              <div className="mt-0.5 text-xs text-[var(--fa-faint)]">通过 GitHub 定期或一次性赞助</div>
            </button>
          )}

          <button
            type="button"
            onClick={open(OFFICIAL_SITE)}
            className="fa-card w-full cursor-pointer px-4 py-3 text-left transition-colors duration-200 hover:bg-[var(--fa-surface-hover)]"
          >
            <div className="text-sm font-medium">访问官网</div>
            <div className="mt-0.5 text-xs text-[var(--fa-faint)]">{OFFICIAL_SITE}</div>
          </button>
        </div>

        <div className="mt-10 text-center">
          <p className="text-sm font-medium">微信赞助</p>
          <p className="mt-1 text-xs text-[var(--fa-faint)]">
            如果这个工具帮到了你，请我喝杯咖啡，让我更有动力完善这个软件
          </p>
          <img
            src={donateWechat}
            alt="微信收款码"
            className="mx-auto mt-4 h-44 w-44 rounded-xl border border-[var(--fa-border)] object-contain bg-white p-2"
          />
        </div>
      </div>
      </div>
    </SubPageShell>
  )
}

export default AboutView
