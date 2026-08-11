import type { Message } from '../contexts/ChatContext'
import type { QuickReplyOption } from './extractReplyQuickOptions'
import { ensureQuickReplyOptions } from './extractReplyQuickOptions'

export const FIN_AGENT_CHOICES_KEY = 'FIN_AGENT_CHOICES_JSON'

const WELCOME_CHOICES = [
  { label: '茅台现价', send: '贵州茅台现在股价多少？' },
  { label: 'MACD 回测', send: '用 MACD 策略回测 600519.SH 近一年的表现' },
  { label: '我的持仓', send: '我当前持仓有哪些？盈亏情况怎样？' },
  { label: '沪深300', send: '沪深300指数最近一个月走势和涨跌幅' },
  { label: '低估值蓝筹', send: '帮我筛一些估值偏低的蓝筹股票，简要说明理由' },
  { label: '今日宏观', send: '今天需要关注的宏观与政策要点有哪些？' }
] as const

/** 新对话空状态下的默认快捷语句 */
export function getDefaultQuickReplyOptions(): QuickReplyOption[] {
  return ensureQuickReplyOptions(
    WELCOME_CHOICES.map((c, i) => ({
      id: `welcome-${i}`,
      label: c.label,
      sendText: c.send
    }))
  )
}

/** 旧版本地欢迎语（含 Fin-Agent 介绍），加载历史时归一化为空对话 */
export function isLegacyWelcomeOnlyMessages(messages: { role: string; content?: string }[]): boolean {
  if (messages.length !== 1) return false
  const m = messages[0]
  return m.role === 'assistant' && (m.content || '').includes('Fin-Agent')
}

export function normalizeSessionMessages(messages: Message[]): Message[] {
  if (messages.length === 0) return messages
  if (isLegacyWelcomeOnlyMessages([messages[0]])) {
    return messages.slice(1)
  }
  return messages
}

/** @deprecated 新对话不再注入欢迎消息，保留供旧数据识别 */
export function createWelcomeAgentMessage(): Message {
  const choicesJson = JSON.stringify([...WELCOME_CHOICES])
  const machineLine = `${FIN_AGENT_CHOICES_KEY} ${choicesJson}`
  return {
    role: 'assistant',
    content: machineLine,
    blocks: [{ type: 'text', content: machineLine }]
  }
}
