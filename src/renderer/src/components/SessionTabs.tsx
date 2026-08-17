import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Archive, History, Loader2, MessageSquarePlus, PanelLeftClose } from 'lucide-react'
import { useChat } from '../contexts/ChatContext'

export const SIDEBAR_DEFAULT_WIDTH = 260
export const SIDEBAR_MIN_WIDTH = 180
export const SIDEBAR_MAX_WIDTH = 420
/** 拖到此宽度以下松手（或拖动中越过）即完全收缩 */
export const SIDEBAR_COLLAPSE_THRESHOLD = 140

interface SessionTabsProps {
  onOpenDrawer: () => void
  width: number
  collapsed: boolean
  onToggleCollapsed: () => void
  onWidthChange: (width: number) => void
  onCollapse: () => void
}

const SessionTabs: React.FC<SessionTabsProps> = ({
  onOpenDrawer,
  width,
  collapsed,
  onToggleCollapsed,
  onWidthChange,
  onCollapse
}) => {
  const { openTabs, activeSessionId, openSession, archiveTab, newSession, isDraftSession, isSessionStreaming } =
    useChat()
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (collapsed) return
      e.preventDefault()
      e.stopPropagation()
      dragRef.current = { startX: e.clientX, startWidth: width }
      setDragging(true)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const onMove = (ev: MouseEvent) => {
        const drag = dragRef.current
        if (!drag) return
        const next = drag.startWidth + (ev.clientX - drag.startX)
        if (next <= SIDEBAR_COLLAPSE_THRESHOLD) {
          // 越过阈值：结束拖拽态，让宽度用过渡动画收起
          setDragging(false)
          onCollapse()
          return
        }
        // 拖动过程允许低于最小宽度，松手再吸附
        onWidthChange(Math.min(SIDEBAR_MAX_WIDTH, next))
      }

      const onUp = (ev: MouseEvent) => {
        const drag = dragRef.current
        dragRef.current = null
        setDragging(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        if (!drag) return
        const next = drag.startWidth + (ev.clientX - drag.startX)
        if (next <= SIDEBAR_COLLAPSE_THRESHOLD) {
          onCollapse()
        } else {
          onWidthChange(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, next)))
        }
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [collapsed, onCollapse, onWidthChange, width]
  )

  useEffect(() => {
    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  const shellWidth = collapsed ? 0 : width

  return (
    <aside
      className={[
        'fa-sidebar-glass relative h-full shrink-0',
        dragging ? 'fa-sidebar-glass--dragging' : 'fa-sidebar-glass--animating'
      ].join(' ')}
      style={{ width: shellWidth }}
      aria-label="会话侧栏"
      aria-hidden={collapsed}
    >
      <div className="fa-sidebar-inner flex h-full flex-col" style={{ width, minWidth: width }}>
        <div className="fa-sidebar-brand fa-titlebar-row fa-titlebar-row--reserve-start gap-1.5">
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="fa-sidebar-collapse-btn"
            title="收起侧栏"
            aria-label="收起侧栏"
            tabIndex={collapsed ? -1 : 0}
          >
            <PanelLeftClose size={16} strokeWidth={1.75} aria-hidden />
          </button>
          <div className="fa-sidebar-brand-pill min-w-0 flex-1">
            <span className="fa-sidebar-brand-pill-icon" aria-hidden>
              FA
            </span>
            <span className="truncate">Fin-Agent</span>
          </div>
        </div>

        <nav className="space-y-0.5 px-3 pb-2 pt-1" aria-label="主导航">
          <button
            type="button"
            onClick={() => void newSession()}
          className={[
            'fa-sidebar-nav w-full',
            isDraftSession ? 'fa-sidebar-nav-active' : ''
          ].join(' ')}
            aria-current={isDraftSession ? 'page' : undefined}
            tabIndex={collapsed ? -1 : 0}
          >
            <MessageSquarePlus size={16} className="shrink-0 opacity-70" aria-hidden />
            新对话
          </button>
          <button
            type="button"
            onClick={onOpenDrawer}
            className="fa-sidebar-nav w-full"
            tabIndex={collapsed ? -1 : 0}
          >
            <History size={16} className="shrink-0 opacity-70" aria-hidden />
            历史会话
          </button>
        </nav>

        <div className="fa-sidebar-divider" />

        <div className="fa-sidebar-section-label">会话</div>

        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {openTabs.length === 0 && (
            <p className="px-2 py-6 text-center text-xs leading-relaxed text-[var(--fa-sidebar-faint)]">
              暂无打开的会话
            </p>
          )}
          {openTabs.map((tab) => {
            const active = tab.id === activeSessionId
            const streaming = isSessionStreaming(tab.id)
            return (
              <div
                key={tab.id}
                role="button"
                tabIndex={collapsed ? -1 : 0}
                onClick={() => void openSession(tab.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    void openSession(tab.id)
                  }
                }}
                className={['group fa-sidebar-tab', active ? 'fa-sidebar-tab-active' : ''].join(
                  ' '
                )}
                aria-busy={streaming || undefined}
              >
                <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                {streaming && (
                  <span className="shrink-0" title="正在回复">
                    <Loader2
                      size={14}
                      strokeWidth={2}
                      className="fa-sidebar-tab-spinner"
                      aria-hidden
                    />
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    archiveTab(tab.id)
                  }}
                  className="shrink-0 rounded-lg p-0.5 text-[var(--fa-sidebar-faint)] opacity-0 transition-opacity hover:text-[var(--fa-accent)] group-hover:opacity-100 focus-visible:opacity-100"
                  title="归档会话"
                  aria-label={`归档会话 ${tab.title}`}
                  tabIndex={collapsed ? -1 : 0}
                >
                  <Archive size={14} strokeWidth={1.75} aria-hidden />
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {!collapsed && (
        <div
          className="fa-sidebar-resizer"
          onMouseDown={onResizeMouseDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整侧栏宽度"
          title="拖动调整宽度"
        />
      )}
    </aside>
  )
}

export default SessionTabs
