import React from 'react'
import { History, MessageSquarePlus, X } from 'lucide-react'
import { useChat } from '../contexts/ChatContext'

interface SessionTabsProps {
  onOpenDrawer: () => void
}

const SessionTabs: React.FC<SessionTabsProps> = ({ onOpenDrawer }) => {
  const { openTabs, activeSessionId, openSession, closeTab, newSession } = useChat()

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col bg-[var(--fa-sidebar)]">
      <div className="fa-sidebar-brand fa-titlebar-row fa-titlebar-row--reserve-start">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--fa-surface)] text-[11px] font-semibold tracking-tight text-[var(--fa-text)]">
          FA
        </div>
        <span className="truncate text-sm font-medium tracking-tight text-[var(--fa-text)]">
          Fin-Agent
        </span>
      </div>

      <nav className="space-y-0.5 px-3 pb-2 pt-2" aria-label="主导航">
        <button
          type="button"
          onClick={() => void newSession()}
          className="fa-sidebar-nav w-full text-[var(--fa-text)]"
        >
          <MessageSquarePlus size={16} className="shrink-0 opacity-70" aria-hidden />
          新对话
        </button>
        <button type="button" onClick={onOpenDrawer} className="fa-sidebar-nav w-full">
          <History size={16} className="shrink-0 opacity-70" aria-hidden />
          历史会话
        </button>
      </nav>

      <div className="mx-4 h-px bg-[var(--fa-border-subtle)]" />

      <div className="px-4 pt-4 pb-2 text-[11px] font-medium tracking-wide text-[var(--fa-faint)]">
        会话
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {openTabs.length === 0 && (
          <p className="px-2 py-6 text-center text-xs leading-relaxed text-[var(--fa-faint)]">
            暂无打开的会话
          </p>
        )}
        {openTabs.map((tab) => {
          const active = tab.id === activeSessionId
          return (
            <div
              key={tab.id}
              role="button"
              tabIndex={0}
              onClick={() => void openSession(tab.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  void openSession(tab.id)
                }
              }}
              className={['group fa-sidebar-tab', active ? 'fa-sidebar-tab-active' : ''].join(' ')}
            >
              <span className="min-w-0 flex-1 truncate">{tab.title}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(tab.id)
                }}
                className="shrink-0 rounded-lg p-0.5 text-[var(--fa-faint)] opacity-0 transition-opacity hover:text-[var(--fa-danger)] group-hover:opacity-100 focus-visible:opacity-100"
                title="关闭标签"
                aria-label={`关闭会话 ${tab.title}`}
              >
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </aside>
  )
}

export default SessionTabs
