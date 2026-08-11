import React, { useCallback, useEffect, useState } from 'react'
import { Pin, Pencil, Trash2, Search } from 'lucide-react'
import { useChat } from '../contexts/ChatContext'
import { useAppDialog } from '../contexts/AppDialogContext'

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
  const { confirm, prompt } = useAppDialog()
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
    const next = await prompt({
      title: '重命名会话',
      defaultValue: session.title,
      placeholder: '输入新的会话名称'
    })
    if (!next) return
    await window.api.renameSession(session.id, next)
    await refreshTabs()
    void loadPage(0)
  }

  const handleDelete = async (session: SessionMeta) => {
    const ok = await confirm({
      title: '删除会话',
      message: `确定删除会话「${session.title}」？此操作不可恢复。`,
      confirmLabel: '删除',
      danger: true
    })
    if (!ok) return
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
    <div className="absolute inset-0 z-40 animate-fade-in">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        className="absolute left-0 top-0 bottom-0 flex w-[300px] flex-col border-r border-[var(--fa-border)] bg-[var(--fa-sidebar)] shadow-2xl animate-scale-in"
        role="dialog"
        aria-label="历史会话"
      >
        <div className="border-b border-[var(--fa-border-subtle)] p-3">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--fa-faint)]"
              aria-hidden
            />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runSearch()
              }}
              placeholder="搜索历史会话，回车确认"
              className="w-full rounded-lg border border-[var(--fa-border)] bg-[var(--fa-surface)] py-2 pl-8 pr-3 text-sm text-[var(--fa-text)] placeholder:text-[var(--fa-faint)] outline-none focus:border-[var(--fa-accent)]/50"
              aria-label="搜索历史会话"
            />
          </div>
          {searching && truncated && (
            <p className="mt-1.5 text-xs text-amber-400/90">会话较多，仅显示部分匹配结果</p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {sessions.length === 0 && (
            <p className="mt-6 text-center text-xs text-[var(--fa-faint)]">没有找到会话</p>
          )}
          {sessions.map((session) => {
            const label = searching ? '' : groupLabel(session.updated_at)
            const showLabel = label && label !== lastGroup
            if (showLabel) lastGroup = label
            return (
              <div key={session.id}>
                {showLabel && (
                  <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-[var(--fa-faint)]">
                    {label}
                  </div>
                )}
                <div className="group flex items-center gap-1 rounded-lg px-2 py-1.5 transition-colors duration-200 hover:bg-[var(--fa-surface-hover)]">
                  <button
                    type="button"
                    onClick={() => void handleOpen(session.id)}
                    className="min-w-0 flex-1 cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-1 truncate text-sm text-[var(--fa-text)]">
                      {session.pinned && (
                        <Pin size={12} className="shrink-0 text-[var(--fa-accent)]" aria-label="已置顶" />
                      )}
                      <span className="truncate">{session.title}</span>
                    </div>
                    <div className="truncate text-[11px] text-[var(--fa-faint)]">{session.preview}</div>
                  </button>
                  <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => void handlePin(session)}
                      title="置顶"
                      aria-label="置顶"
                      className="cursor-pointer rounded p-1.5 text-[var(--fa-muted)] hover:text-[var(--fa-accent)]"
                    >
                      <Pin size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRename(session)}
                      title="重命名"
                      aria-label="重命名"
                      className="cursor-pointer rounded p-1.5 text-[var(--fa-muted)] hover:text-[var(--fa-text)]"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(session)}
                      title="删除"
                      aria-label="删除"
                      className="cursor-pointer rounded p-1.5 text-[var(--fa-muted)] hover:text-[var(--fa-danger)]"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {!searching && sessions.length < total && (
          <button
            type="button"
            onClick={() => void loadPage(sessions.length)}
            className="cursor-pointer border-t border-[var(--fa-border-subtle)] p-2.5 text-xs text-[var(--fa-accent)] transition-colors hover:bg-[var(--fa-surface-hover)]"
          >
            更多（还有 {total - sessions.length} 个）
          </button>
        )}
      </div>
    </div>
  )
}

export default HistoryDrawer
