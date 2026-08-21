import React, { useState, useEffect, useRef, useMemo } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Settings, ChevronDown, ChevronRight, Check, Loader2, Terminal, Bell, Briefcase, Newspaper, ArrowUp, Square, Brain, Sun, Moon, Search, PanelLeft, CircleUser } from 'lucide-react'
import { useChat, ChatBlock, Message } from '../contexts/ChatContext'
import { useTheme } from '../contexts/ThemeContext'
import { KlinePanel } from './KlinePanel'
import { BacktestEquityPanel } from './BacktestEquityPanel'
import { ReminderTasksModal } from './ReminderTasksModal'
import StockSearchModal from './StockSearchModal'
import DashboardWelcome from './DashboardWelcome'
import SessionTabs, {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH
} from './SessionTabs'
import HistoryDrawer from './HistoryDrawer'
import { parseToolResultToKline } from '../utils/parseToolOhlc'
import { parseRunBacktestEquity } from '../utils/parseToolBacktest'
import { getQuickReplyOptions, stripFinAgentChoicesForDisplay } from '../utils/extractReplyQuickOptions'
import { normalizeSessionMessages } from '../utils/welcomeAgentMessage'
import { parseMaLadder } from '../utils/parseMaLadder'
import { MaLadderPanel } from './MaLadderPanel'
import { toolDisplayName } from '../utils/toolDisplayName'
import { MarkdownExternalLink } from './ExternalLink'
import NewsChatCard from './news/NewsChatCard'
import { NEWS_CARD_INTENT_PROMPTS, type NewsCardPayload } from '../utils/chatPrefill'

// ToolExecutionBlock type helper
type ToolExecutionBlock = Extract<ChatBlock, { type: 'tool_execution' }>

/** 内部工具：仍执行，但不在对话中展示，避免打断用户阅读 */
const HIDDEN_TOOL_NAMES = new Set(['get_current_time'])

function sameCallIndex(
  a: number | undefined,
  b: number | undefined
): boolean {
  if (a === undefined || b === undefined) return false
  return Number(a) === Number(b)
}

// Component for rendering Tool Execution
const ToolExecutionView: React.FC<{ block: ToolExecutionBlock }> = ({ block }) => {
  const [isOpen, setIsOpen] = useState(false)

  const klineData = useMemo(
    () => parseToolResultToKline(block.name, block.args, block.result),
    [block.name, block.args, block.result]
  )
  const backtestEquity = useMemo(
    () => parseRunBacktestEquity(block.name, block.args, block.result),
    [block.name, block.args, block.result]
  )
  const showKline = block.status === 'success' && klineData != null
  const showBacktest = block.status === 'success' && backtestEquity != null
  const showChart = showKline || showBacktest

  return (
    <div
      className={`mb-2 overflow-hidden rounded-xl border border-[var(--fa-border)] bg-[var(--fa-surface)] ${
        showChart ? 'max-w-[min(100%,min(96vw,1400px))]' : 'max-w-[min(100%,900px)]'
      }`}
    >
      <div
        className="flex cursor-pointer items-center gap-2 px-3 py-2.5 transition-colors duration-200 hover:bg-[var(--fa-surface-hover)]"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="text-[var(--fa-muted)]">
          {block.status === 'running' ? (
            <Loader2 className="animate-spin" size={14} />
          ) : block.status === 'success' ? (
            <Check className="text-emerald-600" size={14} />
          ) : (
            <Terminal size={14} className="text-[var(--fa-danger)]" />
          )}
        </div>
        <div className="flex flex-1 items-center gap-2 truncate font-mono text-xs text-[var(--fa-text)]">
          <span className="font-semibold text-[var(--fa-accent)]">{toolDisplayName(block.name)}</span>
          <span className="truncate text-[var(--fa-muted)]">{block.args.substring(0, 50)}</span>
        </div>
        <div className="text-[var(--fa-faint)]">
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </div>

      {showKline && klineData && <KlinePanel title={klineData.label} candles={klineData.candles} />}

      {showBacktest && backtestEquity && (
        <BacktestEquityPanel title={backtestEquity.label} points={backtestEquity.points} />
      )}

      {isOpen && (
        <div className="space-y-3 border-t border-[var(--fa-border-subtle)] bg-[var(--fa-bg)] p-3 font-mono text-xs">
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--fa-faint)]">
              输入
            </div>
            <div className="whitespace-pre-wrap break-all rounded-lg border border-[var(--fa-border)] bg-[var(--fa-code-bg)] p-2.5 text-[var(--fa-text)]">
              {block.args}
            </div>
          </div>

          {block.result && (
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--fa-faint)]">
                输出
              </div>
              <div className="max-h-60 overflow-y-auto whitespace-pre-wrap break-all rounded-lg border border-[var(--fa-border)] bg-[var(--fa-code-bg)] p-2.5 text-[var(--fa-muted)]">
                {block.result}
              </div>
            </div>
          )}

          {block.status === 'running' && (
            <div className="italic text-[var(--fa-faint)]">运行中...</div>
          )}
        </div>
      )}
    </div>
  )
}

// Message interface is now imported from ChatContext

function flattenPreChildren(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flattenPreChildren).join('')
  if (React.isValidElement(node)) return flattenPreChildren(node.props.children)
  return ''
}

function tableCellClass(children: React.ReactNode): string {
  const text = flattenPreChildren(children).trim()
  if (/^\+/.test(text) && /%/.test(text)) return 'fa-md-table-td fa-md-table-up'
  if (/^-/.test(text) && /%/.test(text)) return 'fa-md-table-td fa-md-table-down'
  return 'fa-md-table-td'
}

// 表格组件配置：跟随 CSS 主题变量（昼夜模式一致）
const markdownComponents = {
  /** not-prose：避免 typography 把 table 缩成比正文更小；字号与外层 prose-sm 段落对齐 */
  table: ({ children, ...props }: any) => (
    <div className="not-prose fa-md-table-wrap">
      <table {...props} className="fa-md-table">
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }: any) => (
    <thead {...props}>
      {children}
    </thead>
  ),
  tbody: ({ children, ...props }: any) => <tbody {...props}>{children}</tbody>,
  th: ({ children, ...props }: any) => (
    <th {...props} className="fa-md-table-th">
      {children}
    </th>
  ),
  td: ({ children, ...props }: any) => (
    <td {...props} className={tableCellClass(children)}>
      {children}
    </td>
  ),
  tr: ({ children, ...props }: any) => (
    <tr {...props} className="fa-md-table-row">
      {children}
    </tr>
  ),
  pre: ({ children, ...props }: any) => {
    const text = flattenPreChildren(children)
    const ladder = parseMaLadder(text)
    if (ladder) {
      return <MaLadderPanel data={ladder} />
    }
    return (
      <pre {...props} className="not-prose">
        {children}
      </pre>
    )
  },
  a: MarkdownExternalLink
}

const SIDEBAR_STORAGE_KEY = 'fin-agent-sidebar'

/** 当前会话是否已开始输出（思考/正文/工具），用于决定是否显示等待三点 */
function assistantHasStarted(msgs: Message[]): boolean {
  const last = msgs[msgs.length - 1]
  if (!last || last.role !== 'assistant') return false
  if (last.content?.trim()) return true
  return (last.blocks || []).some((block) => {
    if (block.type === 'tool_execution') return true
    if (block.type === 'text' || block.type === 'thinking') return Boolean(block.content)
    return false
  })
}

function readSidebarPrefs(): { width: number; collapsed: boolean } {
  try {
    const raw = localStorage.getItem(SIDEBAR_STORAGE_KEY)
    if (!raw) return { width: SIDEBAR_DEFAULT_WIDTH, collapsed: false }
    const parsed = JSON.parse(raw) as { width?: unknown; collapsed?: unknown }
    const width =
      typeof parsed.width === 'number'
        ? Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, parsed.width))
        : SIDEBAR_DEFAULT_WIDTH
    return { width, collapsed: Boolean(parsed.collapsed) }
  } catch {
    return { width: SIDEBAR_DEFAULT_WIDTH, collapsed: false }
  }
}

const ChatView: React.FC = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const {
    messages,
    setMessages,
    updateSessionMessages,
    activeSessionId,
    ensureActiveSession,
    setSessionStreaming,
    isActiveSessionStreaming,
    newSession,
    consumePendingNewsCardSend
  } = useChat() // 使用 Context 中的消息历史
  const { theme, setTheme } = useTheme()
  const [input, setInput] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [respondingSessions, setRespondingSessions] = useState<Set<string>>(() => new Set())
  const [version, setVersion] = useState('...')
  const [autoScroll, setAutoScroll] = useState(true)
  const [reminderModalOpen, setReminderModalOpen] = useState(false)
  const [stockSearchOpen, setStockSearchOpen] = useState(false)
  const [newsUnreadCount, setNewsUnreadCount] = useState(0)
  const [sidebarWidth, setSidebarWidth] = useState(() => readSidebarPrefs().width)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readSidebarPrefs().collapsed)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const activeSessionIdRef = useRef(activeSessionId)
  activeSessionIdRef.current = activeSessionId
  const ensureActiveSessionRef = useRef(ensureActiveSession)
  ensureActiveSessionRef.current = ensureActiveSession
  const setSessionStreamingRef = useRef(setSessionStreaming)
  setSessionStreamingRef.current = setSessionStreaming
  const isActiveSessionStreamingRef = useRef(isActiveSessionStreaming)
  isActiveSessionStreamingRef.current = isActiveSessionStreaming
  const newSessionRef = useRef(newSession)
  newSessionRef.current = newSession
  const sendUserTextRef = useRef<(text: string) => Promise<void>>(async () => {})
  const sendNewsCardRef = useRef<(payload: NewsCardPayload, sessionId: string) => Promise<void>>(
    async () => {}
  )
  const lastPrefillConsumedRef = useRef<{ text: string; at: number } | null>(null)

  useEffect(() => {
    localStorage.setItem(
      SIDEBAR_STORAGE_KEY,
      JSON.stringify({ width: sidebarWidth, collapsed: sidebarCollapsed })
    )
  }, [sidebarWidth, sidebarCollapsed])

  const toggleSidebarCollapsed = () => setSidebarCollapsed((v) => !v)
  const collapseSidebar = () => setSidebarCollapsed(true)
  const expandSidebar = () => setSidebarCollapsed(false)

  const applyToSession = (
    sessionId: string | undefined,
    updater: (prev: Message[]) => Message[]
  ) => {
    if (sessionId) {
      updateSessionMessages(sessionId, updater)
    } else if (activeSessionIdRef.current) {
      updateSessionMessages(activeSessionIdRef.current, updater)
    } else {
      // 草稿态：写入草稿消息桶
      setMessages(updater)
    }
  }
  const applyToSessionRef = useRef(applyToSession)
  applyToSessionRef.current = applyToSession

  const respondingKey = (sessionId?: string | null) => sessionId || activeSessionIdRef.current || '__default__'
  const isResponding = respondingSessions.has(respondingKey(activeSessionId))

  const markResponding = (sessionId: string | undefined, responding: boolean) => {
    const key = respondingKey(sessionId)
    setRespondingSessions((prev) => {
      const next = new Set(prev)
      if (responding) next.add(key)
      else next.delete(key)
      return next
    })
    const sid = sessionId || activeSessionIdRef.current
    if (sid) setSessionStreamingRef.current(sid, responding)
  }

  const scrollToBottom = () => {
    if (autoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
    }
  }

  const handleScroll = () => {
    if (!scrollContainerRef.current) return
    
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current
    // Check if user is at the very bottom (allow 1px tolerance for rounding)
    const isAtBottom = Math.abs(scrollHeight - scrollTop - clientHeight) <= 1
    
    if (isAtBottom && !autoScroll) {
        setAutoScroll(true)
    } else if (!isAtBottom && autoScroll) {
        setAutoScroll(false)
    }
  }

  /** 根据最后一条助手消息末尾的编号/列表，启发式生成可点击选项 */
  const displayMessages = useMemo(() => normalizeSessionMessages(messages), [messages])

  const showWelcomeHero = displayMessages.length === 0
  // 等待三点只跟当前标签绑定：别的会话在生成时，切过来不应看到对方的等待标志
  const isTyping = isResponding && !assistantHasStarted(displayMessages)

  const quickReplyOptions = useMemo(() => {
    if (isResponding || isTyping) return []
    if (showWelcomeHero) return []
    return getQuickReplyOptions(messages, isResponding, isTyping)
  }, [messages, isResponding, isTyping, showWelcomeHero])

  useEffect(() => {
    scrollToBottom()
  }, [messages, isTyping])

  // Keep focus on input at all times
  useEffect(() => {
    inputRef.current?.focus()
  }, [messages, isTyping])

  // Load version on mount
  useEffect(() => {
    window.api.getVersion().then(v => setVersion(v))
  }, [])

  // 新闻未读徽标：打开时加载一次，随后轻量轮询 + 监听通知事件，卸载时清理避免泄漏
  useEffect(() => {
    let cancelled = false
    const loadNewsUnread = async () => {
      try {
        const res = await window.api.getNewsUnreadCount()
        if (!cancelled) setNewsUnreadCount(res.count || 0)
      } catch {
        // 静默失败，保留上一次数值
      }
    }
    void loadNewsUnread()
    const intervalId = window.setInterval(loadNewsUnread, 45000)
    const removeNewsListener = window.api.onNewsNotificationOpen(() => {
      void loadNewsUnread()
    })
    const removePriceAlertListener = window.api.onPriceAlertNotificationOpen(() => {
      setReminderModalOpen(true)
    })
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      removeNewsListener()
      removePriceAlertListener()
    }
  }, [])

  // 从通知跳转 /chat?reminders=1 时，确保提醒列表打开（避免事件早于挂载丢失）
  useEffect(() => {
    if (searchParams.get('reminders') !== '1') return
    setReminderModalOpen(true)
    navigate('/chat', { replace: true })
  }, [searchParams, navigate])

  useEffect(() => {
    const applyToSession = (
      sessionId: string | undefined,
      updater: (prev: Message[]) => Message[]
    ) => applyToSessionRef.current(sessionId, updater)

    const removeListener = window.api.onNewMessage((payload) => {
      const text = typeof payload === 'string' ? payload : payload?.text
      const sessionId = typeof payload === 'string' ? undefined : payload?.sessionId
      const newsCard = typeof payload === 'string' ? undefined : payload?.newsCard
      console.log('[ChatView] Received new-message:', text, sessionId)
      if (!text && !newsCard) return

      const routeMessage = (sid?: string) => {
        applyToSession(sid, (prev) => [
          ...prev,
          newsCard
            ? {
                role: 'user',
                content: newsCard.news.title,
                blocks: [{ type: 'news_card', intent: newsCard.intent, news: newsCard.news }]
              }
            : { role: 'user', content: text || '', blocks: [] }
        ])
        markResponding(sid, true)
      }

      // 快捷输入等路径可能不带 sessionId；草稿态先建会话再入消息，避免空标签缺失
      if (!sessionId && !activeSessionIdRef.current) {
        void ensureActiveSessionRef
          .current(text)
          .then((sid) => routeMessage(sid))
          .catch((err) => {
            console.error('[ChatView] ensureActiveSession on new-message failed:', err)
            routeMessage(undefined)
          })
        return
      }

      routeMessage(sessionId)
    })

    const removeBotStreamListener = window.api.onBotStream((data: any) => {
        if (!data) return;
        const eventSessionId: string | undefined = data.sessionId

        // tool_call_chunk / content 在流式下每秒可达数十上百次，逐条打日志会淹没控制台且无助于排错
        if (data.type !== 'tool_call_chunk' && data.type !== 'content') {
            console.log('[ChatView] Received bot-stream event:', data.type, eventSessionId)
        }

        if (
          data.type === 'content' ||
          data.type === 'answer' ||
          data.type === 'thinking' ||
          data.type === 'tool_call' ||
          data.type === 'tool_call_chunk'
        ) {
          markResponding(eventSessionId, true)
        }

        if (data.type === 'error' || data.type === 'finish') {
          markResponding(eventSessionId, false)
        }

        const patchFromStream = (prev: Message[]) => {
            const newMessages = [...prev]
            const lastIdx0 = newMessages.length - 1
            const lastMsg = lastIdx0 >= 0 ? newMessages[lastIdx0] : undefined

            // If last message is not assistant, create one (first event)
            if (!lastMsg || lastMsg.role !== 'assistant') {
                newMessages.push({ role: 'assistant', content: '', logs: '', blocks: [] })
            }

            const ai = newMessages.length - 1
            const srcAssistant = newMessages[ai]
            // 与 prev 脱钩：assistant 及每条 block 都换新引用，避免就地改 prev 导致多次 tool_result 不刷新
            newMessages[ai] = {
                ...srcAssistant,
                blocks: (srcAssistant.blocks || []).map((b) => ({ ...b })),
            }
            const assistantMsg = newMessages[ai]
            if (!assistantMsg.blocks) assistantMsg.blocks = []

            const getLastBlock = (type: 'text' | 'thinking') => {
                const lastBlock = assistantMsg.blocks[assistantMsg.blocks.length - 1]
                if (lastBlock && lastBlock.type === type) return lastBlock
                return null
            }
            
            // Helper specifically for tool execution
            const getLastToolExecution = () => {
                const lastBlock = assistantMsg.blocks[assistantMsg.blocks.length - 1]
                if (lastBlock && lastBlock.type === 'tool_execution') {
                    return lastBlock
                }
                return null
            }

            if (data.type === 'content') {
                assistantMsg.content += data.content || ''
                const lastBlock = getLastBlock('text')
                if (lastBlock && lastBlock.type === 'text') {
                    lastBlock.content += data.content || ''
                } else {
                    assistantMsg.blocks.push({ type: 'text', content: data.content || '' })
                }
            } else if (data.type === 'thinking') {
                const lastBlock = getLastBlock('thinking')
                if (lastBlock && lastBlock.type === 'thinking') {
                    lastBlock.content += data.content || ''
                } else {
                    assistantMsg.blocks.push({ type: 'thinking', content: data.content || '' })
                }
            } else if (data.type === 'answer') {
                // Some providers only return a final answer event.
                const hasText =
                    Boolean(assistantMsg.content?.trim()) ||
                    assistantMsg.blocks.some(
                        (block) => block.type === 'text' && Boolean(block.content)
                    )
                if (!hasText && data.content) {
                    assistantMsg.content = data.content
                    assistantMsg.blocks.push({ type: 'text', content: data.content })
                }
            } else if (data.type === 'log') {
                assistantMsg.logs = (assistantMsg.logs || '') + `[Log] ${data.content}\n`
            } else if (data.type === 'tool_call') {
                const argsStr = typeof data.args === 'string' ? data.args : JSON.stringify(data.args)
                
                // 优先匹配「同名且尚无参数」的运行中块（并行同工具名时按顺序）
                let existingTool: ToolExecutionBlock | null = null
                for (let i = 0; i < assistantMsg.blocks.length; i++) {
                    const block = assistantMsg.blocks[i]
                    if (
                        block.type === 'tool_execution' &&
                        block.status === 'running' &&
                        block.name === data.tool_name &&
                        (!block.args || block.args === '')
                    ) {
                        existingTool = block
                        break
                    }
                }
                if (!existingTool) {
                    for (let i = assistantMsg.blocks.length - 1; i >= 0; i--) {
                        const block = assistantMsg.blocks[i]
                        if (
                            block.type === 'tool_execution' &&
                            block.status === 'running' &&
                            block.name === data.tool_name
                        ) {
                            existingTool = block
                            break
                        }
                    }
                }
                if (existingTool) {
                    existingTool.args = argsStr
                } else {
                    assistantMsg.blocks.push({ 
                        type: 'tool_execution', 
                        name: data.tool_name, 
                        args: argsStr,
                        status: 'running'
                    })
                }
                
                // Also keep in logs for reference
                assistantMsg.logs = (assistantMsg.logs || '') + `[Tool Call] ${data.tool_name}(${argsStr})\n`
            } else if (data.type === 'tool_call_chunk') {
                const callIndexNum =
                    typeof data.index === 'number'
                        ? data.index
                        : typeof data.index === 'string' && data.index !== '' && !Number.isNaN(Number(data.index))
                          ? Number(data.index)
                          : undefined
                const hasIndex = callIndexNum !== undefined
                let targetTool: ToolExecutionBlock | null = null

                if (hasIndex) {
                    for (let i = assistantMsg.blocks.length - 1; i >= 0; i--) {
                        const block = assistantMsg.blocks[i]
                        if (
                            block.type === 'tool_execution' &&
                            block.status === 'running' &&
                            sameCallIndex(block.callIndex, callIndexNum)
                        ) {
                            targetTool = block
                            break
                        }
                    }
                    if (
                        !targetTool &&
                        (data.name || data.arguments || data.id)
                    ) {
                        const newBlock: ToolExecutionBlock = {
                            type: 'tool_execution',
                            name: data.name || '',
                            args: '',
                            status: 'running',
                            callIndex: callIndexNum,
                            callId: data.id || '',
                            lastChunkLength: 0
                        }
                        assistantMsg.blocks.push(newBlock)
                        targetTool = newBlock
                    }
                    if (targetTool) {
                        if (data.name && !targetTool.name) targetTool.name = data.name
                        if (data.id) targetTool.callId = (targetTool.callId || '') + data.id
                    }
                } else {
                    let lastTool = getLastToolExecution()
                    if (data.name) {
                        if (
                            !lastTool ||
                            lastTool.status !== 'running' ||
                            (lastTool.name && lastTool.name !== data.name)
                        ) {
                            const newBlock: ToolExecutionBlock = {
                                type: 'tool_execution',
                                name: data.name,
                                args: '',
                                status: 'running',
                                lastChunkLength: 0
                            }
                            assistantMsg.blocks.push(newBlock)
                            lastTool = newBlock
                        } else if (!lastTool.name) {
                            lastTool.name = data.name
                            if (!lastTool.lastChunkLength) {
                                lastTool.lastChunkLength = 0
                            }
                        }
                    }
                    targetTool = getLastToolExecution()
                }

                if (data.arguments && targetTool && targetTool.status === 'running') {
                    const newArgs = data.arguments
                    const currentArgs = targetTool.args
                    if (newArgs && currentArgs.endsWith(newArgs)) {
                        return newMessages
                    }
                    targetTool.args += newArgs
                    targetTool.lastChunkLength = targetTool.args.length
                }
                
            } else if (data.type === 'tool_result') {
                 // Truncate long results for display
                const rawResult = data?.result == null ? '' : String(data.result)
                const tcId: string | undefined =
                    typeof data.tool_call_id === 'string' && data.tool_call_id
                        ? data.tool_call_id
                        : undefined
                const tcIdx: number | undefined =
                    typeof data.tool_index === 'number'
                        ? data.tool_index
                        : typeof data.tool_index === 'string' &&
                            data.tool_index !== '' &&
                            !Number.isNaN(Number(data.tool_index))
                          ? Number(data.tool_index)
                          : undefined

                let matchedIdx: number = -1

                // 1) 优先 tool_index：并行同名工具时最可靠（避免 callId 与流式拼接不一致时误匹配）
                if (tcIdx !== undefined) {
                    for (let i = 0; i < assistantMsg.blocks.length; i++) {
                        const block = assistantMsg.blocks[i]
                        if (
                            block.type === 'tool_execution' &&
                            block.status === 'running' &&
                            sameCallIndex(block.callIndex, tcIdx)
                        ) {
                            matchedIdx = i
                            break
                        }
                    }
                }
                // 2) 仅当块上已有非空 callId 时才按 id 匹配
                if (matchedIdx < 0 && tcId) {
                    for (let i = assistantMsg.blocks.length - 1; i >= 0; i--) {
                        const block = assistantMsg.blocks[i]
                        if (
                            block.type === 'tool_execution' &&
                            block.status === 'running' &&
                            block.callId &&
                            block.callId === tcId
                        ) {
                            matchedIdx = i
                            break
                        }
                    }
                }
                // 3) 同名 FIFO：第一个仍为 running 的块
                if (matchedIdx < 0) {
                    for (let i = 0; i < assistantMsg.blocks.length; i++) {
                        const block = assistantMsg.blocks[i]
                        if (
                            block.type === 'tool_execution' &&
                            block.status === 'running' &&
                            block.name === data.tool_name
                        ) {
                            matchedIdx = i
                            break
                        }
                    }
                }
                // 4) 兜底：从后往前第一个 running
                if (matchedIdx < 0) {
                    for (let i = assistantMsg.blocks.length - 1; i >= 0; i--) {
                        const block = assistantMsg.blocks[i]
                        if (block.type === 'tool_execution' && block.status === 'running') {
                            matchedIdx = i
                            break
                        }
                    }
                }
                if (matchedIdx >= 0) {
                    assistantMsg.blocks = assistantMsg.blocks.map((b, i) =>
                        i === matchedIdx && b.type === 'tool_execution'
                            ? { ...b, status: 'success' as const, result: rawResult }
                            : b
                    )
                } else {
                    assistantMsg.blocks = [
                        ...assistantMsg.blocks,
                        {
                            type: 'tool_execution',
                            name: data.tool_name,
                            args: '(Missing input)',
                            result: rawResult,
                            status: 'success' as const,
                        },
                    ]
                }

                const resultStr = rawResult.length > 500 ? rawResult.substring(0, 500) + '...' : rawResult
                assistantMsg.logs = (assistantMsg.logs || '') + `[Tool Result] ${resultStr}\n`
            } else if (data.type === 'error') {
                assistantMsg.content += `\n**Error:** ${data.content}`
                assistantMsg.blocks.push({ type: 'text', content: `\n**Error:** ${data.content}` })
            } else if (data.type === 'finish') {
                // 若上游只合并成一次 tool 调用，可能仍有 running 卡片：收尾避免永久转圈
                assistantMsg.blocks = assistantMsg.blocks.map((b) =>
                    b.type === 'tool_execution' && b.status === 'running'
                        ? {
                              ...b,
                              status: 'success' as const,
                              result:
                                  b.result ||
                                  '（本轮未收到单独的工具结果，流已结束。若任务已执行可展开查看上方输出。）',
                          }
                        : b
                )
            }
            
            return newMessages
        }

        // tool_result / finish 需尽快反映到 UI，避免批处理或收尾时卡片仍转圈
        if (data.type === 'tool_result' || data.type === 'finish') {
            flushSync(() => applyToSession(eventSessionId, patchFromStream))
        } else {
            applyToSession(eventSessionId, patchFromStream)
        }
    })

    // Keep legacy listener for backward compatibility if needed, but mainly use stream now
    const removeBotListener = window.api.onBotResponse((data: any) => {
      if (data && data.answer) {
         // ... legacy logic
         setMessages(prev => {
             // ...
             return prev // disabled for now to avoid confusion if legacy event fires
         })
         // setIsTyping(false)
      }
    })

    const removeFocusListener = window.api.onFocusInput(() => {
      console.log('[ChatView] Received focus-input event')
      setTimeout(() => {
        inputRef.current?.focus()
      }, 50)
    })
    
    return () => {
      removeListener()
      removeBotListener()
      removeBotStreamListener()
      removeFocusListener()
    }
  }, [setMessages, updateSessionMessages])

  const sendUserText = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return

    try {
      const status = await window.api.checkConfig()
      if (!status.configured) {
        navigate('/config')
        return
      }
    } catch (err) {
      console.error('[ChatView] Config check failed:', err)
      navigate('/config')
      return
    }

    // 草稿态：用户真正输入后再创建会话标签，避免空对话堆叠
    let sessionId = activeSessionId ?? undefined
    try {
      sessionId = await ensureActiveSession(trimmed)
    } catch (err) {
      console.error('[ChatView] ensureActiveSession failed:', err)
      return
    }

    window.api.submitInput(trimmed, sessionId)
    try {
      sessionStorage.removeItem('fa-prefill')
    } catch {
      // ignore
    }
    setInput('')
    markResponding(sessionId, true)
    setTimeout(() => {
      inputRef.current?.focus()
      setAutoScroll(true)
      scrollToBottom()
    }, 0)
  }
  sendUserTextRef.current = sendUserText

  const sendNewsCard = async (payload: NewsCardPayload, sessionId: string) => {
    const prompt = NEWS_CARD_INTENT_PROMPTS[payload.intent]
    window.api.submitInput(prompt, sessionId, payload)
    markResponding(sessionId, true)
  }
  sendNewsCardRef.current = sendNewsCard

  useEffect(() => {
    const run = () => {
      const pending = consumePendingNewsCardSend()
      if (!pending) return
      void sendNewsCardRef.current(pending.payload, pending.sessionId)
    }
    run()
    window.addEventListener('fa-news-card-send', run)
    return () => window.removeEventListener('fa-news-card-send', run)
  }, [consumePendingNewsCardSend])

  const consumePrefill = (raw: string) => {
    const text = raw.trim()
    if (!text) return
    const now = Date.now()
    const last = lastPrefillConsumedRef.current
    if (last && last.text === text && now - last.at < 800) return
    lastPrefillConsumedRef.current = { text, at: now }
    void (async () => {
      if (isActiveSessionStreamingRef.current()) {
        await newSessionRef.current()
      }
      setInput(text)
      await sendUserTextRef.current(text)
    })()
  }

  // 预填：自定义事件 + ?prefill= query + sessionStorage 交接
  useEffect(() => {
    const onPrefillSend = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string }>).detail
      if (typeof detail?.text === 'string') consumePrefill(detail.text)
    }
    window.addEventListener('fa-prefill-send', onPrefillSend)
    return () => window.removeEventListener('fa-prefill-send', onPrefillSend)
  }, [])

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('fa-prefill')
      if (stored) consumePrefill(stored)
    } catch {
      // ignore
    }
    // 仅挂载时读取 requestPrefill 的 sessionStorage 交接
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const fromQuery = searchParams.get('prefill')
    if (fromQuery == null || fromQuery === '') return
    consumePrefill(fromQuery)
    navigate('/chat', { replace: true })
  }, [searchParams, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    console.log('[ChatView] handleSubmit called, input:', input)

    if (isResponding) {
      console.log('[ChatView] Stopping generation...')
      window.api.stopGeneration(activeSessionId ?? undefined)
      markResponding(activeSessionId ?? undefined, false)
      return
    }

    if (!input.trim()) {
      console.log('[ChatView] Input is empty, returning')
      return
    }

    console.log('[ChatView] Sending input to main process:', input)
    await sendUserText(input)
  }
  
  // 处理输入框的键盘事件
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 如果AI正在响应，禁止回车提交
    if (e.key === 'Enter' && isResponding) {
      e.preventDefault()
      return
    }
  }


  return (
    <div
      className="fa-app-shell"
      style={{ '--fa-sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
    >
      <SessionTabs
        onOpenDrawer={() => setDrawerOpen(true)}
        width={sidebarWidth}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebarCollapsed}
        onWidthChange={setSidebarWidth}
        onCollapse={collapseSidebar}
      />

      <div className="fa-shell-main">
        <header className="fa-shell-toolbar fa-titlebar-row fa-titlebar-row--reserve-end">
          <div className="mr-auto flex items-center gap-0.5">
            {sidebarCollapsed && (
              <button
                type="button"
                onClick={expandSidebar}
                className="fa-icon-btn focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fa-accent)]"
                title="展开侧栏"
                aria-label="展开侧栏"
              >
                <PanelLeft size={18} strokeWidth={1.75} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            <div className="fa-theme-toggle" role="group" aria-label="主题切换">
              <button
                type="button"
                onClick={() => setTheme('light')}
                data-active={theme === 'light'}
                className="fa-theme-toggle-btn focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fa-accent)]"
                title="白天模式"
                aria-label="白天模式"
                aria-pressed={theme === 'light'}
              >
                <Sun size={15} strokeWidth={theme === 'light' ? 2.25 : 2} />
              </button>
              <button
                type="button"
                onClick={() => setTheme('dark')}
                data-active={theme === 'dark'}
                className="fa-theme-toggle-btn focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fa-accent)]"
                title="夜晚模式"
                aria-label="夜晚模式"
                aria-pressed={theme === 'dark'}
              >
                <Moon size={15} strokeWidth={theme === 'dark' ? 2.25 : 2} />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setStockSearchOpen(true)}
              className="fa-icon-btn focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fa-accent)]"
              title="搜索股票"
              aria-label="搜索股票"
            >
              <Search size={18} />
            </button>
            <button
              type="button"
              onClick={() => setReminderModalOpen(true)}
              className="fa-icon-btn focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fa-accent)]"
              title="提醒任务"
              aria-label="提醒任务"
            >
              <Bell size={18} />
            </button>
            <button
              type="button"
              onClick={() => navigate('/news')}
              className="fa-icon-btn relative focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fa-accent)]"
              title="新闻中心"
              aria-label="新闻中心"
            >
              <Newspaper size={18} />
              {newsUnreadCount > 0 && (
                <span className="fa-news-badge absolute right-0.5 top-0.5" aria-hidden>
                  {newsUnreadCount > 99 ? '99+' : newsUnreadCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => navigate('/portfolio')}
              className="fa-icon-btn focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fa-accent)]"
              title="投资组合"
              aria-label="投资组合"
            >
              <Briefcase size={18} />
            </button>
            <button
              type="button"
              onClick={() => navigate('/profile')}
              className="fa-icon-btn focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fa-accent)]"
              title="投资画像"
              aria-label="投资画像"
            >
              <CircleUser size={18} />
            </button>
            <button
              type="button"
              onClick={() => navigate('/config')}
              className="fa-icon-btn focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fa-accent)]"
              title="设置"
              aria-label="设置"
            >
              <Settings size={18} />
            </button>
            <button
              type="button"
              onClick={() => navigate('/about')}
              className="fa-icon-btn px-2.5 text-xs font-medium tabular-nums"
              title="关于 / 支持"
            >
              v{version}
            </button>
          </div>
        </header>

        <div className="fa-main-panel">
        <ReminderTasksModal open={reminderModalOpen} onClose={() => setReminderModalOpen(false)} />
        <StockSearchModal open={stockSearchOpen} onClose={() => setStockSearchOpen(false)} />

        {/* 空状态 hero 或消息流 */}
        {showWelcomeHero ? (
          <DashboardWelcome onOpenReminders={() => setReminderModalOpen(true)} />
        ) : (
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto px-4 py-8 md:px-8 no-drag"
          >
            <div className="mx-auto w-full max-w-3xl space-y-8">
              {displayMessages.map((msg, idx) => {
                const newsCardBlock =
                  msg.role === 'user'
                    ? (msg.blocks || []).find((b) => b.type === 'news_card')
                    : undefined
                const hasNewsCard = newsCardBlock?.type === 'news_card'
                return (
              <div
                key={idx}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start w-full'}`}
              >
                <div
                  className={
                    msg.role === 'user'
                      ? hasNewsCard
                        ? 'max-w-[min(90%,28rem)] p-0 bg-transparent'
                        : 'fa-user-bubble max-w-[min(90%,32rem)] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed text-[var(--fa-text)]'
                      : 'w-full min-w-0 max-w-full py-0.5 text-[15px] leading-relaxed text-[var(--fa-text)]'
                  }
                >
                  {msg.role === 'user' ? (
                    newsCardBlock?.type === 'news_card' ? (
                      <NewsChatCard
                        payload={{ intent: newsCardBlock.intent, news: newsCardBlock.news }}
                      />
                    ) : (
                      msg.content
                    )
                  ) : (
                    <div className="w-full space-y-4">
                      {(msg.blocks || []).map((block, bIdx) => {
                        if (block.type === 'thinking') {
                          return (
                            <div
                              key={bIdx}
                              className="rounded-xl border border-[var(--fa-border-subtle)] bg-[var(--fa-surface)] p-3 text-xs text-[var(--fa-muted)]"
                            >
                              <div className="mb-1.5 flex items-center gap-1.5 font-medium opacity-80">
                                <Brain size={14} aria-hidden />
                                <span>思考过程</span>
                              </div>
                              <div className="whitespace-pre-wrap break-words font-mono leading-relaxed opacity-90">
                                {block.content}
                              </div>
                            </div>
                          )
                        }
                        if (block.type === 'tool_execution') {
                          if (HIDDEN_TOOL_NAMES.has(block.name)) return null
                          return <ToolExecutionView key={bIdx} block={block} />
                        }
                        if (block.type === 'text') {
                          const md = stripFinAgentChoicesForDisplay(block.content)
                          const lastTextBlockIndex =
                            msg.blocks?.reduce(
                              (lastIndex, candidate, candidateIndex) =>
                                candidate.type === 'text' ? candidateIndex : lastIndex,
                              -1
                            ) ?? -1
                          const lastBlockIndex = (msg.blocks?.length ?? 0) - 1
                          const isLiveTail =
                            isResponding &&
                            idx === displayMessages.length - 1 &&
                            bIdx === lastTextBlockIndex &&
                            bIdx === lastBlockIndex
                          return (
                            <div
                              key={bIdx}
                              className={`prose prose-fa prose-sm max-w-none${
                                isLiveTail ? ' fa-stream-live' : ''
                              }`}
                            >
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={markdownComponents}
                              >
                                {md}
                              </ReactMarkdown>
                            </div>
                          )
                        }
                        return null
                      })}

                      {(!msg.blocks || msg.blocks.length === 0) && msg.content && (
                        <div className="prose prose-fa prose-sm max-w-none">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={markdownComponents}
                          >
                            {stripFinAgentChoicesForDisplay(msg.content)}
                          </ReactMarkdown>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
                )
            })}
            {isTyping && (
              <div className="flex w-full min-w-0 justify-start">
                <div className="flex items-center gap-1 py-2 text-[var(--fa-faint)]">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--fa-faint)]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--fa-faint)] [animation-delay:100ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--fa-faint)] [animation-delay:200ms]" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>
        )}

        {/* 悬浮输入岛 */}
        <div className="fa-composer-wrap no-drag">
          <div className="mx-auto w-full max-w-2xl">
            {quickReplyOptions.length > 0 && (
              <div className="mb-3 flex flex-wrap justify-center gap-2">
                {quickReplyOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={isResponding || isTyping}
                    onClick={() => void sendUserText(opt.sendText)}
                    className="fa-quick-chip"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
            <form onSubmit={handleSubmit} className="fa-composer">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isResponding ? 'Fin-Agent 正在回复…' : '输入投资问题，如个股分析、行情查询…'}
                autoFocus
                className="w-full bg-transparent px-5 pt-4 pb-2 text-[15px] text-[var(--fa-text)] outline-none placeholder:text-[var(--fa-faint)]"
                aria-label="消息输入"
              />
              <div className="flex items-center justify-between gap-3 px-4 pb-4">
                <span className="truncate text-xs text-[var(--fa-faint)]">本地金融助手</span>
                <button
                  type="submit"
                  disabled={(!input.trim() && !isResponding) || isTyping}
                  onClick={() =>
                    console.log(
                      '[ChatView] Send/Stop button clicked, isTyping:',
                      isTyping,
                      'isResponding:',
                      isResponding,
                      'input:',
                      input
                    )
                  }
                  className={[
                    'fa-send-btn',
                    isResponding ? 'fa-send-btn-stop hover:brightness-110' : ''
                  ].join(' ')}
                  title={isResponding ? '停止' : '发送'}
                  aria-label={isResponding ? '停止生成' : '发送消息'}
                >
                  {isResponding ? (
                    <Square size={14} fill="currentColor" />
                  ) : (
                    <ArrowUp size={18} strokeWidth={2.5} />
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
        </div>

        <HistoryDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      </div>
    </div>
  )
}

export default ChatView