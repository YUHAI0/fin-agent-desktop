export interface MaLevel {
  label: string
  value: number
}

export interface MaLadderData {
  currentPrice: number
  headline?: string
  resistance: MaLevel[]
  support: MaLevel[]
}

const MA_VALUE_RE = /(MA\d+|EMA\d+|BOLL[^\s、,，]*)\s*[（(]?\s*[~≈]?\s*([\d.]+)\s*[）)]?/gi
const TREE_LINE_RE = /^[\s│┃]*[├└└──│├┤┬┴┼]+/

function parseMaLevels(line: string): MaLevel[] {
  const levels: MaLevel[] = []
  let m: RegExpExecArray | null
  const re = new RegExp(MA_VALUE_RE.source, 'gi')
  while ((m = re.exec(line)) !== null) {
    const label = m[1].trim()
    const value = Number.parseFloat(m[2])
    if (!Number.isFinite(value)) continue
    levels.push({ label, value })
  }
  return levels
}

/** 识别 LLM 输出的「现价 + ├──上方压力 / └──下方支撑」ASCII 阶梯文本 */
export function parseMaLadder(text: string): MaLadderData | null {
  const raw = text.trim()
  if (!raw || (!raw.includes('├──') && !raw.includes('└──') && !raw.includes('现价'))) {
    return null
  }

  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return null

  let currentPrice: number | null = null
  let headline: string | undefined
  const resistance: MaLevel[] = []
  const support: MaLevel[] = []

  for (const line of lines) {
    const priceMatch = line.match(/现价\s*([\d.]+)/)
    if (priceMatch) {
      currentPrice = Number.parseFloat(priceMatch[1])
      headline = line.replace(TREE_LINE_RE, '').trim()
      continue
    }

    const cleaned = line.replace(TREE_LINE_RE, '').trim()
    if (/上方|压力|阻力/.test(cleaned)) {
      resistance.push(...parseMaLevels(cleaned))
      continue
    }
    if (/下方|支撑/.test(cleaned)) {
      support.push(...parseMaLevels(cleaned))
    }
  }

  if (currentPrice == null || !Number.isFinite(currentPrice)) return null
  if (resistance.length === 0 && support.length === 0) return null

  return {
    currentPrice,
    headline,
    resistance: resistance.sort((a, b) => b.value - a.value),
    support: support.sort((a, b) => b.value - a.value)
  }
}
