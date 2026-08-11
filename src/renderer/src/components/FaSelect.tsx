import React, { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export interface FaSelectOption {
  value: string
  label: string
}

interface FaSelectProps {
  value: string
  options: FaSelectOption[]
  onChange: (value: string) => void
  className?: string
  disabled?: boolean
  'aria-label'?: string
}

const FaSelect: React.FC<FaSelectProps> = ({
  value,
  options,
  onChange,
  className = '',
  disabled = false,
  'aria-label': ariaLabel
}) => {
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])
  const listId = useId()
  const selected = options.find((o) => o.value === value) ?? options[0]

  // 展开时以当前选中项作为键盘导航起点，避免每次都从第一项开始
  useEffect(() => {
    if (!open) return
    const currentIndex = options.findIndex((o) => o.value === value)
    setHighlightedIndex(currentIndex >= 0 ? currentIndex : 0)
    // 仅在展开瞬间初始化一次，导航过程中不应被 options/value 变化重置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    optionRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [open, highlightedIndex])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          setOpen(false)
          break
        case 'ArrowDown':
          e.preventDefault()
          setHighlightedIndex((i) => Math.min(i + 1, options.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setHighlightedIndex((i) => Math.max(i - 1, 0))
          break
        case 'Home':
          e.preventDefault()
          setHighlightedIndex(0)
          break
        case 'End':
          e.preventDefault()
          setHighlightedIndex(options.length - 1)
          break
        case 'Enter':
        case ' ': {
          const opt = options[highlightedIndex]
          if (opt) {
            e.preventDefault()
            onChange(opt.value)
            setOpen(false)
          }
          break
        }
        default:
          break
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, options, highlightedIndex, onChange])

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (disabled || open) return
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
          }
        }}
        className="fa-input flex cursor-pointer items-center justify-between gap-3 text-left"
      >
        <span className="min-w-0 truncate">{selected?.label ?? ''}</span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-[var(--fa-muted)] transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-activedescendant={`${listId}-${options[highlightedIndex]?.value ?? value}`}
          className="absolute left-0 right-0 z-50 mt-1.5 max-h-72 overflow-auto rounded-xl border border-[var(--fa-border)] bg-[var(--fa-sidebar)] py-1.5 shadow-2xl animate-scale-in"
        >
          {options.map((opt, idx) => {
            const active = opt.value === value
            const highlighted = idx === highlightedIndex
            return (
              <li key={opt.value} role="none">
                <button
                  ref={(el) => {
                    optionRefs.current[idx] = el
                  }}
                  type="button"
                  role="option"
                  id={`${listId}-${opt.value}`}
                  aria-selected={active}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  onClick={() => {
                    onChange(opt.value)
                    setOpen(false)
                  }}
                  className={`flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                    active
                      ? 'bg-[var(--fa-accent-soft)] text-[var(--fa-text)]'
                      : highlighted
                        ? 'bg-[var(--fa-surface-hover)] text-[var(--fa-text)]'
                        : 'text-[var(--fa-muted)] hover:bg-[var(--fa-surface-hover)] hover:text-[var(--fa-text)]'
                  }`}
                >
                  <span>{opt.label}</span>
                  {active && <Check size={15} className="shrink-0 text-[var(--fa-accent)]" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default FaSelect
