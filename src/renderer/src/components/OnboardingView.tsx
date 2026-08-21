import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import SubPageShell from './SubPageShell'
import {
  CAPITAL_RANGE_OPTIONS,
  SECTOR_PRESETS,
  mergeSectors,
  type CapitalRange
} from '../utils/profileFields'

const STEP_SUBTITLES = [
  '你的投资经验如何？',
  '你更能接受哪种风险？',
  '资金打算放多久？',
  '关注哪些板块？有没有想回避的？',
  '可投资金额大概在哪个区间？'
] as const

const EXPERIENCE_OPTIONS = [
  { value: 'beginner' as const, label: '新手' },
  { value: 'experienced' as const, label: '老手' }
]

const RISK_OPTIONS = [
  { value: 'Conservative' as const, label: '保守' },
  { value: 'Balanced' as const, label: '平衡' },
  { value: 'Aggressive' as const, label: '进取' }
]

const HORIZON_OPTIONS = [
  { value: 'Short-term' as const, label: '短期' },
  { value: 'Medium-term' as const, label: '中期' },
  { value: 'Long-term' as const, label: '长期' }
]

function toggleSector(list: string[], name: string): string[] {
  return list.includes(name) ? list.filter((item) => item !== name) : [...list, name]
}

const OnboardingView: React.FC = () => {
  const navigate = useNavigate()
  const [step, setStep] = useState(0) // 0..4
  const [experienceLevel, setExperienceLevel] = useState<'' | 'beginner' | 'experienced'>('')
  const [riskTolerance, setRiskTolerance] = useState<'' | 'Conservative' | 'Balanced' | 'Aggressive'>(
    ''
  )
  const [investmentHorizon, setInvestmentHorizon] = useState<
    '' | 'Short-term' | 'Medium-term' | 'Long-term'
  >('')
  const [favoriteSelected, setFavoriteSelected] = useState<string[]>([])
  const [avoidSelected, setAvoidSelected] = useState<string[]>([])
  const [favoriteExtra, setFavoriteExtra] = useState('')
  const [avoidExtra, setAvoidExtra] = useState('')
  const [capitalRange, setCapitalRange] = useState<CapitalRange | ''>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const canNext =
    (step === 0 && experienceLevel !== '') ||
    (step === 1 && riskTolerance !== '') ||
    (step === 2 && investmentHorizon !== '') ||
    (step === 3 && mergeSectors(favoriteSelected, favoriteExtra).length >= 1) ||
    (step === 4 && capitalRange !== '')

  function buildPayload(mode: 'skip' | 'complete'): Record<string, unknown> {
    const data: Record<string, unknown> = {}
    if (experienceLevel) data.experience_level = experienceLevel
    if (riskTolerance) data.risk_tolerance = riskTolerance
    if (investmentHorizon) data.investment_horizon = investmentHorizon
    const fav = mergeSectors(favoriteSelected, favoriteExtra)
    const avd = mergeSectors(avoidSelected, avoidExtra)
    if (mode === 'complete' || fav.length) data.favorite_sectors = fav
    if (mode === 'complete' || avd.length) data.avoid_sectors = avd
    if (capitalRange) data.capital_range = capitalRange
    return data
  }

  function hasDraft(): boolean {
    return Object.keys(buildPayload('skip')).length > 0
  }

  async function saveProfileWithRetry(data: Record<string, unknown>): Promise<{
    success: boolean
    error?: string
  }> {
    const delays = [0, 400, 800, 1200, 1600, 2000, 2000, 2000]
    let lastError = '保存失败'
    for (const wait of delays) {
      if (wait) await new Promise((r) => setTimeout(r, wait))
      try {
        const result = await window.api.saveProfile(data)
        if (result?.success) return { success: true }
        lastError = result?.error || lastError
      } catch (e: any) {
        lastError = e?.message || lastError
      }
    }
    return { success: false, error: lastError }
  }

  async function handleSkip() {
    setBusy(true)
    setError('')
    try {
      await window.api.skipOnboarding()
      if (hasDraft()) {
        await saveProfileWithRetry(buildPayload('skip')) // 失败忽略
      }
      navigate('/chat')
    } catch (e: any) {
      setError(e?.message || '无法跳过，请重试')
      setBusy(false)
    }
  }

  async function handleComplete() {
    if (capitalRange === '' || !canNext) return
    setBusy(true)
    setError('')
    const result = await saveProfileWithRetry(buildPayload('complete'))
    if (!result.success) {
      setError(result.error || '画像保存失败，请重试')
      setBusy(false)
      return
    }
    try {
      const done = await window.api.completeOnboarding()
      if (!done?.success) {
        setError('无法标记完成，请重试')
        setBusy(false)
        return
      }
      navigate('/chat')
    } catch (e: any) {
      setError(e?.message || '无法标记完成，请重试')
      setBusy(false)
    }
  }

  return (
    <SubPageShell>
      <div className="fa-page-header shrink-0">
        <h1 className="text-sm font-semibold">先认识一下你</h1>
        <button
          type="button"
          className="ml-auto cursor-pointer rounded-lg px-3 py-1.5 text-sm text-[var(--fa-muted)] transition-colors duration-200 hover:bg-[var(--fa-surface-hover)] hover:text-[var(--fa-text)] disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => void handleSkip()}
          disabled={busy}
        >
          跳过
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-md px-6 py-10">
          <div className="fa-onboarding-progress">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} data-done={i <= step} />
            ))}
          </div>

          <p className="mb-6 text-base font-medium">{STEP_SUBTITLES[step]}</p>

          {step === 0 && (
            <div className="fa-onboarding-choices">
              {EXPERIENCE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className="fa-onboarding-choice"
                  data-active={experienceLevel === opt.value}
                  onClick={() => setExperienceLevel(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {step === 1 && (
            <div className="fa-onboarding-choices">
              {RISK_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className="fa-onboarding-choice"
                  data-active={riskTolerance === opt.value}
                  onClick={() => setRiskTolerance(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {step === 2 && (
            <div className="fa-onboarding-choices">
              {HORIZON_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className="fa-onboarding-choice"
                  data-active={investmentHorizon === opt.value}
                  onClick={() => setInvestmentHorizon(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div>
                <p className="mb-2 text-sm font-medium">关注</p>
                <div className="fa-onboarding-chips">
                  {SECTOR_PRESETS.map((name) => (
                    <button
                      key={`fav-${name}`}
                      type="button"
                      className="fa-onboarding-chip"
                      data-active={favoriteSelected.includes(name)}
                      onClick={() => setFavoriteSelected((prev) => toggleSector(prev, name))}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <input
                  className="fa-input mt-3"
                  value={favoriteExtra}
                  onChange={(e) => setFavoriteExtra(e.target.value)}
                  placeholder="其他，逗号分隔"
                />
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">回避</p>
                <div className="fa-onboarding-chips">
                  {SECTOR_PRESETS.map((name) => (
                    <button
                      key={`avd-${name}`}
                      type="button"
                      className="fa-onboarding-chip"
                      data-active={avoidSelected.includes(name)}
                      onClick={() => setAvoidSelected((prev) => toggleSector(prev, name))}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <input
                  className="fa-input mt-3"
                  value={avoidExtra}
                  onChange={(e) => setAvoidExtra(e.target.value)}
                  placeholder="其他，逗号分隔"
                />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="fa-onboarding-choices">
              {CAPITAL_RANGE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className="fa-onboarding-choice"
                  data-active={capitalRange === opt.value}
                  onClick={() => setCapitalRange(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}

          <div className="fa-onboarding-footer">
            {step > 0 ? (
              <button
                type="button"
                className="fa-btn-ghost"
                disabled={busy}
                onClick={() => {
                  setError('')
                  setStep((s) => s - 1)
                }}
              >
                上一步
              </button>
            ) : (
              <span />
            )}
            {step < 4 ? (
              <button
                type="button"
                className="fa-btn-primary"
                disabled={!canNext || busy}
                onClick={() => {
                  setError('')
                  setStep((s) => s + 1)
                }}
              >
                下一步
              </button>
            ) : (
              <button
                type="button"
                className="fa-btn-primary"
                disabled={!canNext || busy}
                onClick={() => void handleComplete()}
              >
                {busy ? '保存中…' : '开始使用'}
              </button>
            )}
          </div>
        </div>
      </div>
    </SubPageShell>
  )
}

export default OnboardingView
