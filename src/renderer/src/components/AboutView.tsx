import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import donateWechat from '../assets/donate-wechat.png'

const GITHUB_REPO = 'https://github.com/YUHAI0/fin-agent-desktop'
const GITHUB_SPONSORS = 'https://github.com/sponsors/YUHAI0'
const OFFICIAL_SITE = 'https://fin-agent.chat'

const AboutView: React.FC = () => {
  const navigate = useNavigate()
  const [version, setVersion] = useState('')
  const [configDir, setConfigDir] = useState('')

  useEffect(() => {
    void window.api.getVersion().then(setVersion)
    void window.api.getConfigDir().then(setConfigDir)
  }, [])

  const open = (url: string) => () => void window.api.openExternal(url)

  return (
    <div className="h-screen overflow-y-auto bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200">
      <div className="flex items-center h-12 px-4 border-b border-gray-200 dark:border-gray-700">
        <button onClick={() => navigate(-1)} className="text-sm text-gray-500 hover:text-gray-800">
          ← 返回
        </button>
        <h1 className="ml-3 text-sm font-medium">关于 / 支持</h1>
      </div>

      <div className="max-w-xl mx-auto px-6 py-8">
        <div className="text-center">
          <h2 className="text-xl font-semibold">Fin-Agent</h2>
          <p className="text-sm text-gray-500 mt-1">v{version}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-4 leading-relaxed">
            一个跑在本地的 AI 金融助手：用自然语言查行情、读财报、管持仓、设价格提醒，
            数据与配置全部保存在你自己的电脑上。
          </p>
        </div>

        <div className="mt-8 space-y-3">
          <button
            onClick={open(GITHUB_REPO)}
            className="w-full px-4 py-3 text-left border rounded hover:bg-gray-50 dark:hover:bg-gray-800 dark:border-gray-700"
          >
            <div className="text-sm font-medium">在 GitHub 上给个 Star</div>
            <div className="text-xs text-gray-500 mt-0.5">不花钱的支持，也是最实在的鼓励</div>
          </button>

          <button
            onClick={open(GITHUB_SPONSORS)}
            className="w-full px-4 py-3 text-left border rounded hover:bg-gray-50 dark:hover:bg-gray-800 dark:border-gray-700"
          >
            <div className="text-sm font-medium">GitHub Sponsors</div>
            <div className="text-xs text-gray-500 mt-0.5">通过 GitHub 定期或一次性赞助</div>
          </button>

          <button
            onClick={open(OFFICIAL_SITE)}
            className="w-full px-4 py-3 text-left border rounded hover:bg-gray-50 dark:hover:bg-gray-800 dark:border-gray-700"
          >
            <div className="text-sm font-medium">访问官网</div>
            <div className="text-xs text-gray-500 mt-0.5">{OFFICIAL_SITE}</div>
          </button>
        </div>

        <div className="mt-8 text-center">
          <p className="text-sm font-medium">微信赞助</p>
          <p className="text-xs text-gray-500 mt-1">如果这个工具帮到了你，请我喝杯咖啡</p>
          <img
            src={donateWechat}
            alt="微信收款码"
            className="mt-3 mx-auto w-44 h-44 object-contain border rounded dark:border-gray-700"
          />
        </div>

        <div className="mt-10 pt-4 border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-400">配置与日志目录</p>
          <p className="text-xs text-gray-500 break-all mt-1 font-mono">{configDir}</p>
        </div>
      </div>
    </div>
  )
}

export default AboutView
