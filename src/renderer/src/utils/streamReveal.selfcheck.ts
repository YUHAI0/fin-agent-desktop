import { takeCodePoints, CHARS_PER_SECOND, MAX_CHARS_PER_FRAME } from './streamReveal'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg)
}

const a = takeCodePoints('你好世界', 2)
assert(a.taken === '你好' && a.rest === '世界', 'takeCodePoints CJK')

const b = takeCodePoints('hi👍!', 3)
assert(Array.from(b.taken).length === 3 && b.rest === '!', 'takeCodePoints emoji')

assert(CHARS_PER_SECOND === 24, 'rate')
assert(MAX_CHARS_PER_FRAME === 6, 'frame cap')

console.log('streamReveal.selfcheck: OK')
