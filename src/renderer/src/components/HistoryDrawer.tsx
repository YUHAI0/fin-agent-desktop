import React, { useCallback, useEffect, useState } from 'react'
import { useChat } from '../contexts/ChatContext'

interface HistoryDrawerProps {
  open: boolean
  onClose: () => void
}

const PAGE_SIZE = 20

function groupLabel(updatedAt: number): string {
  const now = Date.now() / 1000
  const diffDays = (now - updatedAt) / 86400
  if (diffDays < 1) return '今天'
  if (diffDays < 7) return '最近 7 天'
  if (diffDays < 30) return '最近 30 天'
  return '更早'
}

const HistoryDrawer: React.FC<HistoryDrawerProps> = ({ open, onClose }) => {
  const { openSession, refreshTabs } = useChat()
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [total, setTotal] = useState(0)
  const [keyword, setKeyword] = useState('')
  const [searching, setSearching] = useState(false)
  const [truncated, setTruncated] = useState(false)

  const loadPage = useCallback(async (offset: number) => {
    const res = await window.api.listSessions(offset, PAGE_SIZE)
    setTotal(res.total)
    setSessions((prev) => (offset === 0 ? res.sessions : [...prev, ...res.sessions]))
  }, [])

  useEffect(() => {
    if (!open) return
    setKeyword('')
    setSearching(false)
    setTruncated(false)
    void loadPage(0)
  }, [open, loadPage])

  const runSearch = async () => {
    if (!keyword.trim()) {
      setSearching(false)
      void loadPage(0)
      return
    }
    const res = await window.api.searchSessions(keyword.trim())
    setSearching(true)
    setTruncated(res.truncated)
    setSessions(res.sessions)
  }

  const handleOpen = async (id: string) => {
    await openSession(id)
    onClose()
  }

  const handleRename = async (session: SessionMeta) => {
    const next = window.prompt('重命名会话', session.title)
    if (!next) return
    await window.api.renameSession(session.id, next)
    await refreshTabs()
    void loadPage(0)
  }

  const handleDelete = async (session: SessionMeta) => {
    if (!window.confirm(`确定删除会话「${session.title}」？此操作不可恢复。`)) return
    await window.api.deleteSession(session.id)
    await refreshTabs()
    void loadPage(0)
  }

  const handlePin = async (session: SessionMeta) => {
    await window.api.pinSession(session.id, !session.pinned)
    void loadPage(0)
  }

  if (!open) return null

  let lastGroup = ''

  return (
    <div className="absolute inset-0 z-40">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute left-0 top-0 bottom-0 w-[280px] bg-white dark:bg-gray-900 shadow-xl flex flex-col">
        <div className="p-3 border-b border-gray-200 dark:border-gray-700">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runSearch()
            }}
            placeholder="搜索历史会话，回车确认"
            className="w-full px-2 py-1 text-sm border rounded dark:bg-gray-800 dark:border-gray-700"
          />
          {searching && truncated && (
            <p className="text-xs text-amber-600 mt-1">会话较多，仅显示部分匹配结果</p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {sessions.length === 0 && (
            <p className="text-xs text-gray-400 text-center mt-6">没有找到会话</p>
          )}
          {sessions.map((session) => {
            const label = searching ? '' : groupLabel(session.updated_at)
            const showLabel = label && label !== lastGroup
            if (showLabel) lastGroup = label
            return (
              <div key={session.id}>
                {showLabel && (
                  <div className="text-[10px] uppercase text-gray-400 px-2 pt-2 pb-1">{label}</div>
                )}
                <div className="group flex items-center gap-1 px-2 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
                  <button
                    onClick={() => void handleOpen(session.id)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="text-sm truncate text-gray-800 dark:text-gray-200">
                      {session.pinned ? '📌 ' : ''}
                      {session.title}
                    </div>
                    <div className="text-[11px] truncate text-gray-400">{session.preview}</div>
                  </button>
                  <div className="opacity-0 group-hover:opacity-100 flex gap-0.5 shrink-0">
                    <button onClick={() => void handlePin(session)} title="置顶" className="px-1 text-xs">
                      📌
                    </button>
                    <button onClick={() => void handleRename(session)} title="重命名" className="px-1 text-xs">
                      ✎
                    </button>
                    <button onClick={() => void handleDelete(session)} title="删除" className="px-1 text-xs">
                      🗑
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {!searching && sessions.length < total && (
          <button
            onClick={() => void loadPage(sessions.length)}
            className="p-2 text-xs text-blue-600 hover:bg-gray-100 dark:hover:bg-gray-800 border-t border-gray-200 dark:border-gray-700"
          >
            更多（还有 {total - sessions.length} 个）
          </button>
        )}
      </div>
    </div>
  )
}

export default HistoryDrawer
