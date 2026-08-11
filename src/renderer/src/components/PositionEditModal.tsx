import React, { useEffect, useState } from 'react'

interface PositionEditModalProps {
  open: boolean
  mode: 'create' | 'edit'
  portfolioId?: string
  initial?: PortfolioPosition
  onClose: () => void
  onSaved: () => void
}

const PositionEditModal: React.FC<PositionEditModalProps> = ({
  open,
  mode,
  portfolioId,
  initial,
  onClose,
  onSaved
}) => {
  const [tsCode, setTsCode] = useState('')
  const [amount, setAmount] = useState('')
  const [cost, setCost] = useState('')
  const [boughtAt, setBoughtAt] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setTsCode(initial?.ts_code ?? '')
    setAmount(initial ? String(initial.amount) : '')
    setCost(initial ? String(initial.cost) : '')
    setBoughtAt(initial?.bought_at ?? '')
    setNote(initial?.note ?? '')
    setError('')
    setSaving(false)
  }, [open, initial])

  if (!open) return null

  const handleSave = async () => {
    const amountNum = Number(amount)
    const costNum = Number(cost)
    if (!tsCode.trim()) return setError('请填写股票代码')
    if (!Number.isFinite(amountNum) || amountNum <= 0) return setError('数量必须为正数')
    if (!Number.isFinite(costNum) || costNum <= 0) return setError('成本必须为正数')

    setSaving(true)
    setError('')
    const payload: PositionPayload = {
      id: portfolioId,
      ts_code: tsCode.trim().toUpperCase(),
      amount: amountNum,
      cost: costNum,
      bought_at: boughtAt,
      note
    }
    const res = mode === 'create' ? await window.api.addPosition(payload) : await window.api.updatePosition(payload)
    setSaving(false)

    if (!res.success) {
      setError(res.error || '保存失败')
      return
    }
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        className="relative w-full max-w-[380px] rounded-2xl border border-[var(--fa-border)] bg-[var(--fa-sidebar)] p-5 shadow-2xl animate-scale-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="position-edit-title"
      >
        <h3 id="position-edit-title" className="mb-4 text-sm font-semibold text-[var(--fa-text)]">
          {mode === 'create' ? '添加持仓' : '编辑持仓'}
        </h3>

        <div className="space-y-3">
          <div>
            <label className="fa-hint mb-1 block">股票代码</label>
            <input
              value={tsCode}
              disabled={mode === 'edit'}
              onChange={(e) => setTsCode(e.target.value)}
              placeholder="例如 600519.SH"
              className="fa-input"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="fa-hint mb-1 block">数量（股）</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="fa-input"
              />
            </div>
            <div className="flex-1">
              <label className="fa-hint mb-1 block">成本价</label>
              <input
                type="number"
                step="0.01"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                className="fa-input"
              />
            </div>
          </div>
          <div>
            <label className="fa-hint mb-1 block">买入日期（可选）</label>
            <input
              type="date"
              value={boughtAt}
              onChange={(e) => setBoughtAt(e.target.value)}
              className="fa-input"
            />
          </div>
          <div>
            <label className="fa-hint mb-1 block">备注（可选）</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="fa-input"
            />
          </div>
        </div>

        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="fa-btn-ghost px-3 py-1.5 text-sm">
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="fa-btn-primary px-3 py-1.5 text-sm"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default PositionEditModal
