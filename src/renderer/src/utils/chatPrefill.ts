import { matchNewsToHoldings, type NewsHolding } from './newsPortfolioMatch'
import { normalizeNewsUrl } from './news'

export function buildAnalyzeStockPrefill(tsCode: string, name?: string): string {
  const label = name ? `${name}（${tsCode}）` : tsCode
  return `请按「结论 → 依据 → 风险 → 下一步」结构，对 ${label} 做个股体检分析。`
}

export function buildPortfolioDiagnosePrefill(portfolioId: string, portfolioName?: string): string {
  const label = portfolioName ? `「${portfolioName}」` : ''
  return `请诊断当前组合${label}（id=${portfolioId}）：按结论→依据→风险→下一步给出健康度与调仓建议；先调用持仓工具获取真实数据。`
}

export function buildNewsImpactPrefill(title: string, body: string, relatedCodes: string[] = []): string {
  const codes = relatedCodes.length ? `相关标的：${relatedCodes.join('、')}。` : ''
  return `请分析以下新闻对我当前持仓的影响（结论→依据→风险→下一步）。${codes}\n标题：${title}\n内容：${body.slice(0, 800)}`
}

export function encodePrefillQuery(text: string): string {
  return encodeURIComponent(text)
}

export type NewsCardIntent = 'interpret' | 'portfolio_impact' | 'next_actions' | 'related_stocks'

export interface NewsCardSnapshot {
  id: string
  title: string
  summary: string
  url: string
  source: string
  published_at: string
  sentiment?: string | null
  matched_symbols: string[]
}

export interface NewsCardPayload {
  intent: NewsCardIntent
  news: NewsCardSnapshot
}

export const NEWS_CARD_INTENT_LABELS: Record<NewsCardIntent, string> = {
  interpret: '解读',
  portfolio_impact: '持仓影响',
  next_actions: '下一步',
  related_stocks: '相关个股'
}

export const NEWS_CARD_INTENT_PROMPTS: Record<NewsCardIntent, string> = {
  interpret: '请解读这条新闻',
  portfolio_impact: '请分析这条新闻对我当前持仓的影响',
  next_actions: '请根据这条新闻给出可执行的下一步',
  related_stocks: '请分析这条新闻涉及的相关个股'
}

export const NEWS_CARD_FIXED_MENU: { intent: NewsCardIntent; label: string }[] = [
  { intent: 'interpret', label: '解读这条新闻' },
  { intent: 'portfolio_impact', label: '对我持仓的影响' },
  { intent: 'next_actions', label: '接下来可以做什么' }
]

export function relatedSymbolsForNews(
  item: NotifiedNewsItem,
  holdings: NewsHolding[]
): string[] {
  const fromItem = item.matched_symbols || []
  const fromHoldings = matchNewsToHoldings(`${item.title}\n${item.summary || ''}`, holdings)
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of [...fromItem, ...fromHoldings]) {
    const value = (raw || '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

export function shouldShowRelatedStocksMenu(
  item: NotifiedNewsItem,
  holdings: NewsHolding[]
): boolean {
  return relatedSymbolsForNews(item, holdings).length > 0
}

export function buildNewsCardPayload(
  intent: NewsCardIntent,
  item: NotifiedNewsItem,
  holdings: NewsHolding[]
): NewsCardPayload | null {
  const title = (item.title || '').trim()
  if (!title) return null
  if (intent === 'related_stocks' && !shouldShowRelatedStocksMenu(item, holdings)) return null
  return {
    intent,
    news: {
      id: item.id,
      title,
      summary: item.summary || '',
      url: normalizeNewsUrl(item.url) || '',
      source: item.source,
      published_at: item.published_at || '',
      sentiment: item.sentiment || null,
      matched_symbols: relatedSymbolsForNews(item, holdings)
    }
  }
}
