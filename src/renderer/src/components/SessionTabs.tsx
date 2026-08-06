import React from 'react'
import { useChat } from '../contexts/ChatContext'

interface SessionTabsProps {
  onOpenDrawer: () => void
}

const SessionTabs: React.FC<SessionTabsProps> = ({ onOpenDrawer }) => {
  const { openTabs, activeSessionId, openSession, closeTab, newSession } = useChat()

  return (
    <div className="flex items-end gap-1 px-2 h-9 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
      <button
        onClick={onOpenDrawer}
        title="历史会话"
        className="px-2 py-1 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 shrink-0"
      >
        ☰
      </button>

      {openTabs.map((tab) => {
        const active = tab.id === activeSessionId
        return (
          <div
            key={tab.id}
            onClick={() => void openSession(tab.id)}
            className={[
              'group flex items-center gap-1 px-3 py-1 rounded-t text-xs cursor-pointer shrink-0 max-w-[160px]',
              active
                ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-b-0 border-gray-200 dark:border-gray-700'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
            ].join(' ')}
          >
            <span className="truncate">{tab.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.id)
              }}
              className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500"
              title="关闭标签"
            >
              ×
            </button>
          </div>
        )
      })}

      <button
        onClick={() => void newSession()}
        title="新建会话"
        className="px-2 py-1 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 shrink-0"
      >
        ＋
      </button>
    </div>
  )
}

export default SessionTabs
