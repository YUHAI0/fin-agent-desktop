import {
  StreamRevealController,
  takeCodePoints,
  CHARS_PER_SECOND,
  MAX_CHARS_PER_FRAME,
} from './streamReveal'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg)
}

const a = takeCodePoints('你好世界', 2)
assert(a.taken === '你好' && a.rest === '世界', 'takeCodePoints CJK')

const b = takeCodePoints('hi👍!', 3)
assert(Array.from(b.taken).length === 3 && b.rest === '!', 'takeCodePoints emoji')

assert(CHARS_PER_SECOND === 24, 'rate')
assert(MAX_CHARS_PER_FRAME === 6, 'frame cap')

// enqueue after markEnded must reset ended so settle does not fire early
let pendingRaf: ((ts: number) => void) | null = null
;(globalThis as typeof globalThis & {
  requestAnimationFrame?: (cb: (ts: number) => void) => number
  cancelAnimationFrame?: (id: number) => void
}).requestAnimationFrame = (cb) => {
  pendingRaf = cb
  return 1
}
;(globalThis as typeof globalThis & { cancelAnimationFrame?: (id: number) => void })
  .cancelAnimationFrame = () => {
  pendingRaf = null
}

function runFrame(ts: number): void {
  const cb = pendingRaf
  pendingRaf = null
  cb?.(ts)
}

let settled = 0
const ctrl = new StreamRevealController({
  onReveal: () => {},
  onSettled: () => {
    settled += 1
  },
})

ctrl.enqueue('s1', 'text', 'ab')
runFrame(0)
runFrame(100)
ctrl.markEnded('s1')
runFrame(200)
assert(settled === 1, 'settled once after markEnded')

ctrl.enqueue('s1', 'text', 'cd')
runFrame(300)
assert(settled === 1, 'enqueue after ended must not settle until markEnded')

ctrl.markEnded('s1')
runFrame(400)
assert(settled === 2, 'settled again after second markEnded')

console.log('streamReveal.selfcheck: OK')
