export type CapitalRange =
  | 'under_5w'
  | '5_20w'
  | '20_50w'
  | '50_100w'
  | 'over_100w'
  | 'undisclosed'

export const CAPITAL_RANGE_OPTIONS: { value: CapitalRange; label: string }[] = [
  { value: 'under_5w', label: '5 万以下' },
  { value: '5_20w', label: '5–20 万' },
  { value: '20_50w', label: '20–50 万' },
  { value: '50_100w', label: '50–100 万' },
  { value: 'over_100w', label: '100 万以上' },
  { value: 'undisclosed', label: '暂不透露' }
]

export const SECTOR_PRESETS = [
  '新能源',
  '半导体',
  '消费',
  '医药',
  '金融',
  '军工',
  '周期',
  '科技',
  '红利',
  '大盘蓝筹'
] as const

export function parseSectorList(raw: string): string[] {
  return raw
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function mergeSectors(selected: string[], extraRaw: string): string[] {
  const extra = parseSectorList(extraRaw)
  const out: string[] = []
  for (const name of [...selected, ...extra]) {
    if (!out.includes(name)) out.push(name)
  }
  return out
}
