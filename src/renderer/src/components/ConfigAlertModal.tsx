import React from 'react'
import { AlertCircle, X, Settings } from 'lucide-react'

interface ConfigAlertModalProps {
  isOpen: boolean
  message: string
  onConfirm: () => void
  onCancel: () => void
}

const ConfigAlertModal: React.FC<ConfigAlertModalProps> = ({
  isOpen,
  message,
  onConfirm,
  onCancel
}) => {
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-[2px] animate-fade-in"
      style={{ background: 'var(--fa-overlay)' }}
    >
      <div className="mx-4 w-full max-w-md overflow-hidden rounded-2xl border border-[var(--fa-border)] bg-[var(--fa-sidebar)] shadow-2xl animate-scale-in">
        <div className="flex items-center justify-between border-b border-[var(--fa-border-subtle)] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-500/15 p-2 text-amber-500">
              <AlertCircle className="h-5 w-5" />
            </div>
            <h3 className="text-base font-semibold text-[var(--fa-text)]">配置未完成</h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded-lg p-1.5 text-[var(--fa-muted)] transition-colors hover:bg-[var(--fa-surface-hover)] hover:text-[var(--fa-text)]"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-4">
          <p className="leading-relaxed text-[var(--fa-text)]">
            {message || '缺少必需的配置令牌。'}
          </p>
          <p className="mt-3 text-sm text-[var(--fa-muted)]">前往设置进行配置？</p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--fa-border-subtle)] bg-[var(--fa-bg)]/60 px-4 py-3">
          <button type="button" onClick={onCancel} className="fa-btn-ghost px-4 py-2 text-sm">
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="fa-btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm"
          >
            <Settings className="h-4 w-4" />
            前往设置
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfigAlertModal
