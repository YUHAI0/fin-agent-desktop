import React, { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import FaSelect from '../FaSelect'
import TagInput from './TagInput'
import {
  SECTOR_PRESETS,
  WATCHLIST_GROUP_OPTIONS,
  defaultLiveSubscriptionName,
  defaultSourcesForType,
  findPresetKeyByKeywords,
  isLiveSymbolType,
  normalizeSourcesForType,
  sourceOptionsForType
} from '../../utils/news'

interface NewsSubscriptionDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  initial?: NewsSubscription
  onClose: () => void
  onSaved: (subscription: NewsSubscription) => void
}

const TYPE_OPTIONS: { value: NewsSubscriptionType; label: string; hint: string }[] = [
  { value: 'sector', label: '板块', hint: '按行业板块关键词匹配全局资讯' },
  { value: 'topic', label: '主题', hint: '自定义主题关键词，自由组合' },
  { value: 'portfolio', label: '组合', hint: '自动跟随全部持仓组合' },
  { value: 'watchlist', label: '自选', hint: '自动跟随所选分组的自选股' }
]

const NewsSubscriptionDialog: React.FC<NewsSubscriptionDialogProps> = ({
  open,
  mode,
  initial,
  onClose,
  onSaved
}) => {
  const [type, setType] = useState<NewsSubscriptionType>('sector')
  const [sectorPreset, setSectorPreset] = useState('custom')
  const [name, setName] = useState('')
  const [keywords, setKeywords] = useState<string[]>([])
  const [excludeKeywords, setExcludeKeywords] = useState<string[]>([])
  const [sources, setSources] = useState<NewsSource[]>([])
  const [groups, setGroups] = useState<WatchlistGroup[]>(['candidate', 'track'])
  const [enabled, setEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const t = initial?.type ?? 'sector'
    setType(t)
    setName(initial?.name ?? '')
    setKeywords(initial?.keywords ?? [])
    setExcludeKeywords(initial?.exclude_keywords ?? [])
    setSources(normalizeSourcesForType(t, initial?.sources))
    setGroups(
      t === 'watchlist' && initial?.groups && initial.groups.length > 0
        ? initial.groups
        : ['candidate', 'track']
    )
    setEnabled(initial?.enabled ?? true)
    setSectorPreset(t === 'sector' ? findPresetKeyByKeywords(initial?.keywords) : 'custom')
    setError('')
    setSaving(false)
    if (isLiveSymbolType(t)) return
    const timer = window.setTimeout(() => nameInputRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open, initial])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, saving, onClose])

  if (!open) return null

  const handleTypeChange = (next: NewsSubscriptionType) => {
    setType(next)
    setSources(defaultSourcesForType(next))
    if (next !== 'sector') setSectorPreset('custom')
    setGroups(['candidate', 'track'])
  }

  const handlePresetChange = (key: string) => {
    setSectorPreset(key)
    if (key === 'custom') return
    const preset = SECTOR_PRESETS.find((p) => p.key === key)
    if (preset) {
      setName(preset.label)
      setKeywords(preset.keywords)
    }
  }

  const toggleSource = (value: NewsSource) => {
    setSources((prev) => (prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]))
  }

  const toggleGroup = (value: WatchlistGroup) => {
    setGroups((prev) =>
      prev.includes(value) ? prev.filter((g) => g !== value) : [...prev, value]
    )
  }

  const availableSources = sourceOptionsForType(type)

  const handleSave = async () => {
    const trimmedName = (defaultLiveSubscriptionName(type) || name).trim()
    if (!trimmedName) {
      setError('请填写订阅名称')
      return
    }
    if (sources.length === 0) {
      setError('请至少选择一个新闻来源')
      return
    }
    if (type === 'watchlist' && groups.length === 0) {
      setError('请至少选择一个自选分组')
      return
    }
    if (!isLiveSymbolType(type) && keywords.length === 0) {
      setError('请至少添加一个关键词')
      return
    }

    setSaving(true)
    setError('')
    try {
      if (mode === 'create') {
        const payload: NewsSubscriptionInput = {
          type,
          name: trimmedName,
          enabled,
          keywords,
          exclude_keywords: excludeKeywords,
          sources,
          ...(type === 'watchlist' ? { groups } : {})
        }
        const res = await window.api.createNewsSubscription(payload)
        if (!res.success || !res.subscription) {
          setError(res.error || '创建失败')
          return
        }
        onSaved(res.subscription)
      } else if (initial) {
        const payload: NewsSubscriptionUpdate = {
          name: trimmedName,
          enabled,
          keywords,
          exclude_keywords: excludeKeywords,
          sources,
          ...(type === 'watchlist' ? { groups } : {})
        }
        const res = await window.api.updateNewsSubscription(initial.id, payload)
        if (!res.success || !res.subscription) {
          setError(res.error || '保存失败')
          return
        }
        onSaved(res.subscription)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px] no-drag animate-fade-in">
      <div className="absolute inset-0" onClick={saving ? undefined : onClose} aria-hidden />
      <div
        className="relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--fa-border)] bg-[var(--fa-sidebar)] shadow-2xl animate-scale-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="news-subscription-dialog-title"
      >
        <div className="shrink-0 border-b border-[var(--fa-border-subtle)] px-5 py-4">
          <h3 id="news-subscription-dialog-title" className="text-sm font-semibold text-[var(--fa-text)]">
            {mode === 'create' ? '新增订阅' : '编辑订阅'}
          </h3>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <div className="space-y-2">
            <label className="fa-label">订阅类型</label>
            <div className="grid grid-cols-2 gap-2">
              {TYPE_OPTIONS.map((opt) => {
                const active = type === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={mode === 'edit' || saving}
                    onClick={() => handleTypeChange(opt.value)}
                    title={opt.hint}
                    aria-pressed={active}
                    className={`cursor-pointer rounded-xl border px-2 py-2 text-sm transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${
                      active
                        ? 'border-[var(--fa-accent)] bg-[var(--fa-accent-soft)] text-[var(--fa-text)]'
                        : 'border-[var(--fa-border)] text-[var(--fa-muted)] hover:bg-[var(--fa-surface-hover)] hover:text-[var(--fa-text)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
            {mode === 'edit' && <p className="fa-hint">订阅类型创建后不可更改</p>}
          </div>

          {type === 'sector' && (
            <div className="space-y-2">
              <label className="fa-label">常见板块预设</label>
              <FaSelect
                value={sectorPreset}
                aria-label="常见板块预设"
                disabled={saving}
                onChange={handlePresetChange}
                options={[{ value: 'custom', label: '自定义' }, ...SECTOR_PRESETS.map((p) => ({ value: p.key, label: p.label }))]}
              />
              <p className="fa-hint">选择预设自动填充名称与关键词，之后仍可继续增删关键词</p>
            </div>
          )}

          {!isLiveSymbolType(type) && (
            <div className="space-y-2">
              <label className="fa-label" htmlFor="news-sub-name">
                订阅名称
              </label>
              <input
                ref={nameInputRef}
                id="news-sub-name"
                value={name}
                disabled={saving}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：半导体"
                className="fa-input"
              />
            </div>
          )}

          {type === 'portfolio' && (
            <div className="fa-card px-3 py-2.5 text-xs leading-relaxed text-[var(--fa-muted)]">
              自动跟随全部组合的当前持仓股票，无需手动选择股票代码；持仓变化后下一轮轮询自动生效。
            </div>
          )}

          {type === 'watchlist' && (
            <div className="space-y-2">
              <div className="fa-card px-3 py-2.5 text-xs leading-relaxed text-[var(--fa-muted)]">
                自动跟随所选分组的当前自选股票，无需手动选择代码；自选增删或改分组后下一轮轮询自动生效。
              </div>
              <label className="fa-label">跟随分组</label>
              <div className="flex flex-wrap gap-2">
                {WATCHLIST_GROUP_OPTIONS.map((opt) => {
                  const checked = groups.includes(opt.value)
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={saving}
                      data-checked={checked}
                      aria-pressed={checked}
                      onClick={() => toggleGroup(opt.value)}
                      className="fa-news-source-option disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {checked ? (
                        <Check size={14} className="text-[var(--fa-accent)]" />
                      ) : (
                        <span className="h-3.5 w-3.5 rounded-sm border border-current opacity-40" aria-hidden />
                      )}
                      {opt.label}
                    </button>
                  )
                })}
              </div>
              <p className="fa-hint">至少选择一组；可同时跟随候选买入和长期跟踪</p>
            </div>
          )}

          <TagInput
            label={isLiveSymbolType(type) ? '可选关键词过滤（同时满足才提醒）' : '包含关键词'}
            values={keywords}
            onChange={setKeywords}
            placeholder="输入关键词后按 Enter 添加"
            disabled={saving}
            hint={
              type === 'portfolio'
                ? '留空则命中持仓个股新闻即提醒'
                : type === 'watchlist'
                  ? '留空则命中所选自选个股新闻即提醒'
                  : '至少添加一个关键词，命中标题或摘要即视为匹配'
            }
          />

          <TagInput
            label="排除关键词（可选）"
            values={excludeKeywords}
            onChange={setExcludeKeywords}
            placeholder="命中则不会提醒"
            disabled={saving}
          />

          <div className="space-y-2">
            <label className="fa-label">新闻来源</label>
            <div className="flex flex-wrap gap-2">
              {availableSources.map((opt) => {
                const checked = sources.includes(opt.value)
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={saving}
                    data-checked={checked}
                    aria-pressed={checked}
                    onClick={() => toggleSource(opt.value)}
                    className="fa-news-source-option disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {checked ? (
                      <Check size={14} className="text-[var(--fa-accent)]" />
                    ) : (
                      <span className="h-3.5 w-3.5 rounded-sm border border-current opacity-40" aria-hidden />
                    )}
                    {opt.label}
                  </button>
                )
              })}
            </div>
            <p className="fa-hint">
              {isLiveSymbolType(type)
                ? type === 'watchlist'
                  ? '建议保留个股新闻，覆盖自选公司相关快讯与公告'
                  : '建议保留个股新闻，覆盖持仓公司相关快讯与公告'
                : '默认覆盖财联社电报与东方财富全球快讯'}
            </p>
          </div>

          <div className="flex items-center justify-between py-1">
            <label className="fa-label">启用订阅</label>
            <button
              type="button"
              onClick={() => setEnabled((v) => !v)}
              disabled={saving}
              aria-pressed={enabled}
              className={`relative inline-flex h-6 w-11 cursor-pointer items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                enabled ? 'fa-toggle-on' : 'fa-toggle-off'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {error && <p className="text-xs text-[var(--fa-danger)]">{error}</p>}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--fa-border-subtle)] bg-[var(--fa-surface)]/40 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="fa-btn-ghost px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="fa-btn-primary px-4 py-2 text-sm"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default NewsSubscriptionDialog
