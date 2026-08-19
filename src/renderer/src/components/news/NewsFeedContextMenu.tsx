import React, { useEffect } from 'react'
import type { NewsCardIntent } from '../../utils/chatPrefill'

export type NewsFeedMenuItem = { intent: NewsCardIntent; label: string }

interface NewsFeedContextMenuProps {
  x: number
  y: number
  items: NewsFeedMenuItem[]
  disabled: boolean
  onSelect: (intent: NewsCardIntent) => void
  onClose: () => void
}

const NewsFeedContextMenu: React.FC<NewsFeedContextMenuProps> = ({
  x,
  y,
  items,
  disabled,
  onSelect,
  onClose
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onWheel = () => onClose()
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
    }
  }, [onClose])

  return (
    <div
      className="fa-news-ctx-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <ul
        className="fa-news-ctx-menu"
        style={{ top: y, left: x }}
        role="menu"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {items.map((item) => (
          <li key={item.intent} role="none">
            <button
              type="button"
              role="menuitem"
              disabled={disabled}
              className="fa-news-ctx-item"
              onClick={() => {
                if (disabled) return
                onSelect(item.intent)
              }}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default NewsFeedContextMenu
