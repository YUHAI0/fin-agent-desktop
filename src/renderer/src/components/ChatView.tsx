import React, { useState, useEffect, useRef, useMemo } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Settings, ChevronDown, ChevronRight, Check, Loader2, Terminal, Bell, Briefcase, Newspaper, ArrowUp, Square, Brain, Sun, Moon, Sparkles } from 'lucide-react'
import { useChat, ChatBlock, Message } from '../contexts/ChatContext'
import { useTheme } from '../contexts/ThemeContext'
import { KlinePanel } from './KlinePanel'
import { BacktestEquityPanel } from './BacktestEquityPanel'
import { ReminderTasksModal } from './ReminderTasksModal'
import SessionTabs from './SessionTabs'
import HistoryDrawer from './HistoryDrawer'
import { parseToolResultToKline } from '../utils/parseToolOhlc'
import { parseRunBacktestEquity } from '../utils/parseToolBacktest'
import { getQuickReplyOptions, stripFinAgentChoicesForDisplay } from '../utils/extractReplyQuickOptions'
import { getDefaultQuickReplyOptions, normalizeSessionMessages } from '../utils/welcomeAgentMessage'
import { parseMaLadder } from '../utils/parseMaLadder'
import { MaLadderPanel } from './MaLadderPanel'

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
          <span className="font-semibold text-[var(--fa-accent)]">执行 {block.name}</span>
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

// 表格组件配置：跟随 CSS 主题变量（昼夜模式一致）
const markdownComponents = {
  /** not-prose：避免 typography 把 table 缩成比正文更小；字号与外层 prose-sm 段落对齐 */
  table: ({ children, ...props }: any) => (
    <div className="not-prose my-4 w-full overflow-x-auto rounded-xl border border-[var(--fa-border)] bg-[var(--fa-surface)] text-sm leading-7 shadow-sm">
      <table {...props} className="w-full min-w-[640px] border-collapse">
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }: any) => (
    <thead {...props} className="bg-[var(--fa-surface-hover)]">
      {children}
    </thead>
  ),
  tbody: ({ children, ...props }: any) => <tbody {...props}>{children}</tbody>,
  th: ({ children, ...props }: any) => (
    <th
      {...props}
      className="border-b border-[var(--fa-border)] px-4 py-2.5 text-left text-sm font-semibold leading-7 text-[var(--fa-text)] whitespace-nowrap"
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }: any) => (
    <td
      {...props}
      className="border-b border-[var(--fa-border-subtle)] px-4 py-2.5 text-sm font-normal leading-7 text-[var(--fa-text)] whitespace-nowrap"
    >
      {children}
    </td>
  ),
  tr: ({ children, ...props }: any) => (
    <tr
      {...props}
      className="transition-colors duration-150 even:bg-[var(--fa-stripe)] hover:bg-[var(--fa-surface-hover)]"
    >
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
  }
}

const ChatView: React.FC = () => {
  const navigate = useNavigate()
  const { messages, setMessages, updateSessionMessages, activeSessionId } = useChat() // 使用 Context 中的消息历史
  const { theme, setTheme } = useTheme()
  const [input, setInput] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const [respondingSessions, setRespondingSessions] = useState<Set<string>>(() => new Set())
  const [version, setVersion] = useState('...')
  const [autoScroll, setAutoScroll] = useState(true)
  const [reminderModalOpen, setReminderModalOpen] = useState(false)
  const [newsUnreadCount, setNewsUnreadCount] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const activeSessionIdRef = useRef(activeSessionId)
  activeSessionIdRef.current = activeSessionId

  const applyToSession = (
    sessionId: string | undefined,
    updater: (prev: Message[]) => Message[]
  ) => {
    if (sessionId) {
      updateSessionMessages(sessionId, updater)
    } else if (activeSessionIdRef.current) {
      updateSessionMessages(activeSessionIdRef.current, updater)
    } else {
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

  const quickReplyOptions = useMemo(() => {
    if (isResponding || isTyping) return []
    if (showWelcomeHero) return getDefaultQuickReplyOptions()
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

  useEffect(() => {
    const applyToSession = (
      sessionId: string | undefined,
      updater: (prev: Message[]) => Message[]
    ) => applyToSessionRef.current(sessionId, updater)

    const isActiveSession = (sessionId?: string) =>
      !sessionId || sessionId === activeSessionIdRef.current

    const removeListener = window.api.onNewMessage((payload) => {
      const text = typeof payload === 'string' ? payload : payload?.text
      const sessionId = typeof payload === 'string' ? undefined : payload?.sessionId
      console.log('[ChatView] Received new-message:', text, sessionId)
      if (text) {
        applyToSession(sessionId, (prev) => [...prev, { role: 'user', content: text, blocks: [] }])
        markResponding(sessionId, true)
        if (isActiveSession(sessionId)) {
          setIsTyping(true)
        }
        // Don't create assistant message yet - wait for first stream event
      }
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

        // 仅活动会话更新输入区 typing 指示
        if (isActiveSession(eventSessionId)) {
          if (data.type === 'content' || data.type === 'answer') {
              console.log('[ChatView] Received content/answer, hiding typing indicator')
              setIsTyping(false)
          } else if (data.type === 'error' || data.type === 'finish') {
              console.log('[ChatView] Received error/finish, hiding typing indicator')
              setIsTyping(false)
          }
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

    window.api.submitInput(trimmed, activeSessionId ?? undefined)
    setInput('')
    markResponding(activeSessionId ?? undefined, true)
    setTimeout(() => {
      inputRef.current?.focus()
      setAutoScroll(true)
      scrollToBottom()
    }, 0)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    console.log('[ChatView] handleSubmit called, input:', input)

    if (isResponding) {
      console.log('[ChatView] Stopping generation...')
      window.api.stopGeneration(activeSessionId ?? undefined)
      markResponding(activeSessionId ?? undefined, false)
      setIsTyping(false)
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
    <div className="fa-app-shell">
      <div className="fa-app-shell-bg" aria-hidden />
      {/* 整窗一层连续玻璃：侧栏 + 顶栏无接缝 */}
      <div className="fa-chrome-glass" aria-hidden />
      <SessionTabs onOpenDrawer={() => setDrawerOpen(true)} />

      <div className="fa-shell-main">
        <header className="fa-shell-toolbar fa-titlebar-row fa-titlebar-row--reserve-end">
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

        {/* 空状态 hero 或消息流 */}
        {showWelcomeHero ? (
          <div className="fa-hero no-drag">
            <div className="fa-hero-icon" aria-hidden>
              <Sparkles size={28} strokeWidth={1.5} />
            </div>
            <h1 className="fa-hero-title">今天想分析什么？</h1>
            <p className="fa-hero-sub">
              行情、财务、选股、回测与持仓提醒 — 直接输入，或点下方快捷语句开始
            </p>
          </div>
        ) : (
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto px-4 py-8 md:px-8 no-drag"
          >
            <div className="mx-auto w-full max-w-3xl space-y-8">
              {displayMessages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start w-full'}`}
              >
                <div
                  className={
                    msg.role === 'user'
                      ? 'fa-user-bubble max-w-[min(90%,32rem)] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed text-[var(--fa-text)]'
                      : 'w-full min-w-0 max-w-full py-0.5 text-[15px] leading-relaxed text-[var(--fa-text)]'
                  }
                >
                  {msg.role === 'user' ? (
                    msg.content
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
            ))}
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