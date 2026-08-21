import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useAppDialog } from '../contexts/AppDialogContext'
import { CAPITAL_RANGE_OPTIONS, parseSectorList, type CapitalRange } from '../utils/profileFields'
import FaSelect from './FaSelect'
import SubPageShell from './SubPageShell'

type ExperienceLevel = 'beginner' | 'experienced' | 'Unknown'
type RiskTolerance = 'Conservative' | 'Balanced' | 'Aggressive' | 'Unknown'
type InvestmentHorizon = 'Short-term' | 'Medium-term' | 'Long-term' | 'Unknown'

const EXPERIENCE_OPTIONS: { value: ExperienceLevel; label: string }[] = [
  { value: 'Unknown', label: '未知' },
  { value: 'beginner', label: '新手' },
  { value: 'experienced', label: '老手' }
]

const RISK_OPTIONS: { value: RiskTolerance; label: string }[] = [
  { value: 'Unknown', label: '未知' },
  { value: 'Conservative', label: '保守' },
  { value: 'Balanced', label: '平衡' },
  { value: 'Aggressive', label: '进取' }
]

const HORIZON_OPTIONS: { value: InvestmentHorizon; label: string }[] = [
  { value: 'Unknown', label: '未知' },
  { value: 'Short-term', label: '短期' },
  { value: 'Medium-term', label: '中期' },
  { value: 'Long-term', label: '长期' }
]

const PROFILE_MISSING_LABELS: Record<string, string> = {
  experience_level: '经验等级',
  risk_tolerance: '风险偏好',
  investment_horizon: '投资周期',
  favorite_sectors: '关注板块'
}

function pickEnum<T extends string>(value: unknown, options: { value: T }[], fallback: T): T {
  return options.some((o) => o.value === value) ? (value as T) : fallback
}

function joinSectors(sectors: unknown): string {
  return Array.isArray(sectors) ? sectors.filter((s) => typeof s === 'string' && s.trim()).join('，') : ''
}

const ProfileView: React.FC = () => {
  const navigate = useNavigate()
  const { alert } = useAppDialog()
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>('Unknown')
  const [riskTolerance, setRiskTolerance] = useState<RiskTolerance>('Unknown')
  const [investmentHorizon, setInvestmentHorizon] = useState<InvestmentHorizon>('Unknown')
  const [capitalRange, setCapitalRange] = useState<CapitalRange | ''>('')
  const [favoriteSectors, setFavoriteSectors] = useState('')
  const [avoidSectors, setAvoidSectors] = useState('')
  const [investmentStyle, setInvestmentStyle] = useState('')
  const [completeness, setCompleteness] = useState<ProfileCompleteness>({ score: 0, missing: [] })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)

  const applyProfileResult = (profile?: UserProfile, nextCompleteness?: ProfileCompleteness) => {
    if (profile) {
      setExperienceLevel(pickEnum(profile.experience_level, EXPERIENCE_OPTIONS, 'Unknown'))
      setRiskTolerance(pickEnum(profile.risk_tolerance, RISK_OPTIONS, 'Unknown'))
      setInvestmentHorizon(pickEnum(profile.investment_horizon, HORIZON_OPTIONS, 'Unknown'))
      const capital = profile.capital_range
      setCapitalRange(
        CAPITAL_RANGE_OPTIONS.some((o) => o.value === capital) ? (capital as CapitalRange) : ''
      )
      setFavoriteSectors(joinSectors(profile.favorite_sectors))
      setAvoidSectors(joinSectors(profile.avoid_sectors))
      setInvestmentStyle(profile.investment_style || '')
    }
    if (nextCompleteness) {
      setCompleteness({
        score: Number(nextCompleteness.score) || 0,
        missing: Array.isArray(nextCompleteness.missing) ? nextCompleteness.missing : []
      })
    }
  }

  const loadProfile = async () => {
    try {
      const result = await window.api.getProfile()
      const profile = result?.profile
      if (!profile) {
        setReady(false)
        setError('加载投资画像失败，请重试后再保存，以免覆盖现有画像')
        return
      }
      applyProfileResult(profile, result.completeness)
      setReady(true)
      setError('')
    } catch (err: any) {
      console.error('Failed to load profile:', err)
      setReady(false)
      setError(err?.message || '加载投资画像失败，请重试后再保存，以免覆盖现有画像')
    }
  }

  useEffect(() => {
    void loadProfile()
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ready) return
    setSaving(true)
    setError('')
    try {
      const data: Record<string, unknown> = {
        experience_level: experienceLevel,
        risk_tolerance: riskTolerance,
        investment_horizon: investmentHorizon,
        capital_range: capitalRange === '' ? null : capitalRange,
        favorite_sectors: parseSectorList(favoriteSectors),
        avoid_sectors: parseSectorList(avoidSectors)
      }
      const style = investmentStyle.trim()
      if (style) {
        data.investment_style = style
      }
      const result = await window.api.saveProfile(data)
      if (result.success) {
        applyProfileResult(result.profile, result.completeness)
        await alert({ title: '画像已保存' })
      } else {
        setError(result.error || '保存画像失败')
      }
    } catch (err: any) {
      setError(err.message || '保存画像失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SubPageShell>
      <div className="fa-titlebar flex shrink-0 items-center gap-3 px-4">
        <button
          type="button"
          onClick={() => navigate('/chat')}
          className="fa-icon-btn"
          title="返回"
          aria-label="返回"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="text-sm font-semibold">投资画像</div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl p-8">
          <p className="mb-6 text-sm text-[var(--fa-muted)]">
            完善画像可让顾问按你的经验与风险偏好给出更贴合的建议。
          </p>

          <form onSubmit={handleSave} className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <h3 className="text-base font-medium text-[var(--fa-text)]">个人偏好</h3>
              <p className="text-sm text-[var(--fa-text)]">完整度 {completeness.score}%</p>
            </div>
            {completeness.missing.length > 0 && (
              <p className="fa-hint">
                待完善：
                {completeness.missing.map((key) => PROFILE_MISSING_LABELS[key] || key).join('、')}
              </p>
            )}
            {completeness.score < 100 && (
              <p className="fa-hint">完善画像可获得更精准建议</p>
            )}

            {error && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-red-300">
                <p>{error}</p>
                {!ready && (
                  <button type="button" className="fa-btn-ghost mt-2" onClick={() => void loadProfile()}>
                    重新加载
                  </button>
                )}
              </div>
            )}

            <div className="space-y-2">
              <label className="fa-label">经验等级</label>
              <FaSelect
                value={experienceLevel}
                aria-label="经验等级"
                onChange={(v) => setExperienceLevel(v as ExperienceLevel)}
                options={EXPERIENCE_OPTIONS}
              />
            </div>

            <div className="space-y-2">
              <label className="fa-label">风险偏好</label>
              <FaSelect
                value={riskTolerance}
                aria-label="风险偏好"
                onChange={(v) => setRiskTolerance(v as RiskTolerance)}
                options={RISK_OPTIONS}
              />
            </div>

            <div className="space-y-2">
              <label className="fa-label">投资周期</label>
              <FaSelect
                value={investmentHorizon}
                aria-label="投资周期"
                onChange={(v) => setInvestmentHorizon(v as InvestmentHorizon)}
                options={HORIZON_OPTIONS}
              />
            </div>

            <div className="space-y-2">
              <label className="fa-label">可投资金额</label>
              <FaSelect
                value={capitalRange}
                aria-label="可投资金额"
                onChange={(v) => setCapitalRange(v as CapitalRange | '')}
                options={[{ value: '', label: '未设置' }, ...CAPITAL_RANGE_OPTIONS]}
              />
            </div>

            <div className="space-y-2">
              <label className="fa-label">关注板块</label>
              <input
                type="text"
                value={favoriteSectors}
                onChange={(e) => setFavoriteSectors(e.target.value)}
                className="fa-input"
                placeholder="例如：新能源，半导体，消费"
              />
              <p className="fa-hint">多个板块用逗号分隔。</p>
            </div>

            <div className="space-y-2">
              <label className="fa-label">回避板块</label>
              <input
                type="text"
                value={avoidSectors}
                onChange={(e) => setAvoidSectors(e.target.value)}
                className="fa-input"
                placeholder="例如：地产，高杠杆"
              />
              <p className="fa-hint">多个板块用逗号分隔。</p>
            </div>

            <div className="space-y-2">
              <label className="fa-label">投资风格</label>
              <textarea
                value={investmentStyle}
                onChange={(e) => setInvestmentStyle(e.target.value)}
                className="fa-input min-h-[96px] resize-y"
                placeholder="例如：偏价值，喜欢高股息，单笔仓位不超过 10%"
                rows={3}
              />
            </div>

            <button
              type="submit"
              disabled={saving || !ready}
              className="fa-btn-primary w-full py-3"
            >
              {saving ? '保存中...' : ready ? '保存画像' : '画像未加载'}
            </button>
          </form>
        </div>
      </div>
    </SubPageShell>
  )
}

export default ProfileView
