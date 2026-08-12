/**
 * GitHub Release 下载镜像：默认 ghfast.top，并从 ghproxy.link 刷新最新发布站。
 * 缓存 24h；失败回退官方 GitHub。
 */
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import * as http from 'http'
import * as https from 'https'
import { URL } from 'url'

export const SEED_MIRROR_BASE = 'https://ghfast.top/'
export const PUBLISH_PAGE_URL = 'https://ghproxy.link/'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 8000
const PROBE_TIMEOUT_MS = 5000

const EXCLUDE_HOST_RE =
  /(umami|gtag|google|analytics|ioiox|cloudflare|favicon|twitter|facebook|redtea|iplc)/i
const PREFER_HOST_RE = /(ghfast|ghproxy|ghp\.|ghgo|github\.|gh\.|mirror\.gh)/i

interface MirrorCache {
  mirrorBase: string
  candidates: string[]
  fetchedAt: number
  source: string
}

interface MirrorConfig {
  enabled?: boolean
  mirrorBase?: string
}

type UserDataPathFn = () => string

let getUserDataPath: UserDataPathFn = () => ''

export function initUpdateMirror(userDataPath: string): void {
  getUserDataPath = () => userDataPath
}

function cachePath(): string {
  return join(getUserDataPath(), 'update-mirror.json')
}

function configPath(): string {
  return join(getUserDataPath(), 'update-mirror-config.json')
}

function normalizeMirrorBase(raw: string): string | null {
  const text = (raw || '').trim()
  if (!text) return null
  try {
    const u = new URL(text.includes('://') ? text : `https://${text}`)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!u.hostname || EXCLUDE_HOST_RE.test(u.hostname)) return null
    return `${u.protocol}//${u.host}/`
  } catch {
    return null
  }
}

function readConfig(): MirrorConfig {
  try {
    const p = configPath()
    if (!existsSync(p)) return {}
    const raw = JSON.parse(readFileSync(p, 'utf-8'))
    if (!raw || typeof raw !== 'object') return {}
    return {
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : undefined,
      mirrorBase: typeof raw.mirrorBase === 'string' ? raw.mirrorBase : undefined
    }
  } catch {
    return {}
  }
}

function readCache(): MirrorCache | null {
  try {
    const p = cachePath()
    if (!existsSync(p)) return null
    const raw = JSON.parse(readFileSync(p, 'utf-8'))
    if (!raw || typeof raw.mirrorBase !== 'string' || typeof raw.fetchedAt !== 'number') return null
    const candidates = Array.isArray(raw.candidates)
      ? raw.candidates.filter((x: unknown) => typeof x === 'string')
      : []
    return {
      mirrorBase: raw.mirrorBase,
      candidates,
      fetchedAt: raw.fetchedAt,
      source: typeof raw.source === 'string' ? raw.source : 'cache'
    }
  } catch {
    return null
  }
}

function writeCache(cache: MirrorCache): void {
  try {
    const dir = getUserDataPath()
    if (!dir) return
    mkdirSync(dir, { recursive: true })
    writeFileSync(cachePath(), JSON.stringify(cache, null, 2), 'utf-8')
  } catch (err) {
    console.error('[UpdateMirror] Failed to write cache:', err)
  }
}

function httpGetText(url: string, timeoutMs: number): Promise<{ status: number; body: string; finalUrl: string }> {
  return new Promise((resolve, reject) => {
    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    const timer = setTimeout(() => {
      done(() => {
        try {
          req.destroy()
        } catch {
          // ignore
        }
        reject(new Error(`timeout ${timeoutMs}ms: ${url}`))
      })
    }, timeoutMs)

    let req: http.ClientRequest
    const get = url.startsWith('http://') ? http.get : https.get
    req = get(
      url,
      {
        headers: { 'User-Agent': 'fin-agent-desktop', Accept: 'text/html,*/*' },
        timeout: timeoutMs
      },
      (res) => {
        if (
          (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) &&
          res.headers.location
        ) {
          const next = new URL(res.headers.location, url).toString()
          res.resume()
          done(() => {
            httpGetText(next, timeoutMs).then(resolve, reject)
          })
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        const max = 2 * 1024 * 1024
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size <= max) chunks.push(c)
        })
        res.on('end', () => {
          done(() =>
            resolve({
              status: res.statusCode || 0,
              body: Buffer.concat(chunks).toString('utf-8'),
              finalUrl: url
            })
          )
        })
        res.on('error', (err) => done(() => reject(err)))
      }
    )
    req.on('error', (err) => done(() => reject(err)))
  })
}

function extractUrlsFromText(text: string): string[] {
  const found = new Set<string>()
  const re = /https?:\/\/[a-zA-Z0-9][-a-zA-Z0-9.]*[a-zA-Z0-9](?::\d+)?\/?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const n = normalizeMirrorBase(m[0])
    if (n) found.add(n)
  }
  // 裸域名启发式：ghfast.top / xxx.ghproxy.yyy
  const hostRe = /\b((?:ghfast|ghproxy|ghp|ghgo)[a-z0-9.-]*\.[a-z]{2,})\b/gi
  while ((m = hostRe.exec(text))) {
    const n = normalizeMirrorBase(`https://${m[1]}/`)
    if (n) found.add(n)
  }
  return [...found]
}

function extractScriptUrls(html: string, pageUrl: string): string[] {
  const urls: string[] = []
  const re = /src=["']([^"']+\.js[^"']*)["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    try {
      urls.push(new URL(m[1], pageUrl).toString())
    } catch {
      // ignore
    }
  }
  return urls.slice(0, 3)
}

function rankCandidates(bases: string[]): string[] {
  const uniq = [...new Set(bases.map((b) => normalizeMirrorBase(b)).filter(Boolean) as string[])]
  uniq.sort((a, b) => {
    const pa = PREFER_HOST_RE.test(a) ? 0 : 1
    const pb = PREFER_HOST_RE.test(b) ? 0 : 1
    if (pa !== pb) return pa - pb
    return a.localeCompare(b)
  })
  return uniq
}

async function probeMirror(base: string): Promise<boolean> {
  try {
    const res = await httpGetText(base, PROBE_TIMEOUT_MS)
    return res.status >= 200 && res.status < 400
  } catch {
    return false
  }
}

async function discoverFromPublishPage(): Promise<string[]> {
  const page = await httpGetText(PUBLISH_PAGE_URL, FETCH_TIMEOUT_MS)
  const fromHtml = extractUrlsFromText(page.body)
  const scriptUrls = extractScriptUrls(page.body, PUBLISH_PAGE_URL)
  const fromScripts: string[] = []
  for (const scriptUrl of scriptUrls) {
    try {
      const js = await httpGetText(scriptUrl, FETCH_TIMEOUT_MS)
      fromScripts.push(...extractUrlsFromText(js.body))
    } catch (err) {
      console.log('[UpdateMirror] skip script', scriptUrl, String(err))
    }
  }
  return rankCandidates([...fromHtml, ...fromScripts])
}

async function pickLiveMirrors(candidates: string[], limit = 3): Promise<string[]> {
  const live: string[] = []
  for (const base of candidates) {
    if (live.length >= limit) break
    if (await probeMirror(base)) live.push(base)
  }
  return live
}

/** 刷新发布站并写入缓存；失败则尽量保留旧缓存 / seed */
export async function refreshMirrorCache(force = false): Promise<MirrorCache> {
  const existing = readCache()
  if (
    !force &&
    existing &&
    Date.now() - existing.fetchedAt < CACHE_TTL_MS &&
    existing.mirrorBase
  ) {
    return existing
  }

  try {
    const discovered = await discoverFromPublishPage()
    const ordered = rankCandidates([SEED_MIRROR_BASE, ...discovered, ...(existing?.candidates || [])])
    const live = await pickLiveMirrors(ordered, 3)
    const list = live.length ? live : [SEED_MIRROR_BASE]
    const cache: MirrorCache = {
      mirrorBase: list[0],
      candidates: list,
      fetchedAt: Date.now(),
      source: 'ghproxy.link'
    }
    writeCache(cache)
    console.log('[UpdateMirror] refreshed', cache.mirrorBase, cache.candidates)
    return cache
  } catch (err) {
    console.error('[UpdateMirror] refresh failed:', err)
    if (existing?.mirrorBase) return existing
    const fallback: MirrorCache = {
      mirrorBase: SEED_MIRROR_BASE,
      candidates: [SEED_MIRROR_BASE],
      fetchedAt: Date.now(),
      source: 'seed'
    }
    writeCache(fallback)
    return fallback
  }
}

export function rewriteViaMirror(mirrorBase: string, githubUrl: string): string {
  const base = normalizeMirrorBase(mirrorBase) || SEED_MIRROR_BASE
  const target = githubUrl.trim()
  if (!target) return target
  // 已是镜像 URL 则不再套一层
  if (target.startsWith(base)) return target
  try {
    const u = new URL(target)
    if (u.hostname === new URL(base).hostname) return target
  } catch {
    // ignore
  }
  return `${base}${target}`
}

/**
 * 返回按优先级排列的下载 URL 列表：
 * 配置固定镜像 → 缓存/发布站候选 → seed → 官方原始地址
 */
export async function getUpdateDownloadCandidates(
  originalGithubUrl: string,
  options?: { forceRefresh?: boolean }
): Promise<string[]> {
  const config = readConfig()
  if (config.enabled === false) {
    return [originalGithubUrl]
  }

  const urls: string[] = []
  const push = (u: string) => {
    if (u && !urls.includes(u)) urls.push(u)
  }

  const fixed = config.mirrorBase ? normalizeMirrorBase(config.mirrorBase) : null
  if (fixed) {
    push(rewriteViaMirror(fixed, originalGithubUrl))
    push(originalGithubUrl)
    return urls
  }

  const cache = await refreshMirrorCache(Boolean(options?.forceRefresh))
  for (const base of [cache.mirrorBase, ...cache.candidates, SEED_MIRROR_BASE]) {
    const n = normalizeMirrorBase(base)
    if (n) push(rewriteViaMirror(n, originalGithubUrl))
  }
  push(originalGithubUrl)
  return urls
}
