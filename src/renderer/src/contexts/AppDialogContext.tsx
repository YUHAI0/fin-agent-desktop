import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { AlertTriangle, Info, X } from 'lucide-react'

type DialogKind = 'confirm' | 'alert' | 'prompt'

interface DialogBase {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

interface ConfirmOptions extends DialogBase {
  kind: 'confirm'
}

interface AlertOptions extends DialogBase {
  kind: 'alert'
}

interface PromptOptions extends DialogBase {
  kind: 'prompt'
  defaultValue?: string
  placeholder?: string
}

type DialogRequest = ConfirmOptions | AlertOptions | PromptOptions

type DialogState = DialogRequest & { open: true }

interface AppDialogContextValue {
  confirm: (options: Omit<ConfirmOptions, 'kind'>) => Promise<boolean>
  alert: (options: Omit<AlertOptions, 'kind'>) => Promise<void>
  prompt: (options: Omit<PromptOptions, 'kind'>) => Promise<string | null>
}

const AppDialogContext = createContext<AppDialogContextValue | undefined>(undefined)

function AppDialogHost({
  dialog,
  onResolve
}: {
  dialog: DialogState | null
  onResolve: (value: boolean | string | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')

  useEffect(() => {
    if (!dialog) return
    if (dialog.kind === 'prompt') {
      setValue(dialog.defaultValue ?? '')
      const t = window.setTimeout(() => inputRef.current?.focus(), 0)
      return () => window.clearTimeout(t)
    }
    setValue('')
    return undefined
  }, [dialog])

  if (!dialog) return null

  const danger = dialog.danger ?? dialog.kind === 'confirm'
  const Icon = danger && dialog.kind !== 'alert' ? AlertTriangle : Info
  const iconClass =
    danger && dialog.kind !== 'alert'
      ? 'bg-red-500/15 text-red-400'
      : 'bg-[var(--fa-accent-soft)] text-[var(--fa-accent)]'

  const handleConfirm = () => {
    if (dialog.kind === 'prompt') {
      const trimmed = value.trim()
      onResolve(trimmed || null)
      return
    }
    onResolve(true)
  }

  const handleCancel = () => {
    onResolve(dialog.kind === 'prompt' ? null : false)
  }

  const confirmLabel =
    dialog.confirmLabel ??
    (dialog.kind === 'alert' ? '知道了' : dialog.kind === 'prompt' ? '确定' : '确定')
  const cancelLabel = dialog.cancelLabel ?? '取消'

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px] no-drag animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-dialog-title"
      onClick={handleCancel}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-[var(--fa-border)] bg-[var(--fa-sidebar)] shadow-2xl animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--fa-border-subtle)] px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconClass}`}
            >
              <Icon size={20} strokeWidth={2} />
            </div>
            <div className="min-w-0 pt-0.5">
              <h3 id="app-dialog-title" className="text-base font-semibold text-[var(--fa-text)]">
                {dialog.title}
              </h3>
              {dialog.message && (
                <p className="mt-2 text-sm leading-relaxed text-[var(--fa-muted)]">{dialog.message}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="cursor-pointer rounded-lg p-1.5 text-[var(--fa-muted)] transition-colors hover:bg-[var(--fa-surface-hover)] hover:text-[var(--fa-text)]"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        {dialog.kind === 'prompt' && (
          <div className="px-5 pb-1 pt-3">
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirm()
                if (e.key === 'Escape') handleCancel()
              }}
              placeholder={dialog.placeholder}
              className="fa-input"
              aria-label={dialog.title}
            />
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-[var(--fa-border-subtle)] bg-[var(--fa-surface)]/40 px-4 py-3">
          {dialog.kind !== 'alert' && (
            <button type="button" onClick={handleCancel} className="fa-btn-ghost px-4 py-2 text-sm">
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            onClick={handleConfirm}
            className={
              danger && dialog.kind === 'confirm'
                ? 'cursor-pointer rounded-xl bg-[var(--fa-danger)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90'
                : 'fa-btn-primary px-4 py-2 text-sm'
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export const AppDialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const resolverRef = useRef<((value: boolean | string | null) => void) | null>(null)

  const openDialog = useCallback((req: DialogRequest) => {
    return new Promise<boolean | string | null>((resolve) => {
      resolverRef.current = resolve
      setDialog({ ...req, open: true })
    })
  }, [])

  const handleResolve = useCallback((value: boolean | string | null) => {
    resolverRef.current?.(value)
    resolverRef.current = null
    setDialog(null)
  }, [])

  const confirm = useCallback(
    (options: Omit<ConfirmOptions, 'kind'>) =>
      openDialog({ kind: 'confirm', ...options }).then((v) => Boolean(v)),
    [openDialog]
  )

  const alert = useCallback(
    async (options: Omit<AlertOptions, 'kind'>) => {
      await openDialog({ kind: 'alert', danger: false, ...options })
    },
    [openDialog]
  )

  const prompt = useCallback(
    (options: Omit<PromptOptions, 'kind'>) =>
      openDialog({ kind: 'prompt', danger: false, ...options }).then((v) =>
        typeof v === 'string' ? v : null
      ),
    [openDialog]
  )

  const value = useMemo(() => ({ confirm, alert, prompt }), [confirm, alert, prompt])

  return (
    <AppDialogContext.Provider value={value}>
      {children}
      <AppDialogHost dialog={dialog} onResolve={handleResolve} />
    </AppDialogContext.Provider>
  )
}

export function useAppDialog(): AppDialogContextValue {
  const ctx = useContext(AppDialogContext)
  if (!ctx) throw new Error('useAppDialog must be used within AppDialogProvider')
  return ctx
}
