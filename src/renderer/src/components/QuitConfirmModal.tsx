import React from 'react'
import { AlertTriangle, X } from 'lucide-react'

interface QuitConfirmModalProps {
  isOpen: boolean
  onConfirm: () => void
  onCancel: () => void
}

const QuitConfirmModal: React.FC<QuitConfirmModalProps> = ({
  isOpen,
  onConfirm,
  onCancel
}) => {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px] no-drag animate-fade-in">
      <div
        className="mx-4 w-full max-w-md overflow-hidden rounded-2xl border border-[var(--fa-border)] bg-[var(--fa-sidebar)] shadow-2xl animate-scale-in"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="quit-confirm-title"
      >
        <div className="flex items-center justify-between border-b border-[var(--fa-border-subtle)] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <h3 id="quit-confirm-title" className="text-base font-semibold text-[var(--fa-text)]">
              确认退出
            </h3>
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
          <p className="text-[var(--fa-text)]">Fin-Agent 正在生成回复</p>
          <p className="mt-2 text-sm text-[var(--fa-muted)]">是否要停止生成并退出应用？</p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--fa-border-subtle)] bg-[var(--fa-surface)]/40 px-4 py-3">
          <button type="button" onClick={onCancel} className="fa-btn-ghost px-4 py-2 text-sm">
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="cursor-pointer rounded-xl bg-[var(--fa-danger)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            继续退出
          </button>
        </div>
      </div>
    </div>
  )
}

export default QuitConfirmModal
