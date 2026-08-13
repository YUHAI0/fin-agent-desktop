export type NewsHolding = { ts_code: string; name: string }

function sixDigitCode(tsCode: string): string {
  const base = tsCode.replace(/\..*$/, '').trim()
  return /^\d{6}$/.test(base) ? base : ''
}

/** 标题/正文命中持仓名称、六位代码或 ts_code（大小写不敏感）；返回匹配到的 ts_code。 */
export function matchNewsToHoldings(text: string, holdings: NewsHolding[]): string[] {
  if (!text || holdings.length === 0) return []
  const haystack = text.toLowerCase()
  const matched: string[] = []
  const seen = new Set<string>()

  for (const holding of holdings) {
    const tsCode = (holding.ts_code || '').trim()
    if (!tsCode || seen.has(tsCode)) continue

    const name = (holding.name || '').trim()
    const code6 = sixDigitCode(tsCode)
    const hit =
      (name !== '' && haystack.includes(name.toLowerCase())) ||
      (code6 !== '' && haystack.includes(code6.toLowerCase())) ||
      haystack.includes(tsCode.toLowerCase())

    if (hit) {
      seen.add(tsCode)
      matched.push(tsCode)
    }
  }

  return matched
}
