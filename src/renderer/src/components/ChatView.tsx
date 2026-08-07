import React, { useState, useEffect, useRef, useMemo } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Settings, ChevronDown, ChevronRight, Check, Loader2, Terminal, Bell } from 'lucide-react'
import { useChat, ChatBlock, Message } from '../contexts/ChatContext'
import { KlinePanel } from './KlinePanel'
import { BacktestEquityPanel } from './BacktestEquityPanel'
import { ReminderTasksModal } from './ReminderTasksModal'
import SessionTabs from './SessionTabs'
import HistoryDrawer from './HistoryDrawer'
import { parseToolResultToKline } from '../utils/parseToolOhlc'
import { parseRunBacktestEquity } from '../utils/parseToolBacktest'
import { getQuickReplyOptions, stripFinAgentChoicesForDisplay } from '../utils/extractReplyQuickOptions'
import {
  prefersReducedMotion,
  StreamRevealController,
  type RevealKind
} from '../utils/streamReveal'

// ToolExecutionBlock type helper
type ToolExecutionBlock = Extract<ChatBlock, { type: 'tool_execution' }>

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
      className={`border border-gray-700 rounded-lg bg-gray-900/40 overflow-hidden mb-2 ${
        showChart ? 'max-w-[min(100%,min(96vw,1400px))]' : 'max-w-[min(100%,900px)]'
      }`}
    >
      <div 
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-800/50 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="text-gray-400">
          {block.status === 'running' ? (
            <Loader2 className="animate-spin" size={14} />
          ) : block.status === 'success' ? (
            <Check className="text-green-500" size={14} />
          ) : (
            <Terminal size={14} className="text-red-500" />
          )}
        </div>
        <div className="flex-1 font-mono text-xs text-gray-300 truncate flex items-center gap-2">
          <span className="font-semibold text-blue-400">执行 {block.name}</span>
          <span className="text-gray-500 truncate opacity-50">{block.args.substring(0, 50)}</span>
        </div>
        <div className="text-gray-500">
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </div>

      {showKline && klineData && <KlinePanel title={klineData.label} candles={klineData.candles} />}

      {showBacktest && backtestEquity && (
        <BacktestEquityPanel title={backtestEquity.label} points={backtestEquity.points} />
      )}

      {isOpen && (
        <div className="border-t border-gray-700/50 bg-black/20 p-3 space-y-3 text-xs font-mono">
           <div>
             <div className="text-gray-500 mb-1 uppercase text-[10px] tracking-wider font-semibold">输入</div>
             <div className="text-gray-300 break-all whitespace-pre-wrap bg-gray-900/50 p-2 rounded border border-gray-800">
                {block.args}
             </div>
           </div>
           
           {block.result && (
             <div>
               <div className="text-gray-500 mb-1 uppercase text-[10px] tracking-wider font-semibold">输出</div>
               <div className="text-gray-300 break-all whitespace-pre-wrap bg-gray-900/50 p-2 rounded border border-gray-800 max-h-60 overflow-y-auto">
                  {block.result}
               </div>
             </div>
           )}
           
           {block.status === 'running' && (
              <div className="text-gray-500 italic">运行中...</div>
           )}
        </div>
      )}
    </div>
  )
}

// Message interface is now imported from ChatContext

// 表格组件配置，提取出来避免重复创建
const markdownComponents = {
  /** not-prose：避免 typography 把 table 缩成比正文更小；字号与外层 prose-sm 段落对齐 */
  table: ({ children, ...props }: any) => (
    <div className="not-prose my-4 w-full overflow-x-auto rounded-lg border border-gray-700/60 bg-gray-950/40 text-sm leading-7">
      <table {...props} className="w-full min-w-[640px] border-collapse">
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }: any) => (
    <thead {...props} className="bg-gray-800/50">
      {children}
    </thead>
  ),
  tbody: ({ children, ...props }: any) => (
    <tbody {...props}>
      {children}
    </tbody>
  ),
  th: ({ children, ...props }: any) => (
    <th
      {...props}
      className="border border-gray-700 px-4 py-2 text-left text-sm font-semibold leading-7 text-gray-200 whitespace-nowrap"
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }: any) => (
    <td
      {...props}
      className="border border-gray-700 px-4 py-2 text-sm font-normal leading-7 text-gray-300 whitespace-nowrap"
    >
      {children}
    </td>
  ),
  tr: ({ children, ...props }: any) => (
    <tr {...props} className="hover:bg-gray-800/30 transition-colors even:bg-gray-900/30">
      {children}
    </tr>
  ),
}

const ChatView: React.FC = () => {
  const navigate = useNavigate()
  const { messages, setMessages, updateSessionMessages, activeSessionId } = useChat() // 使用 Context 中的消息历史
  const { openTabs } = useChat()
  const [input, setInput] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const [respondingSessions, setRespondingSessions] = useState<Set<string>>(() => new Set())
  const [version, setVersion] = useState('...')
  const [autoScroll, setAutoScroll] = useState(true)
  const [reminderModalOpen, setReminderModalOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const activeSessionIdRef = useRef(activeSessionId)
  activeSessionIdRef.current = activeSessionId
  const revealRef = useRef<StreamRevealController | null>(null)
  const previousOpenTabIdsRef = useRef<Set<string>>(new Set())
  const [revealingKeys, setRevealingKeys] = useState<Set<string>>(() => new Set())

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

  const appendRevealed = (sessionKey: string, kind: RevealKind, chunk: string) => {
    const sessionId = sessionKey === '__default__' ? undefined : sessionKey
    applyToSessionRef.current(sessionId, (prev) => {
      const newMessages = [...prev]
      if (!newMessages.length || newMessages[newMessages.length - 1].role !== 'assistant') {
        newMessages.push({ role: 'assistant', content: '', logs: '', blocks: [] })
      }

      const ai = newMessages.length - 1
      const src = newMessages[ai]
      newMessages[ai] = {
        ...src,
        blocks: (src.blocks || []).map((block) => ({ ...block }))
      }
      const assistantMsg = newMessages[ai]
      if (!assistantMsg.blocks) assistantMsg.blocks = []

      const last = assistantMsg.blocks[assistantMsg.blocks.length - 1]
      if (kind === 'text') {
        assistantMsg.content = (assistantMsg.content || '') + chunk
        if (last?.type === 'text') {
          assistantMsg.blocks[assistantMsg.blocks.length - 1] = {
            ...last,
            content: last.content + chunk
          }
        } else {
          assistantMsg.blocks.push({ type: 'text', content: chunk })
        }
      } else if (last?.type === 'thinking') {
        assistantMsg.blocks[assistantMsg.blocks.length - 1] = {
          ...last,
          content: last.content + chunk
        }
      } else {
        assistantMsg.blocks.push({ type: 'thinking', content: chunk })
      }

      return newMessages
    })
  }
  const appendRevealedRef = useRef(appendRevealed)
  appendRevealedRef.current = appendRevealed

  useEffect(() => {
    const ctrl = new StreamRevealController({
      onReveal: (sessionKey, kind, chunk) => {
        appendRevealedRef.current(sessionKey, kind, chunk)
        if (!prefersReducedMotion()) {
          setRevealingKeys((prev) => {
            const next = new Set(prev)
            next.add(sessionKey)
            return next
          })
        }
      },
      onSettled: (sessionKey) => {
        setRevealingKeys((prev) => {
          const next = new Set(prev)
          next.delete(sessionKey)
          return next
        })
      }
    })
    revealRef.current = ctrl
    return () => {
      ctrl.disposeAll()
      revealRef.current = null
    }
  }, [])
  useEffect(() => {
    const currentOpenTabIds = new Set(openTabs.map((tab) => tab.id))
    const closedTabIds = [...previousOpenTabIdsRef.current].filter(
      (id) => !currentOpenTabIds.has(id)
    )
    closedTabIds.forEach((id) => revealRef.current?.dispose(id))
    if (closedTabIds.length > 0) {
      setRevealingKeys((prev) => {
        const next = new Set(prev)
        closedTabIds.forEach((id) => next.delete(id))
        return next
      })
    }
    previousOpenTabIdsRef.current = currentOpenTabIds
  }, [openTabs])

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
  const quickReplyOptions = useMemo(
    () => getQuickReplyOptions(messages, isResponding, isTyping),
    [messages, isResponding, isTyping]
  )

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
          const key = eventSessionId || activeSessionIdRef.current || '__default__'
          revealRef.current?.markEnded(key)
        }

        if (data.type === 'content' || data.type === 'thinking') {
          applyToSession(eventSessionId, (prev) => {
            const last = prev[prev.length - 1]
            if (last?.role === 'assistant') return prev
            return [...prev, { role: 'assistant', content: '', logs: '', blocks: [] }]
          })
          const key = eventSessionId || activeSessionIdRef.current || '__default__'
          revealRef.current?.enqueue(
            key,
            data.type === 'content' ? 'text' : 'thinking',
            data.content || ''
          )
          return
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
            
            // Helper specifically for tool execution
            const getLastToolExecution = () => {
                const lastBlock = assistantMsg.blocks[assistantMsg.blocks.length - 1]
                if (lastBlock && lastBlock.type === 'tool_execution') {
                    return lastBlock
                }
                return null
            }

            if (data.type === 'answer') {
                // Some providers only return a final answer event.
                const key = eventSessionId || activeSessionIdRef.current || '__default__'
                const ctrl = revealRef.current
                const hasText =
                    Boolean(assistantMsg.content?.trim()) ||
                    assistantMsg.blocks.some(
                        (block) => block.type === 'text' && Boolean(block.content)
                    )
                // Providers may send both content chunks and a final answer; an active reveal already owns that text.
                if (!hasText && !ctrl?.isRevealing(key) && data.content) {
                    ctrl?.enqueue(key, 'text', data.content)
                }
                ctrl?.markEnded(key)
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
      const key = activeSessionId || '__default__'
      revealRef.current?.flush(key)
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
    <div className="relative flex flex-col h-screen bg-gray-900 text-white drag-region">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900/50 backdrop-blur no-drag">
        <div className="font-semibold text-lg">Fin-Agent</div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setReminderModalOpen(true)}
            className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-gray-800"
            title="提醒任务"
          >
            <Bell size={18} />
          </button>
          <button
            onClick={() => navigate('/portfolio')}
            className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-gray-800"
            title="投资组合"
          >
            投资组合
          </button>
          <button
            onClick={() => navigate('/config')}
            className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-gray-800"
            title="设置"
          >
            <Settings size={18} />
          </button>
          <button
            onClick={() => navigate('/about')}
            className="text-xs text-gray-500 hover:text-blue-400 transition-colors cursor-pointer"
            title="关于 / 支持"
          >v{version}</button>
        </div>
      </div>

      <ReminderTasksModal open={reminderModalOpen} onClose={() => setReminderModalOpen(false)} />

      <SessionTabs onOpenDrawer={() => setDrawerOpen(true)} />

      {/* Messages */}
      <div 
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4 md:px-8 space-y-6 no-drag"
      >
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start w-full'}`}>
            <div className={`${
              msg.role === 'user' 
                ? 'bg-blue-600 text-white rounded-2xl px-4 py-3 max-w-[min(90%,42rem)]' 
                : 'text-gray-100 py-2 w-full min-w-0 max-w-full'
            }`}>
              {msg.role === 'user' ? (
                msg.content
              ) : (
                <div className="w-full space-y-4">
                  {(msg.blocks || []).map((block, bIdx) => {
                    if (block.type === 'thinking') {
                      return (
                        <div key={bIdx} className="text-xs text-gray-400 bg-gray-900/50 p-3 rounded-lg border border-gray-700/50">
                          <div className="font-bold mb-1 opacity-70 flex items-center gap-2">
                            <span>💭 思考过程</span>
                          </div>
                          <div className="whitespace-pre-wrap break-words opacity-90 leading-relaxed font-mono">
                            {block.content}
                          </div>
                        </div>
                      )
                    }
                    if (block.type === 'tool_execution') {
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
                      const showCaret =
                        idx === messages.length - 1 &&
                        bIdx === lastTextBlockIndex &&
                        revealingKeys.has(activeSessionId || '__default__')
                      return (
                        <React.Fragment key={bIdx}>
                          <div className="prose prose-invert prose-sm max-w-none">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={markdownComponents}
                            >
                              {md}
                            </ReactMarkdown>
                          </div>
                          {showCaret && <span className="fa-stream-caret" aria-hidden />}
                        </React.Fragment>
                      )
                    }
                    return null
                  })}
                  
                  {/* Fallback for messages without blocks (legacy) */}
                  {(!msg.blocks || msg.blocks.length === 0) && msg.content && (
                     <div className="prose prose-invert prose-sm max-w-none">
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
            
            {/* Logs Display (Removed legacy logs block) */}
          </div>
        ))}
        {isTyping && (
           <div className="flex w-full min-w-0 justify-start">
            <div className="text-gray-500 py-2 flex gap-1 items-center">
              <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"></span>
              <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce delay-100"></span>
              <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce delay-200"></span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t border-gray-800 bg-gray-900/50 backdrop-blur px-4 py-4 md:px-8 no-drag">
        {quickReplyOptions.length > 0 && (
          <div className="mb-3 flex flex-col gap-2">
            <div className="text-[11px] text-slate-500">可选回复（助手附带或自动识别；不足时补充通用追问）</div>
            <div className="flex flex-wrap gap-2">
              {quickReplyOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  disabled={isResponding || isTyping}
                  onClick={() => void sendUserText(opt.sendText)}
                  className="max-w-full break-words rounded-xl border border-slate-600 bg-slate-800/90 px-3 py-2 text-left text-sm text-slate-100 transition-colors hover:border-blue-500/50 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isResponding ? "Fin-Agent 正在回复..." : "输入消息..."}
            autoFocus
            className="flex-1 bg-gray-800 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
          />
          <button 
            type="submit"
            disabled={(!input.trim() && !isResponding) || isTyping}
            onClick={() => console.log('[ChatView] Send/Stop button clicked, isTyping:', isTyping, 'isResponding:', isResponding, 'input:', input)}
            className={`${
              isResponding 
                ? 'bg-red-600 hover:bg-red-700' 
                : 'bg-blue-600 hover:bg-blue-700'
            } disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl px-6 py-2 transition-colors font-medium`}
          >
            {isResponding ? '停止' : '发送'}
          </button>
        </form>
      </div>

      <HistoryDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  )
}

export default ChatView