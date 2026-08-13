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
