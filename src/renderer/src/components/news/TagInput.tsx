import React, { useState } from 'react'
import { X } from 'lucide-react'

interface TagInputProps {
  label: string
  values: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  disabled?: boolean
  hint?: string
}

/** 关键词标签输入：回车/逗号新增，退格删除最后一项，点击 x 移除单项 */
const TagInput: React.FC<TagInputProps> = ({ label, values, onChange, placeholder, disabled, hint }) => {
  const [draft, setDraft] = useState('')

  const commit = () => {
    const text = draft.trim()
    setDraft('')
    if (!text || values.includes(text)) return
    onChange([...values, text])
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Backspace' && !draft && values.length > 0) {
      onChange(values.slice(0, -1))
    }
  }

  const removeAt = (idx: number) => onChange(values.filter((_, i) => i !== idx))

  return (
    <div className="space-y-2">
      <label className="fa-label">{label}</label>
      <div
        className={`fa-input flex min-h-[2.5rem] flex-wrap items-center gap-1.5 py-1.5 ${
          disabled ? 'opacity-60' : ''
        }`}
      >
        {values.map((v, idx) => (
          <span key={`${v}-${idx}`} className="fa-news-chip">
            {v}
            {!disabled && (
              <button
                type="button"
                onClick={() => removeAt(idx)}
                className="cursor-pointer text-[var(--fa-faint)] transition-colors duration-200 hover:text-[var(--fa-danger)]"
                aria-label={`移除关键词 ${v}`}
              >
                <X size={12} />
              </button>
            )}
          </span>
        ))}
        <input
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commit}
          placeholder={values.length === 0 ? placeholder : ''}
          className="min-w-[6rem] flex-1 bg-transparent text-sm text-[var(--fa-text)] outline-none placeholder:text-[var(--fa-faint)]"
          aria-label={label}
        />
      </div>
      {hint && <p className="fa-hint">{hint}</p>}
    </div>
  )
}

export default TagInput
