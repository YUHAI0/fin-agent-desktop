export const CHARS_PER_SECOND = 24
export const MAX_CHARS_PER_FRAME = 6

export type RevealKind = 'text' | 'thinking'

export type RevealHandlers = {
  onReveal: (sessionKey: string, kind: RevealKind, chunk: string) => void
  /** 队列空且已 markEnded 时调用一次 */
  onSettled?: (sessionKey: string) => void
}

type QueueItem = { kind: RevealKind; text: string }

type SessionState = {
  queue: QueueItem[]
  ended: boolean
  settled: boolean
  rafId: number | null
  lastTs: number | null
  carryMs: number
}

export function takeCodePoints(s: string, n: number): { taken: string; rest: string } {
  if (n <= 0 || !s) return { taken: '', rest: s }
  const chars = Array.from(s)
  if (n >= chars.length) return { taken: s, rest: '' }
  return { taken: chars.slice(0, n).join(''), rest: chars.slice(n).join('') }
}

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
  } catch {
    return false
  }
}

export class StreamRevealController {
  private sessions = new Map<string, SessionState>()
  private handlers: RevealHandlers

  constructor(handlers: RevealHandlers) {
    this.handlers = handlers
  }

  private ensure(sessionKey: string): SessionState {
    let s = this.sessions.get(sessionKey)
    if (!s) {
      s = { queue: [], ended: false, settled: false, rafId: null, lastTs: null, carryMs: 0 }
      this.sessions.set(sessionKey, s)
    }
    return s
  }

  enqueue(sessionKey: string, kind: RevealKind, text: string): void {
    if (!text) return
    if (prefersReducedMotion()) {
      this.handlers.onReveal(sessionKey, kind, text)
      return
    }
    const s = this.ensure(sessionKey)
    s.settled = false
    const last = s.queue[s.queue.length - 1]
    if (last && last.kind === kind) {
      last.text += text
    } else {
      s.queue.push({ kind, text })
    }
    this.kick(sessionKey)
  }

  markEnded(sessionKey: string): void {
    const s = this.ensure(sessionKey)
    s.ended = true
    if (prefersReducedMotion() || s.queue.length === 0) {
      this.settle(sessionKey)
      return
    }
    this.kick(sessionKey)
  }

  flush(sessionKey: string): void {
    const s = this.sessions.get(sessionKey)
    if (!s) return
    this.cancelRaf(s)
    while (s.queue.length) {
      const item = s.queue.shift()!
      if (item.text) this.handlers.onReveal(sessionKey, item.kind, item.text)
    }
    s.ended = true
    this.settle(sessionKey)
  }

  isRevealing(sessionKey: string): boolean {
    const s = this.sessions.get(sessionKey)
    if (!s) return false
    return s.queue.length > 0 || (s.rafId != null && !s.settled)
  }

  dispose(sessionKey: string): void {
    const s = this.sessions.get(sessionKey)
    if (!s) return
    this.cancelRaf(s)
    this.sessions.delete(sessionKey)
  }

  disposeAll(): void {
    for (const key of [...this.sessions.keys()]) this.dispose(key)
  }

  private settle(sessionKey: string): void {
    const s = this.sessions.get(sessionKey)
    if (!s || s.settled) return
    if (s.queue.length > 0) return
    s.settled = true
    this.cancelRaf(s)
    this.handlers.onSettled?.(sessionKey)
  }

  private cancelRaf(s: SessionState): void {
    if (s.rafId != null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(s.rafId)
    }
    s.rafId = null
    s.lastTs = null
  }

  private kick(sessionKey: string): void {
    const s = this.sessions.get(sessionKey)
    if (!s || s.rafId != null) return
    if (typeof requestAnimationFrame === 'undefined') {
      // 无 rAF 环境：同步漏光（自检用）
      this.flush(sessionKey)
      return
    }
    const tick = (ts: number) => {
      const st = this.sessions.get(sessionKey)
      if (!st) return
      st.rafId = null
      if (st.lastTs == null) st.lastTs = ts
      const dt = ts - st.lastTs
      st.lastTs = ts
      st.carryMs += dt

      const msPerChar = 1000 / CHARS_PER_SECOND
      let budget = Math.floor(st.carryMs / msPerChar)
      if (budget <= 0) {
        if (st.queue.length > 0 || !st.ended) {
          st.rafId = requestAnimationFrame(tick)
        } else {
          this.settle(sessionKey)
        }
        return
      }
      st.carryMs -= budget * msPerChar
      budget = Math.min(budget, MAX_CHARS_PER_FRAME)

      while (budget > 0 && st.queue.length > 0) {
        const head = st.queue[0]
        const { taken, rest } = takeCodePoints(head.text, budget)
        if (!taken) break
        budget -= Array.from(taken).length
        head.text = rest
        if (!head.text) st.queue.shift()
        this.handlers.onReveal(sessionKey, head.kind, taken)
      }

      if (st.queue.length > 0 || !st.ended) {
        st.rafId = requestAnimationFrame(tick)
      } else {
        this.settle(sessionKey)
      }
    }
    s.rafId = requestAnimationFrame(tick)
  }
}
