/** 新闻中心共享的展示文案、来源/类型映射与板块预设 */

export const NEWS_SOURCE_LABELS: Record<NewsSource, string> = {
  stock_info_global_cls: '财联社电报',
  stock_info_global_em: '东方财富全球快讯',
  stock_news_em: '个股新闻（东方财富）'
}

export const NEWS_TYPE_LABELS: Record<NewsSubscriptionType, string> = {
  sector: '板块',
  topic: '主题',
  portfolio: '组合'
}

/** sector / topic 订阅只允许全局资讯源，避免误配需要个股上下文的 stock_news_em */
export const SECTOR_TOPIC_SOURCES: NewsSource[] = ['stock_info_global_cls', 'stock_info_global_em']

/** portfolio 订阅额外允许个股新闻，用于覆盖持仓相关的公司公告与新闻 */
export const PORTFOLIO_SOURCES: NewsSource[] = [
  'stock_info_global_cls',
  'stock_info_global_em',
  'stock_news_em'
]

export function sourceOptionsForType(type: NewsSubscriptionType): { value: NewsSource; label: string }[] {
  const list = type === 'portfolio' ? PORTFOLIO_SOURCES : SECTOR_TOPIC_SOURCES
  return list.map((value) => ({ value, label: NEWS_SOURCE_LABELS[value] }))
}

export function defaultSourcesForType(type: NewsSubscriptionType): NewsSource[] {
  return type === 'portfolio' ? [...PORTFOLIO_SOURCES] : [...SECTOR_TOPIC_SOURCES]
}

/**
 * 编辑历史订阅时，来源可能包含当前类型已不再适用的值（例如历史数据把
 * stock_news_em 错误地写入 sector/topic 订阅）。这里按类型交集归一化，
 * 过滤掉不适用的来源；若过滤后为空则回退到该类型默认来源，避免出现
 * 一个来源都未选中的非法状态。
 */
export function normalizeSourcesForType(
  type: NewsSubscriptionType,
  sources: NewsSource[] | undefined
): NewsSource[] {
  const allowed = defaultSourcesForType(type)
  const allowedSet = new Set(allowed)
  const filtered = (sources ?? []).filter((s) => allowedSet.has(s))
  return filtered.length > 0 ? filtered : allowed
}

export interface SectorPreset {
  key: string
  label: string
  keywords: string[]
}

/** 常见 A 股板块预设：选中后自动填充名称与关键词，用户仍可继续增删关键词 */
export const SECTOR_PRESETS: SectorPreset[] = [
  { key: 'semiconductor', label: '半导体 / 芯片', keywords: ['半导体', '芯片', '集成电路'] },
  { key: 'ai', label: '人工智能', keywords: ['人工智能', 'AI', '大模型'] },
  { key: 'nev', label: '新能源汽车', keywords: ['新能源汽车', '新能源车', '锂电池', '动力电池'] },
  { key: 'solar', label: '光伏', keywords: ['光伏', '太阳能'] },
  { key: 'pharma', label: '医药生物', keywords: ['医药', '生物医药', '创新药'] },
  { key: 'liquor', label: '白酒 / 食品饮料', keywords: ['白酒', '食品饮料'] },
  { key: 'bank', label: '银行', keywords: ['银行'] },
  { key: 'securities', label: '证券', keywords: ['券商', '证券'] },
  { key: 'insurance', label: '保险', keywords: ['保险'] },
  { key: 'realestate', label: '房地产', keywords: ['房地产', '地产'] },
  { key: 'defense', label: '军工', keywords: ['军工', '国防'] },
  { key: 'metals', label: '有色金属', keywords: ['有色金属', '稀土', '锂矿'] },
  { key: 'coal', label: '煤炭', keywords: ['煤炭'] },
  { key: 'power', label: '电力', keywords: ['电力', '电网'] },
  { key: 'electronics', label: '消费电子', keywords: ['消费电子', '果链'] },
  { key: 'media', label: '传媒 / 游戏', keywords: ['传媒', '游戏', '影视'] },
  { key: 'agriculture', label: '农业', keywords: ['农业', '种业', '猪肉'] },
  { key: 'chemical', label: '化工', keywords: ['化工'] },
  { key: 'steel', label: '钢铁', keywords: ['钢铁'] },
  { key: 'construction', label: '建筑建材', keywords: ['建筑', '建材', '水泥'] }
]

/** 编辑已有订阅时，尽力反查匹配的预设，命中则回填选择框，否则视为自定义 */
export function findPresetKeyByKeywords(keywords: string[] | undefined): string {
  if (!keywords || keywords.length === 0) return 'custom'
  const normalized = [...keywords].sort().join('\u0001')
  const preset = SECTOR_PRESETS.find((p) => [...p.keywords].sort().join('\u0001') === normalized)
  return preset?.key ?? 'custom'
}

export function formatNewsTime(value: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}
