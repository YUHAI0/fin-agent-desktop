import React, { useState, useEffect, useRef, useMemo } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Settings, ChevronDown, ChevronRight, Check, Loader2, Terminal, Bell } from 'lucide-react'
import { useChat, ChatBlock, Message } from '../contexts/ChatContext'
import { KlinePanel } from './KlinePanel'
import { ReminderTasksModal } from './ReminderTasksModal'
import { parseToolResultToKline } from '../utils/parseToolOhlc'

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
  const showKline = block.status === 'success' && klineData != null

  return (
    <div
      className={`border border-gray-700 rounded-lg bg-gray-900/40 overflow-hidden mb-2 ${
        showKline ? 'max-w-[min(100%,720px)]' : 'max-w-[600px]'
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
  table: ({ children, ...props }: any) => (
    <div className="overflow-x-auto my-4 -mx-4 px-4">
      <table {...props} className="min-w-full border-collapse">
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
    <th {...props} className="border border-gray-700 px-4 py-2 text-left font-semibold text-gray-200 whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children, ...props }: any) => (
    <td {...props} className="border border-gray-700 px-4 py-2 text-gray-300 whitespace-nowrap">
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
  const { messages, setMessages } = useChat() // 使用 Context 中的消息历史
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [isResponding, setIsResponding] = useState(false) // 跟踪AI是否正在响应
  const [version, setVersion] = useState('...')
  const [autoScroll, setAutoScroll] = useState(true)
  const [reminderModalOpen, setReminderModalOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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
    const removeListener = window.api.onNewMessage((text) => {
      console.log('[ChatView] Received new-message:', text)
      if (text) {
        setMessages(prev => [...prev, { role: 'user', content: text, blocks: [] }])
        setIsTyping(true)
        setIsResponding(true) // 用户发送消息后，AI开始响应
        // Don't create assistant message yet - wait for first stream event
      }
    })

    const removeBotStreamListener = window.api.onBotStream((data: any) => {
        if (!data) return;

        // tool_call_chunk / content 在流式下每秒可达数十上百次，逐条打日志会淹没控制台且无助于排错
        if (data.type !== 'tool_call_chunk' && data.type !== 'content') {
            console.log('[ChatView] Received bot-stream event:', data.type)
        }
        
        // 标记AI正在响应（使用函数式更新避免闭包问题）
        setIsResponding(prev => {
            if (!prev && (data.type === 'content' || data.type === 'answer' || data.type === 'thinking' || data.type === 'tool_call' || data.type === 'tool_call_chunk')) {
                return true
            }
            return prev
        })
        
        // Hide typing indicator as soon as we receive any content from AI
        if (data.type === 'content' || data.type === 'answer') {
            console.log('[ChatView] Received content/answer, hiding typing indicator')
            setIsTyping(false)
        } else if (data.type === 'error' || data.type === 'finish') {
            console.log('[ChatView] Received error/finish, hiding typing indicator')
            setIsTyping(false)
            setIsResponding(false) // AI响应结束
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
            
            // Helper to get or create last block of specific type
            const getLastBlock = (type: ChatBlock['type']) => {
                const lastBlock = assistantMsg.blocks[assistantMsg.blocks.length - 1]
                if (lastBlock && lastBlock.type === type) {
                    return lastBlock
                }
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
                assistantMsg.content += data.content
                const lastBlock = getLastBlock('text')
                if (lastBlock && lastBlock.type === 'text') {
                    lastBlock.content += data.content
                } else {
                    assistantMsg.blocks.push({ type: 'text', content: data.content })
                }
            } else if (data.type === 'answer') {
                // Some providers only return a final answer event.
                if (!assistantMsg.content || assistantMsg.content.trim() === '') {
                    assistantMsg.content = data.content || ''
                    // Also add to blocks if empty
                    if (assistantMsg.blocks.length === 0) {
                         assistantMsg.blocks.push({ type: 'text', content: data.content || '' })
                    } else {
                        // Check if we should append to last text block
                        const lastBlock = getLastBlock('text')
                        if (lastBlock && lastBlock.type === 'text') lastBlock.content += (data.content || '')
                        else assistantMsg.blocks.push({ type: 'text', content: data.content || '' })
                    }
                }
            } else if (data.type === 'thinking') {
                // We keep thinking separate, usually at start or interleaved
                const lastBlock = getLastBlock('thinking')
                if (lastBlock && lastBlock.type === 'thinking') {
                    lastBlock.content += data.content
                } else {
                    assistantMsg.blocks.push({ type: 'thinking', content: data.content })
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
            flushSync(() => setMessages(patchFromStream))
        } else {
            setMessages(patchFromStream)
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
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    console.log('[ChatView] handleSubmit called, input:', input)
    
    // 如果AI正在响应，点击按钮应该是停止生成
    if (isResponding) {
      console.log('[ChatView] Stopping generation...')
      window.api.stopGeneration()
      setIsResponding(false)
      return
    }
    
    if (!input.trim()) {
      console.log('[ChatView] Input is empty, returning')
      return
    }
    
    // Check config first
    try {
      const status = await window.api.checkConfig()
      if (!status.configured) {
        console.log('[ChatView] Config not configured, redirecting to config page')
        navigate('/config')
        return
      }
    } catch (err) {
      console.error('[ChatView] Config check failed:', err)
      // If check fails, assume not configured and redirect
      navigate('/config')
      return
    }

    console.log('[ChatView] Sending input to main process:', input)
    // Send to main process
    window.api.submitInput(input)
    setInput('')
    setIsResponding(true) // 标记AI开始响应
    // Keep focus on input after submit
    setTimeout(() => {
        inputRef.current?.focus()
        setAutoScroll(true) // Force auto scroll on new user message
        scrollToBottom()
    }, 0)
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
    <div className="flex flex-col h-screen bg-gray-900 text-white drag-region">
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
            onClick={() => navigate('/config')}
            className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-gray-800"
            title="设置"
          >
            <Settings size={18} />
          </button>
          <button
            onClick={() => window.api.openExternal('https://fin-agent.chat')}
            className="text-xs text-gray-500 hover:text-blue-400 transition-colors cursor-pointer"
            title="访问官网"
          >v{version}</button>
        </div>
      </div>

      <ReminderTasksModal open={reminderModalOpen} onClose={() => setReminderModalOpen(false)} />

      {/* Messages */}
      <div 
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-6 no-drag"
      >
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start w-full'}`}>
            <div className={`${
              msg.role === 'user' 
                ? 'bg-blue-600 text-white rounded-2xl px-4 py-3 max-w-[90%]' 
                : 'text-gray-100 py-2 w-full max-w-[800px]'
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
                      return (
                        <div key={bIdx} className="prose prose-invert prose-sm max-w-none">
                          <ReactMarkdown 
                            remarkPlugins={[remarkGfm]}
                            components={markdownComponents}
                          >
                            {block.content}
                          </ReactMarkdown>
                        </div>
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
                          {msg.content}
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
           <div className="flex justify-start">
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
      <div className="p-4 border-t border-gray-800 bg-gray-900/50 backdrop-blur no-drag">
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
    </div>
  )
}

export default ChatView