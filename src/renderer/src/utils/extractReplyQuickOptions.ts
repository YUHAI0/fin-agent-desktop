import type { Message } from '../contexts/ChatContext'

export interface QuickReplyOption {
  id: string
  /** 按钮展示（可能截断） */
  label: string
  /** 点击后作为用户消息发送 */
  sendText: string
}

/** 点击「功能总览」时发给大模型的固定追问（期望回答能力说明 + 末尾 FIN_AGENT_CHOICES_JSON 示例问句） */
export const FEATURE_OVERVIEW_USER_PROMPT =
  '请系统说明你能帮我做哪些事：至少覆盖行情与K线、财务与估值、技术与选股、模拟持仓与盈亏、价格邮件提醒、策略回测与收益曲线等，并说明依赖条件（如 Tushare Token、大模型与邮件设置）。\n\n' +
  '回复完成后，在全文最后一行严格追加 FIN_AGENT_CHOICES_JSON：JSON 数组含 6～8 个对象；每条 label 与 send 均为同一句简短中文意图（如「MACD回测」「设置价格提醒」），不要预填股票代码或具体参数，由用户后续补充。'

export const FEATURE_OVERVIEW_QUICK_OPTION: QuickReplyOption = {
  id: 'feature-overview',
  label: '功能总览',
  sendText: FEATURE_OVERVIEW_USER_PROMPT
}

const MIN_OPTIONS = 2
const MAX_OPTIONS = 8
const MAX_LABEL = 44
const MAX_SEND = 500

/** 模型未带结构化/启发式不足时，用于保证底部始终有可点选项 */
const DEFAULT_FALLBACK_OPTIONS: QuickReplyOption[] = [
  { id: 'fb-0', label: '展开依据', sendText: '请就上文结论展开说明依据、风险与适用条件。' },
  { id: 'fb-1', label: '表格总结', sendText: '请用表格总结上文要点，并列出我建议的下一步。' },
  { id: 'fb-2', label: '换标的分析', sendText: '换一个近期有代表性的标的，按同样思路再分析一遍。' },
  { id: 'fb-3', label: '持仓与调整', sendText: '我当前持仓有哪些？结合上文需要调整吗？' },
  { id: 'fb-4', label: '数据口径', sendText: '请再确认上文用到的数据日期、口径与来源。' },
  { id: 'fb-5', label: '对比基准', sendText: '把结论放到行业或大盘基准下再对比一下。' },
  { id: 'fb-6', label: '反方观点', sendText: '补充与上文结论相反或中性的观点与触发条件。' },
  { id: 'fb-7', label: '执行清单', sendText: '把建议整理成我本周可执行的具体清单（最多5条）。' }
]

/** 合并模型/启发式结果与默认项；LLM 已给出足够选项时不再混入默认兜底。 */
export function ensureQuickReplyOptions(extracted: QuickReplyOption[]): QuickReplyOption[] {
  if (extracted.length >= MIN_OPTIONS) {
    return extracted.slice(0, MAX_OPTIONS)
  }

  const seen = new Set<string>()
  const out: QuickReplyOption[] = []

  const overviewKey = FEATURE_OVERVIEW_USER_PROMPT.trim()
  const hasOverview = extracted.some((o) => o.sendText.trim() === overviewKey)
  if (!hasOverview) {
    out.push({ ...FEATURE_OVERVIEW_QUICK_OPTION })
    seen.add(overviewKey)
  }

  for (const o of extracted) {
    const s = o.sendText.trim()
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push({ ...o, id: o.id || `q-${out.length}` })
    if (out.length >= MAX_OPTIONS) return out
  }

  for (const d of DEFAULT_FALLBACK_OPTIONS) {
    if (out.length >= MAX_OPTIONS) break
    const s = d.sendText.trim()
    if (seen.has(s)) continue
    seen.add(s)
    out.push({ ...d, id: `fb-${out.length}` })
  }

  return out
}

/** 与 Python system prompt 约定一致，整段须在回复最后一行 */
export const FIN_AGENT_CHOICES_KEY = 'FIN_AGENT_CHOICES_JSON'

/**
 * 从正文中移除机器可读选项行，避免在 Markdown 里展示。
 */
export function stripFinAgentChoicesForDisplay(text: string): string {
  const i = text.lastIndexOf(FIN_AGENT_CHOICES_KEY)
  if (i < 0) return text
  return text.slice(0, i).replace(/\s+$/, '')
}

function normalizeChoiceText(raw: string, maxLen: number): string {
  const t = raw.trim()
  if (t.length <= maxLen) return t
  return `${t.slice(0, maxLen)}…`
}

/** 结构化选项：按钮文案即发送内容，避免 label 短、send 自动补细节 */
function optionFromStructuredRow(row: Record<string, unknown>, index: number): QuickReplyOption | null {
  const sendRaw = row.send ?? row.text
  const send = typeof sendRaw === 'string' ? sendRaw.trim() : ''
  let label = typeof row.label === 'string' ? row.label.trim() : ''
  // 有 label 时以 label 为准发送；无 label 时才用 send
  const userText = label || send
  if (!userText || userText.length > MAX_SEND) return null
  if (!label) label = userText
  const displayLabel = normalizeChoiceText(label, MAX_LABEL)
  return {
    id: `svc-${index}`,
    label: displayLabel,
    sendText: label
  }
}

function parseStructuredFinAgentChoices(fullText: string): QuickReplyOption[] | null {
  const i = fullText.lastIndexOf(FIN_AGENT_CHOICES_KEY)
  if (i < 0) return null
  let raw = fullText.slice(i + FIN_AGENT_CHOICES_KEY.length).trim()
  const firstLine = (raw.split(/\r?\n/, 1)[0] ?? raw).trim()
  raw = firstLine
  if (!raw.startsWith('[')) return null
  let arr: unknown
  try {
    arr = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(arr) || arr.length < MIN_OPTIONS || arr.length > MAX_OPTIONS) return null
  const out: QuickReplyOption[] = []
  for (let j = 0; j < arr.length; j++) {
    const row = arr[j]
    if (!row || typeof row !== 'object') return null
    const opt = optionFromStructuredRow(row as Record<string, unknown>, j)
    if (!opt) return null
    out.push(opt)
  }
  return out
}

function stripInlineMd(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim()
}

function assistantTextContent(msg: Message): string {
  const parts = (msg.blocks || [])
    .filter((b): b is { type: 'text'; content: string } => b.type === 'text')
    .map((b) => b.content)
  if (parts.length > 0) return parts.join('\n\n')
  return (msg.content || '').trim()
}

function parseNumberedOrLetterLine(line: string): { kind: 'num' | 'letter'; content: string } | null {
  let m = line.match(/^\s*(\d{1,2})[\.\．、:：\)）\]\]]\s+(.+)$/)
  if (m) return { kind: 'num', content: stripInlineMd(m[2]) }
  m = line.match(/^\s*(\d{1,2})[、，,]\s*(.+)$/)
  if (m) return { kind: 'num', content: stripInlineMd(m[2]) }
  m = line.match(/^\s*([A-Ha-h])[\.\)、）\]\]]\s*(.+)$/)
  if (m) return { kind: 'letter', content: stripInlineMd(m[2]) }
  return null
}

function parseBulletLine(line: string): string | null {
  const m = line.match(/^\s*[-*]\s+(?!\[[\s xX]\]\s)(.+)$/)
  if (!m) return null
  const c = stripInlineMd(m[1])
  if (/^#{1,6}\s/.test(c)) return null
  return c
}

/** 从文末向上取连续「编号 / 字母 / 列表」行 */
function collectTailOptions(
  lines: string[],
  parseLine: (line: string) => string | null
): string[] {
  const tail: string[] = []
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trimEnd()
    const trimmed = line.trim()
    if (!trimmed) {
      if (tail.length > 0) break
      continue
    }
    const content = parseLine(trimmed)
    if (!content) {
      if (tail.length > 0) break
      continue
    }
    if (content.length < 2 || content.length > MAX_SEND) {
      if (tail.length > 0) break
      continue
    }
    if (/^\d+(\.\d+)?$/.test(content)) continue
    tail.push(content)
  }
  return tail.reverse()
}

function collectNumberedLetterTail(lines: string[]): string[] {
  const tail: { kind: 'num' | 'letter'; content: string }[] = []
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim()
    if (!trimmed) {
      if (tail.length > 0) break
      continue
    }
    const p = parseNumberedOrLetterLine(trimmed)
    if (!p) {
      if (tail.length > 0) break
      continue
    }
    if (p.content.length < 2 || p.content.length > MAX_SEND) {
      if (tail.length > 0) break
      continue
    }
    if (/^\d+(\.\d+)?$/.test(p.content)) {
      if (tail.length > 0) break
      continue
    }
    tail.push(p)
  }
  const ordered = tail.reverse()
  if (ordered.length < MIN_OPTIONS) return []
  if (ordered.length > MAX_OPTIONS) return []
  const k0 = ordered[0].kind
  if (!ordered.every((x) => x.kind === k0)) return []
  return ordered.map((o) => o.content)
}

function toQuickOptions(contents: string[]): QuickReplyOption[] {
  const seen = new Set<string>()
  const out: QuickReplyOption[] = []
  for (let i = 0; i < contents.length; i++) {
    const sendText = contents[i].trim()
    if (!sendText || seen.has(sendText)) continue
    seen.add(sendText)
    out.push({
      id: `qr-${i}-${sendText.slice(0, 12)}`,
      label: sendText.length > MAX_LABEL ? `${sendText.slice(0, MAX_LABEL)}…` : sendText,
      sendText
    })
  }
  return out.length >= MIN_OPTIONS ? out : []
}

/**
 * 从助手全文启发式提取末尾「可点选」条目（编号 / A-D / 无序列表）。
 */
export function extractQuickOptionsFromAssistantText(fullText: string): QuickReplyOption[] {
  const t = fullText.trim()
  if (t.length < 12) return []

  const structured = parseStructuredFinAgentChoices(t)
  if (structured && structured.length >= MIN_OPTIONS) return structured

  if (t.length < 24) return []

  const lines = t.split(/\r?\n/)

  let contents = collectNumberedLetterTail(lines)
  if (contents.length >= MIN_OPTIONS) return toQuickOptions(contents)

  contents = collectTailOptions(lines, parseBulletLine)
  if (contents.length >= MIN_OPTIONS && contents.length <= MAX_OPTIONS) {
    const tailSlice = t.slice(Math.max(0, t.length - 900))
    if (
      /(请选择|选一项|哪一个|哪种|以下|如下|可选|或者|还是|若您|若你|要不要|您希望|你希望)/.test(
        tailSlice
      )
    ) {
      return toQuickOptions(contents)
    }
  }

  return []
}

/**
 * 仅当「最后一条为助手且当前不在生成中」时给出快捷选项，避免流式半截误匹配。
 */
export function getQuickReplyOptions(
  messages: Message[],
  isResponding: boolean,
  isTyping: boolean
): QuickReplyOption[] {
  if (isResponding || isTyping) return []
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'assistant') return []
  const text = assistantTextContent(last)
  return ensureQuickReplyOptions(extractQuickOptionsFromAssistantText(text))
}
