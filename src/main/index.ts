import { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, Notification, shell, screen } from 'electron'
import {
  applyNativeBackdrop,
  applyNativeThemeSource,
  attachBackdropPersistence,
  currentWindowBackdrop,
  disposeBackdropHelper,
  nativeBackdropBrowserOptions
} from './windowBackdrop'
import { join, dirname } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { spawn, ChildProcess, exec, execSync } from 'child_process'
import { readFileSync, existsSync, appendFileSync, createWriteStream, unlink, writeFileSync, renameSync, mkdirSync } from 'fs'
import * as http from 'http'
import * as https from 'https'
import { promisify, format } from 'util'
import { getUpdateDownloadCandidates, initUpdateMirror } from './updateMirror'
import { markOnboardingStatus, resolveStartupHash } from './onboarding'

const execPromise = promisify(exec)

// Setup file logging
function setupLogging() {
  try {
    const logPath = join(app.getPath('userData'), 'app.log')
    // Clear old log on startup (optional, maybe user wants history? User said "append" implicitly by "write to", but usually logs are appended or rotated. "Clear" is safer for dev, but "Append" is better for history. I'll append.)
    // Actually, maybe I should print a separator on startup.
    
    const logToFile = (message: string) => {
      const timestamp = new Date().toISOString()
      const logMessage = `[${timestamp}] ${message}\n`
      try {
        appendFileSync(logPath, logMessage)
      } catch (err) {
        // Fail silently
      }
    }

    const originalLog = console.log
    const originalError = console.error

    console.log = (...args: any[]) => {
      originalLog.apply(console, args)
      logToFile(format(...args))
    }

    console.error = (...args: any[]) => {
      originalError.apply(console, args)
      logToFile('[ERROR] ' + format(...args))
    }
    
    console.log('--- App Started ---')
    console.log('Log file:', logPath)
  } catch (err) {
    console.error('Failed to setup logging:', err)
  }
}


let chatWindow: BrowserWindow | null = null
let tray: Tray | null = null

// ─── 应用内浮动通知队列 ────────────────────────────────────────────────────────
const TOAST_WIDTH = 360
const TOAST_HEIGHT = 100
const TOAST_NEWS_WIDTH = 440
/** 新闻 Toast 创建时的占位高度，渲染后按内容自适应 */
const TOAST_NEWS_INITIAL_HEIGHT = 120
const TOAST_NEWS_MIN_HEIGHT = 88
const TOAST_NEWS_MAX_HEIGHT = 312
/** 股价提醒文案较长，允许多行自适应高度 */
const TOAST_PRICE_ALERT_MAX_HEIGHT = 220
const TOAST_MARGIN = 16
const TOAST_DURATION_MS = 30000
const TOAST_MAX_STACK = 5
/** 当前屏幕上显示的通知浮窗，按从下到上排列（index 0 = 最新/最底部） */
const toastStack: Array<{
  win: BrowserWindow
  timerId: ReturnType<typeof setTimeout>
  displayId: number
  height: number
  width: number
}> = []

const UPDATE_TOAST_WIDTH = 420
const UPDATE_TOAST_COMPACT_HEIGHT = 176
const UPDATE_TOAST_MAX_HEIGHT = 560
const UPDATE_TOAST_EXPANDED_INITIAL = 420
/** 当前更新窗实际高度（展开/压缩会变），供其它 toast 堆叠偏移 */
let updateToastCurrentHeight = UPDATE_TOAST_COMPACT_HEIGHT
let updateToastWindow: BrowserWindow | null = null
let updateToastReveal: (() => void) | null = null
let updateToastRevealed = false

type ToastPayload = DesktopNotificationPayload & {
  /** 传给渲染层的已解析标题/正文（main 侧可能会改写） */
  _title: string
  _body: string
  _winId?: number
}

type PendingToastEntry = {
  payload: ToastPayload
  notificationIds: string[]
  newsIds?: string | string[] | null
  ackRequired?: boolean
  delivered: boolean
  /** 仅主投递窗口负责 ACK / inFlight，镜像屏窗口只负责展示 */
  primaryDelivery: boolean
  /** 内容就绪后再揭幕，避免白底空窗闪一下 */
  reveal?: () => void
  revealed?: boolean
}

/** webContents.id → 待展示/展示中的 toast，解决 React 挂载前 toast-show 丢失 */
const pendingToasts = new Map<number, PendingToastEntry>()

function getUpdateToastOffset(): number {
  if (updateToastWindow && !updateToastWindow.isDestroyed()) {
    return updateToastCurrentHeight + TOAST_MARGIN
  }
  return 0
}

function placeUpdateToastWindow(win: BrowserWindow, height: number): void {
  const display = screen.getPrimaryDisplay()
  const { width: sw, height: sh } = display.workAreaSize
  const h = Math.max(
    UPDATE_TOAST_COMPACT_HEIGHT,
    Math.min(UPDATE_TOAST_MAX_HEIGHT, Math.round(height))
  )
  updateToastCurrentHeight = h
  const x = sw - UPDATE_TOAST_WIDTH - TOAST_MARGIN
  // 未揭幕时只改尺寸，保持在屏幕外，避免内容未就绪就闪到目标位
  const y = updateToastRevealed ? sh - TOAST_MARGIN - h : sh + 10
  win.setBounds({ x, y, width: UPDATE_TOAST_WIDTH, height: h }, false)
  if (updateToastRevealed) repositionToastStack()
}

function getToastStartY(index: number, workH: number, heights: number[]): number {
  const offset = getUpdateToastOffset()
  let above = 0
  for (let i = 0; i < index; i++) {
    above += (heights[i] || TOAST_HEIGHT) + TOAST_MARGIN
  }
  const selfH = heights[index] || TOAST_HEIGHT
  return workH - TOAST_MARGIN - offset - above - selfH
}

function repositionToastStack(): void {
  const byDisplay = new Map<number, Array<{ win: BrowserWindow; height: number; width: number }>>()
  toastStack.forEach((item) => {
    if (item.win.isDestroyed()) return
    const list = byDisplay.get(item.displayId) || []
    list.push(item)
    byDisplay.set(item.displayId, list)
  })
  for (const [displayId, items] of byDisplay) {
    const display =
      screen.getAllDisplays().find((d) => d.id === displayId) || screen.getPrimaryDisplay()
    const { x: wx, y: wy, width: sw, height: sh } = display.workArea
    const heights = items.map((it) => it.height || TOAST_HEIGHT)
    items.forEach(({ win, height, width }, i) => {
      const y = wy + getToastStartY(i, sh, heights)
      const toastW = width || TOAST_WIDTH
      const x = wx + sw - toastW - TOAST_MARGIN
      if (!win.isDestroyed()) {
        win.setBounds({ x, y, width: toastW, height: height || TOAST_HEIGHT }, false)
      }
    })
  }
}

function createToastWindow(
  payload: ToastPayload,
  notificationIds: string[] = [],
  options?: { newsIds?: string | string[] | null; ackRequired?: boolean }
): void {
  // 仅在主屏弹出，避免多显示器重复推送
  createToastWindowOnDisplay(payload, notificationIds, options, screen.getPrimaryDisplay(), true)
}

function createToastWindowOnDisplay(
  payload: ToastPayload,
  notificationIds: string[],
  options: { newsIds?: string | string[] | null; ackRequired?: boolean } | undefined,
  display: Electron.Display,
  primaryDelivery: boolean
): void {
  const { x: wx, y: wy, width: sw, height: sh } = display.workArea
  const isNewsToast = payload.type === 'news' || !!payload.news_id || !!payload.merged
  const toastW = isNewsToast ? TOAST_NEWS_WIDTH : TOAST_WIDTH
  const toastH = isNewsToast ? TOAST_NEWS_INITIAL_HEIGHT : TOAST_HEIGHT
  const x = wx + sw - toastW - TOAST_MARGIN
  const y = wy + sh + 20 // 从屏幕下方外面开始，再滑入
  const cursor = screen.getCursorScreenPoint()
  console.log(
    `[Toast] target display id=${display.id} scale=${display.scaleFactor} workArea=(${wx},${wy},${sw},${sh}) cursor=(${cursor.x},${cursor.y}) primaryDelivery=${primaryDelivery}`
  )

  if (toastStack.length >= TOAST_MAX_STACK) {
    // 关闭最旧的那个
    const oldest = toastStack.pop()!
    clearTimeout(oldest.timerId)
    if (!oldest.win.isDestroyed()) {
      oldest.win.hide()
      oldest.win.close()
    }
  }

  const win = new BrowserWindow({
    width: toastW,
    height: toastH,
    x,
    y,
    show: false,
    frame: false,
    // Windows 上 transparent 窗口经常 isVisible=true 但像素完全透出，看起来像没弹窗
    transparent: false,
    // 与 Toast 卡片同色，避免加载期白底闪一下
    backgroundColor: '#1e1f24',
    roundedCorners: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: true,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  const paintToastChrome = () => {
    void win.webContents.insertCSS(
      'html,body,#root{background:#1e1f24!important;margin:0;padding:0;overflow:hidden;}'
    )
  }
  win.webContents.on('dom-ready', paintToastChrome)
  paintToastChrome()

  const contentsId = win.webContents.id
  const toastPayload: ToastPayload = { ...payload, _winId: win.id }

  let slideStarted = false
  const startReveal = () => {
    if (slideStarted || win.isDestroyed()) return
    slideStarted = true
    const pending = pendingToasts.get(contentsId)
    if (pending) pending.revealed = true
    // 内容与高度已就绪后再显示，避免空窗/白底闪现
    if (!win.isVisible()) win.showInactive()
    win.moveTop()
    repositionToastStack()
    win.setPosition(x, wy + sh + 10, false)
    let step = 0
    const steps = 16
    const startY = wy + sh + 10
    const liveEndY = () => {
      const stackOnDisplay = toastStack.filter(
        (t) => t.displayId === display.id && !t.win.isDestroyed()
      )
      const heights = stackOnDisplay.map((t) => t.height || TOAST_HEIGHT)
      const idx = Math.max(
        0,
        stackOnDisplay.findIndex((t) => t.win === win)
      )
      return wy + getToastStartY(idx, sh, heights)
    }
    const animate = () => {
      step++
      const t = step / steps
      const eased = 1 - Math.pow(1 - t, 3)
      const endY = liveEndY()
      const curY = Math.round(startY + (endY - startY) * eased)
      if (!win.isDestroyed()) win.setPosition(x, curY, false)
      if (step < steps) setTimeout(animate, 16)
      else if (!win.isDestroyed()) {
        repositionToastStack()
        const b = win.getBounds()
        console.log(
          `[Toast] slide done id=${contentsId} finalPos=(${b.x},${b.y}) height=${b.height} visible=${win.isVisible()}`
        )
      }
    }
    animate()
  }

  pendingToasts.set(contentsId, {
    payload: toastPayload,
    notificationIds: primaryDelivery ? notificationIds : [],
    newsIds: primaryDelivery ? options?.newsIds : undefined,
    ackRequired: primaryDelivery ? options?.ackRequired : false,
    delivered: false,
    primaryDelivery,
    reveal: startReveal,
    revealed: false
  })
  console.log(
    `[Toast] create id=${contentsId} title="${payload._title}" ids=${JSON.stringify(notificationIds)} pos=(${x},${y}) workArea=(${wx},${wy},${sw},${sh})`
  )

  const releaseInFlightIfNeeded = () => {
    const entry = pendingToasts.get(contentsId)
    if (!entry || entry.delivered || !entry.primaryDelivery) return
    entry.notificationIds.forEach((id) => inFlightNotificationIds.delete(id))
  }

  let closing = false
  const onToastClick = (_event: Electron.IpcMainEvent) => {
    if (_event.sender.id !== contentsId) return
    clearTimeout(timerId)
    closeToast()
    handleNotificationActivation(payload)
  }
  const onToastClose = (_event: Electron.IpcMainEvent) => {
    if (_event.sender.id !== contentsId) return
    clearTimeout(timerId)
    closeToast()
  }

  const closeToast = () => {
    if (closing) return
    closing = true
    clearTimeout(timerId)
    ipcMain.off('toast-click', onToastClick)
    ipcMain.off('toast-close', onToastClose)
    const idx = toastStack.findIndex((t) => t.win === win)
    if (idx !== -1) toastStack.splice(idx, 1)
    releaseInFlightIfNeeded()
    pendingToasts.delete(contentsId)
    // 不透明窗口：内容 CSS 淡出后底色仍会留在屏幕上，必须立刻 hide/destroy
    if (!win.isDestroyed()) {
      try {
        win.hide()
      } catch {
        // ignore
      }
      try {
        win.destroy()
      } catch {
        // ignore
      }
    }
    repositionToastStack()
  }

  const timerId = setTimeout(closeToast, TOAST_DURATION_MS)
  toastStack.unshift({ win, timerId, displayId: display.id, height: toastH, width: toastW })

  win.webContents.on('did-finish-load', () => {
    console.log(`[Toast] did-finish-load id=${contentsId}, sending toast-show`)
    win.webContents.send('toast-show', toastPayload)
    // 内容未就绪时重发，绝不空窗揭幕；超时仍无 toast-shown 则关闭并释放 inFlight 以便重试
    const retryShow = setTimeout(() => {
      const entry = pendingToasts.get(contentsId)
      if (!entry || entry.revealed || win.isDestroyed()) return
      console.warn(`[Toast] resend toast-show id=${contentsId} (no toast-shown yet)`)
      win.webContents.send('toast-show', toastPayload)
    }, 800)
    const failSafeClose = setTimeout(() => {
      const entry = pendingToasts.get(contentsId)
      if (!entry || entry.revealed || win.isDestroyed()) return
      console.error(
        `[Toast] abort blank toast id=${contentsId} title="${payload._title}" — content never confirmed`
      )
      clearTimeout(timerId)
      closeToast()
    }, 3500)
    win.once('closed', () => {
      clearTimeout(retryShow)
      clearTimeout(failSafeClose)
    })
  })

  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error(`[Toast] did-fail-load id=${contentsId} code=${code} desc=${desc}`)
  })

  win.on('closed', () => {
    releaseInFlightIfNeeded()
    pendingToasts.delete(contentsId)
  })

  ipcMain.on('toast-click', onToastClick)
  ipcMain.on('toast-close', onToastClose)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/#/toast`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/toast' })
  }
}
let pyProc: ChildProcess | null = null
let isCleaningUp = false  // 防止重复执行清理
const activeRequests = new Map<string, http.ClientRequest>()  // sessionKey -> 进行中的 HTTP 请求
const userStoppedKeys = new Set<string>()  // 用户主动停止的请求 key
// 通知状态机（每条通知以其 notification_ids 为 key）：
//   unknown -> inFlight（已 show()，等待 show/failed 事件）
//     -> show 触发：写 seen + 同步落盘成功 -> ack；落盘失败 -> 仅记日志，
//        不 ack，留给下一轮 poll 重试落盘/ACK
//     -> failed（或构造/show 抛错）：清 inFlight，不写 seen、不 ack，
//        下一轮 poll 视为全新通知重新尝试展示
//   seen（内存或持久化命中）-> 不再重复弹窗，仅重试 ACK（幂等）
// 之所以只在 show 事件之后才落 seen/ACK：show() 是异步展示，调用后立即
// ack 无法保证系统真的把通知弹出来了；只有 show 事件才是“已确认展示”。
const inFlightNotificationIds = new Set<string>()
const seenNotificationIds = new Map<string, number>()
const NOTIFICATION_SEEN_TTL_MS = 30 * 24 * 60 * 60 * 1000
const NOTIFICATION_SEEN_MAX_SIZE = 5000
const APP_USER_MODEL_ID = 'com.finagent.desktop'
let seenNotificationsFilePath = ''
let seenNotificationsDirty = false
let seenNotificationsSaveTimer: ReturnType<typeof setTimeout> | null = null

type DesktopNotificationPayload = {
  notification_id?: string
  notification_ids?: string[]
  type?: string
  title?: string
  body?: string
  news_id?: string | null
  news_ids?: string[]
  merged?: boolean
  news_count?: number
  sentiment?: 'bullish' | 'bearish' | 'neutral' | null
  sentiment_counts?: {
    bullish?: number
    bearish?: number
    neutral?: number
    unknown?: number
  }
  subscription_id?: string | null
  subscription_ids?: string[]
  source?: string
  url?: string
  task_id?: string
  ts_code?: string
  ack_required?: boolean
  update?: Partial<UpdateInfo>
}

function loadSeenNotifications(): void {
  try {
    seenNotificationsFilePath = join(app.getPath('userData'), 'seen-notifications.json')
    if (!existsSync(seenNotificationsFilePath)) return
    const raw = readFileSync(seenNotificationsFilePath, 'utf-8')
    const parsed = JSON.parse(raw)
    const entries = parsed && typeof parsed === 'object' ? parsed.entries : null
    if (entries && typeof entries === 'object') {
      const now = Date.now()
      for (const [id, seenAt] of Object.entries(entries as Record<string, number>)) {
        if (typeof seenAt === 'number' && now - seenAt <= NOTIFICATION_SEEN_TTL_MS) {
          seenNotificationIds.set(id, seenAt)
        }
      }
    }
  } catch (err) {
    // 读写失败只记日志，不影响通知主流程；后端 ACK 仍是主保证
    console.error('[Notification] Failed to load seen-notifications cache:', err)
  }
}

/** 同步原子落盘。展示确认（show 事件）后的 ACK 关键路径必须调用这个函数
 * 并等待其返回结果，不能走防抖——防抖会在“确认已展示”和“确认已持久化”
 * 之间引入不确定的时间窗口，一旦此时崩溃就会永久丢失该通知已展示的记录，
 * 导致重启后既重复弹窗、又可能因为本地误判 seen 而漏掉重试 ACK。
 * 返回 true 表示当前内存状态已安全落盘（或本来就没有脏数据）。 */
function persistSeenNotificationsNow(): boolean {
  if (!seenNotificationsDirty) return true
  if (!seenNotificationsFilePath) return false
  try {
    mkdirSync(join(seenNotificationsFilePath, '..'), { recursive: true })
    const payload = JSON.stringify({ entries: Object.fromEntries(seenNotificationIds) })
    const tempPath = `${seenNotificationsFilePath}.${process.pid}.tmp`
    writeFileSync(tempPath, payload, 'utf-8')
    renameSync(tempPath, seenNotificationsFilePath)
    seenNotificationsDirty = false
    if (seenNotificationsSaveTimer) {
      clearTimeout(seenNotificationsSaveTimer)
      seenNotificationsSaveTimer = null
    }
    return true
  } catch (err) {
    console.error('[Notification] Failed to persist seen-notifications cache:', err)
    return false
  }
}

/** 仅用于非关键路径（后台过期清理）的防抖落盘，不参与 ACK 判定。 */
function scheduleSeenNotificationsSave(): void {
  if (seenNotificationsSaveTimer) return
  seenNotificationsSaveTimer = setTimeout(() => {
    seenNotificationsSaveTimer = null
    persistSeenNotificationsNow()
  }, 1500)
}

function pruneExpiredSeenNotifications(): void {
  const now = Date.now()
  let pruned = false
  for (const [id, seenAt] of seenNotificationIds) {
    if (now - seenAt > NOTIFICATION_SEEN_TTL_MS) {
      seenNotificationIds.delete(id)
      pruned = true
    }
  }
  if (pruned) {
    seenNotificationsDirty = true
    scheduleSeenNotificationsSave()
  }
}

function isNotificationSeen(ids: string[]): boolean {
  if (ids.length === 0) return false
  return ids.every((id) => seenNotificationIds.has(id))
}

/** 只应在收到 show 事件（真正确认已展示）之后调用。 */
function markNotificationsSeen(ids: string[]): void {
  if (ids.length === 0) return
  const now = Date.now()
  for (const id of ids) {
    seenNotificationIds.set(id, now)
  }
  seenNotificationsDirty = true
  while (seenNotificationIds.size > NOTIFICATION_SEEN_MAX_SIZE) {
    const oldest = seenNotificationIds.keys().next().value
    if (!oldest) break
    seenNotificationIds.delete(oldest)
  }
}

function confirmNotificationDelivery(
  ids: string[],
  notif: DesktopNotificationPayload
): void {
  if (ids.length === 0) return
  markNotificationsSeen(ids)
  const persisted = persistSeenNotificationsNow()
  if (persisted) {
    if (notif.ack_required) {
      void ackNotifications(ids, notif.news_ids?.length ? notif.news_ids : notif.news_id)
    }
  } else {
    console.error(
      '[Notification] seen persist failed after show, will retry ack on next poll:',
      ids
    )
  }
}

function focusChatWindow(): boolean {
  if (!chatWindow || chatWindow.isDestroyed()) return false
  if (chatWindow.isMinimized()) {
    chatWindow.restore()
  }
  chatWindow.show()
  chatWindow.focus()
  return true
}

function handleNotificationActivation(notif: DesktopNotificationPayload): void {
  if (!focusChatWindow() || !chatWindow) return
  if (notif.type === 'price_alert' || notif.type === 'watchlist_move') {
    const tsCode = (notif.ts_code || '').trim()
    if (tsCode) {
      chatWindow.webContents.send(
        'navigate-route',
        `/stock/${encodeURIComponent(tsCode)}`
      )
    } else {
      // 无标的代码时回退提醒任务列表
      chatWindow.webContents.send('navigate-route', '/chat?reminders=1')
      chatWindow.webContents.send('price-alert-notification-open', {
        taskId: notif.task_id || undefined,
        tsCode: undefined
      })
    }
    return
  }
  if (notif.type === 'app_update') {
    // 通知用统一 Toast；点击后再打开更新操作浮窗（下载/安装）
    if (pendingUpdate) {
      createUpdateToastWindow(pendingUpdate)
    } else {
      chatWindow.webContents.send('navigate-route', '/about')
    }
    return
  }
  if (notif.type === 'news' || notif.news_id || notif.merged) {
    const newsId = notif.merged ? undefined : notif.news_id || undefined
    const location = {
      newsId,
      subscriptionId: notif.subscription_id || undefined,
      subscriptionIds: notif.subscription_ids || [],
      source: notif.source,
      url: notif.merged ? undefined : notif.url
    }
    const routeParams = new URLSearchParams()
    if (newsId) routeParams.set('newsId', newsId)
    if (notif.subscription_id) {
      routeParams.set('subscriptionId', notif.subscription_id)
    }
    const routeQuery = routeParams.toString()
    chatWindow.webContents.send('navigate-route', `/news${routeQuery ? `?${routeQuery}` : ''}`)
    chatWindow.webContents.send('news-notification-open', location)
  }
}

function ensureWindowsToastShortcut(): void {
  if (process.platform !== 'win32') return
  try {
    const programsDir = join(
      app.getPath('appData'),
      'Microsoft', 'Windows', 'Start Menu', 'Programs'
    )
    mkdirSync(programsDir, { recursive: true })
    const shortcutPath = join(programsDir, 'Fin-Agent.lnk')
    const operation = existsSync(shortcutPath) ? 'update' : 'create'
    const ok = shell.writeShortcutLink(shortcutPath, operation, {
      target: process.execPath,
      cwd: dirname(process.execPath),
      description: 'Fin-Agent 金融助手',
      icon: process.execPath,
      iconIndex: 0,
      appUserModelId: APP_USER_MODEL_ID
    })
    console.log(ok
      ? `[Notification] Windows shortcut ready: ${shortcutPath}`
      : '[Notification] Failed to create Windows shortcut')
  } catch (err) {
    console.error('[Notification] ensureWindowsToastShortcut error:', err)
  }
}


async function ackNotifications(ids: string[], newsIdsInput?: string | string[] | null): Promise<void> {
  const notificationIds = [...new Set(ids.filter(Boolean))]
  const newsIds = [
    ...new Set(
      (Array.isArray(newsIdsInput)
        ? newsIdsInput
        : newsIdsInput
          ? [newsIdsInput]
          : []
      ).filter(Boolean)
    )
  ]
  if (notificationIds.length === 0 && newsIds.length === 0) return
  try {
    await makeApiRequest('/notifications/ack', 'POST', {
      notification_ids: notificationIds,
      news_ids: newsIds
    })
  } catch (err) {
    // 网络/后端瞬时失败：不做特殊处理，下一轮 poll 会重新收到该通知并重试 ACK
    console.error('[Notification] ack failed, will retry on next poll:', err)
  }
}

function streamRequestKey(sessionId?: string | null): string {
  return sessionId || '__default__'
}
let serverReady = false
let serverReadyResolve: (() => void) | null = null
const serverReadyPromise = new Promise<void>((resolve) => {
  serverReadyResolve = resolve
})

// Read version from VERSION file
function getVersion(): string {
  try {
    const versionPath = is.dev 
      ? join(__dirname, '../../VERSION')
      : join(process.resourcesPath, 'VERSION')
    const version = readFileSync(versionPath, 'utf-8').trim()
    return version
  } catch (err) {
    console.error('Failed to read VERSION file:', err)
    return '0.0.0'
  }
}

// 检查端口是否被占用并清理
async function killProcessOnPort(port: number): Promise<void> {
  try {
    console.log(`[Cleanup] Checking if port ${port} is in use...`)
    
    if (process.platform === 'win32') {
      // Windows: 使用 netstat 查找占用端口的 PID
      const { stdout } = await execPromise(`netstat -ano | findstr :${port}`)
      
      if (stdout) {
        console.log(`[Cleanup] Port ${port} is in use:`)
        console.log(stdout)
        
        // 提取 PID (最后一列)
        const lines = stdout.trim().split('\n')
        const pids = new Set<string>()
        
        for (const line of lines) {
          const parts = line.trim().split(/\s+/)
          const pid = parts[parts.length - 1]
          if (pid && pid !== '0' && !isNaN(parseInt(pid))) {
            pids.add(pid)
          }
        }
        
        // 终止所有占用该端口的进程
        for (const pid of pids) {
          try {
            console.log(`[Cleanup] Killing process ${pid}...`)
            await execPromise(`taskkill /F /PID ${pid}`)
            console.log(`[Cleanup] Process ${pid} killed successfully`)
          } catch (err) {
            console.log(`[Cleanup] Failed to kill process ${pid}:`, err)
          }
        }
        
        // 等待一下确保端口释放
        await new Promise(resolve => setTimeout(resolve, 500))
      } else {
        console.log(`[Cleanup] Port ${port} is not in use`)
      }
    } else {
      // macOS/Linux: 使用 lsof
      try {
        const { stdout } = await execPromise(`lsof -ti:${port}`)
        if (stdout) {
          const pids = stdout.trim().split('\n')
          for (const pid of pids) {
            if (pid) {
              console.log(`[Cleanup] Killing process ${pid}...`)
              await execPromise(`kill -9 ${pid}`)
              console.log(`[Cleanup] Process ${pid} killed successfully`)
            }
          }
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      } catch (err) {
        // lsof 没有找到进程时会返回错误，这是正常的
        console.log(`[Cleanup] Port ${port} is not in use`)
      }
    }
  } catch (err: any) {
    // 如果命令执行失败，可能是因为没有进程占用端口
    // Windows findstr 在找不到匹配项时会返回 exit code 1，这是正常的
    if (err.message && err.message.includes('findstr') && err.code === 1) {
       console.log(`[Cleanup] No process found on port ${port} (clean)`)
    } else {
       console.log(`[Cleanup] No process found on port ${port} or cleanup failed:`, err.message || err)
    }
  }
}

function makeApiRequestRaw(path: string, method: string = 'GET', data?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port: 5678,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    }

    const req = http.request(options, (res) => {
      let buffer = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => buffer += chunk)
      res.on('end', () => {
        try {
          const json = JSON.parse(buffer)
          resolve(json)
        } catch (e) {
          console.error('JSON parse error:', e, buffer)
          resolve(buffer) 
        }
      })
    })

    req.on('error', (err) => reject(err))

    if (data) {
      const body = JSON.stringify(data)
      req.setHeader('Content-Length', Buffer.byteLength(body))
      req.write(body)
    }
    req.end()
  })
}

async function makeApiRequest(path: string, method: string = 'GET', data?: any): Promise<any> {
  if (!serverReady) {
    console.log(`[API] Waiting for Python server before ${method} ${path}...`)
    await serverReadyPromise
  }
  return makeApiRequestRaw(path, method, data)
}

async function startPythonServer() {
  // 先清理可能存在的僵尸进程
  await killProcessOnPort(5678)
  
  const pythonDist = is.dev
    ? join(__dirname, '../../python')
    : join(process.resourcesPath, 'python')

  const executableName = process.platform === 'win32' ? 'api.exe' : 'api'
  let executable = ''

  if (is.dev) {
    const venvPython = process.platform === 'win32'
      ? join(__dirname, '../../build_venv/Scripts/python.exe')
      : join(__dirname, '../../build_venv/bin/python')
    
    if (existsSync(venvPython)) {
      executable = venvPython
    } else {
      console.warn('[Start] Virtual environment python not found, falling back to global python')
      executable = 'python'
    }
  } else {
    executable = join(pythonDist, 'api', executableName)
  }

  const args = is.dev
     ? ['-u', join(pythonDist, 'api.py')]
     : []

  console.log(`[${is.dev ? 'Dev' : 'Prod'}] Starting Python server`)
  console.log(`  Executable: ${executable}`)
  console.log(`  Args: ${args}`)
  console.log(`  WorkDir: ${pythonDist}`)
  
  // 设置 PYTHONPATH 以确保能找到 fin_agent 模块
  const env = {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONPATH: pythonDist
  }
  
  // 统一使用 python 命令运行脚本 (with unbuffered mode)
  pyProc = spawn(executable, args, {
    cwd: pythonDist,
    env: env,
    stdio: ['ignore', 'pipe', 'pipe']  // stdin ignored, stdout/stderr piped
  })
  
  pyProc.stdout?.on('data', (data) => {
    const text = data.toString()
    // Split by lines and log each line
    text.split('\n').forEach(line => {
      if (line.trim()) {
        console.log(`[Python]: ${line}`)
      }
    })
  })
  
  pyProc.stderr?.on('data', (data) => {
    const text = data.toString()
    // Split by lines and log each line immediately
    text.split('\n').forEach(line => {
      if (line.trim()) {
        console.error(`[Python Err]: ${line}`)
      }
    })
  })
  
  pyProc.stdout?.on('error', (err) => {
    console.error('[Python stdout error]:', err)
  })
  
  pyProc.stderr?.on('error', (err) => {
    console.error('[Python stderr error]:', err)
  })

  pyProc.on('close', (code, signal) => {
    console.log(`[Python] Process exited with code ${code}, signal ${signal}`)
    pyProc = null
  })
  
  pyProc.on('exit', (code, signal) => {
    console.log(`[Python] Process exit event: code ${code}, signal ${signal}`)
  })
  
  pyProc.on('error', (err) => {
    console.error('[Python] Process error:', err)
  })
}

/** 与 renderer index.css --fa-titlebar-height 保持一致 */
const TITLE_BAR_HEIGHT = 40

/** 系统标题栏按钮颜色；Mica / Vibrancy 下 overlay 必须透明，否则会盖住系统材质 */
const TITLE_BAR_THEME = {
  dark: { overlay: '#121212', background: '#0a0a0a', symbolColor: '#c8c8c8' },
  light: { overlay: '#eceef1', background: '#e8eaed', symbolColor: '#5c5c5c' }
} as const

function supportsTitleBarOverlay(): boolean {
  return process.platform === 'win32' || process.platform === 'darwin'
}

function applyTitleBarTheme(win: BrowserWindow | null, theme: keyof typeof TITLE_BAR_THEME = 'dark'): void {
  if (!win || win.isDestroyed() || !supportsTitleBarOverlay()) return
  const palette = TITLE_BAR_THEME[theme]
  applyNativeThemeSource(theme)
  const backdrop = currentWindowBackdrop()
  if (backdrop !== 'none') {
    applyNativeBackdrop(win)
    win.setTitleBarOverlay({
      color: '#00000000',
      symbolColor: palette.symbolColor,
      height: TITLE_BAR_HEIGHT
    })
    return
  }
  win.setBackgroundColor(palette.background)
  win.setTitleBarOverlay({
    color: palette.overlay,
    symbolColor: palette.symbolColor,
    height: TITLE_BAR_HEIGHT
  })
}

function createChatWindow(): void {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  const width = Math.min(1360, Math.max(1100, Math.floor(sw * 0.78)))
  const height = Math.min(900, Math.max(720, Math.floor(sh * 0.85)))

  const backdrop = currentWindowBackdrop()
  applyNativeThemeSource('dark')
  chatWindow = new BrowserWindow({
    width,
    height,
    minWidth: 1024,
    minHeight: 680,
    center: true,
    show: false,
    autoHideMenuBar: true,
    title: 'Fin-Agent',
    backgroundColor: backdrop !== 'none' ? '#00000000' : TITLE_BAR_THEME.dark.background,
    ...nativeBackdropBrowserOptions(),
    ...(supportsTitleBarOverlay()
      ? {
          titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
          titleBarOverlay: {
            color: backdrop !== 'none' ? '#00000000' : TITLE_BAR_THEME.dark.overlay,
            symbolColor: TITLE_BAR_THEME.dark.symbolColor,
            height: TITLE_BAR_HEIGHT
          }
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  if (backdrop !== 'none') {
    applyNativeBackdrop(chatWindow)
    attachBackdropPersistence(chatWindow)
    chatWindow.once('ready-to-show', () => applyNativeBackdrop(chatWindow))
  }

  // 禁用 Alt 键显示菜单栏
  chatWindow.setMenuBarVisibility(false)
  chatWindow.setMenu(null)

  chatWindow.on('close', (e) => {
    e.preventDefault()
    chatWindow?.hide()
  })

  const startupHash = resolveStartupHash()
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    chatWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/#/${startupHash}`)
  } else {
    chatWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: startupHash })
  }
}

function createTray() {
  const iconPath = join(__dirname, '../../resources/icon.ico')
  const icon = nativeImage.createFromPath(iconPath)
  
  tray = new Tray(icon)
  
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示/隐藏', click: () => toggleChatWindow() },
    { type: 'separator' },
    { label: '退出', click: async () => {
        // 检查是否有正在进行的生成
        if (hasActiveGeneration()) {
          // 再次检查，确保请求真的还在进行
          if (!hasActiveGeneration()) {
            // 请求已经被清除，直接退出
            console.log('[Main] Request already cleared, exiting directly from tray')
            if (chatWindow) {
                chatWindow.destroy()
                chatWindow = null
            }
            app.quit()
            return
          }
          
          // 优先显示聊天窗口
          if (chatWindow) {
            if (!chatWindow.isVisible()) {
              chatWindow.show()
              chatWindow.focus()
            }
            
            // 最后一次检查，确保请求还在进行
            if (!hasActiveGeneration()) {
              // 请求已经被清除，直接退出
              console.log('[Main] Request cleared before showing dialog from tray, exiting directly')
              if (chatWindow) {
                  chatWindow.destroy()
                  chatWindow = null
              }
              app.quit()
              return
            }
            
            // 通过 IPC 请求渲染进程显示确认对话框
            chatWindow.webContents.send('quit-confirm')
            
            // 等待用户响应
            const confirmed = await new Promise<boolean>((resolve) => {
              quitConfirmResolve = resolve
              // 设置超时，如果 30 秒内没有响应，默认取消
              setTimeout(() => {
                if (quitConfirmResolve === resolve) {
                  quitConfirmResolve = null
                  resolve(false)
                }
              }, 30000)
            })
            
            // 用户响应后，再次检查请求是否还在进行
            if (!hasActiveGeneration()) {
              // 请求已经被清除，直接退出
              console.log('[Main] Request cleared during dialog from tray, exiting directly')
              if (chatWindow) {
                  chatWindow.destroy()
                  chatWindow = null
              }
              app.quit()
              return
            }
            
            if (!confirmed) {
              // 用户选择取消，不退出
              console.log('[Main] User cancelled quit from tray')
              return
            }
            
            // 用户选择继续退出，停止生成
            await stopActiveGeneration()
          } else {
            // 没有聊天窗口，直接停止生成并退出
            await stopActiveGeneration()
          }
        }
        
        // 销毁窗口以确保 app.quit 能正常工作
        if (chatWindow) {
            chatWindow.destroy()
            chatWindow = null
        }
        app.quit()
    }}
  ])
  
  tray.setToolTip('Fin-Agent')
  tray.setContextMenu(contextMenu)
  
  tray.on('double-click', () => {
    toggleChatWindow()
  })
}

// 单实例锁 - 确保全局只有一个 Fin-Agent 实例运行
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // 如果获取锁失败，说明已经有一个实例在运行
  console.log('[SingleInstance] Another instance is already running. Exiting...')
  app.quit()
} else {
  // 获取锁成功，处理第二个实例尝试启动的情况
  app.on('second-instance', (_event, commandLine, workingDirectory) => {
    console.log('[SingleInstance] Attempted to start second instance. Focusing existing windows...')
    console.log('[SingleInstance] Command line:', commandLine)
    console.log('[SingleInstance] Working directory:', workingDirectory)
    
    // 如果用户尝试启动第二个实例，显示并聚焦现有的窗口
    if (chatWindow) {
      if (chatWindow.isMinimized()) {
        chatWindow.restore()
      }
      chatWindow.show()
      chatWindow.focus()
      chatWindow.webContents.send('focus-input')
    }
  })
}

// 禁用 GPU 缓存以避免权限问题
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
app.commandLine.appendSwitch('disable-gpu-program-cache')
// 禁用 HTTP 缓存
app.commandLine.appendSwitch('disable-http-cache')
// 在某些 Windows 系统上避免缓存目录权限问题
app.commandLine.appendSwitch('disk-cache-size', '0')

/**
 * 显示/隐藏完整主窗口（聊天界面）。
 * 全局快捷键与托盘「显示/隐藏」共用此逻辑。
 */
function toggleChatWindow(): void {
  if (chatWindow?.isVisible()) {
    chatWindow.hide()
    return
  }

  if (chatWindow) {
    if (chatWindow.isMinimized()) {
      chatWindow.restore()
    }
    chatWindow.show()
    chatWindow.focus()
    chatWindow.webContents.send('focus-input')
  }
}

let currentGlobalShortcut = 'Ctrl+Alt+Q'

function registerGlobalShortcut(shortcut: string) {
  globalShortcut.unregisterAll()
  try {
    const ret = globalShortcut.register(shortcut, () => {
      toggleChatWindow()
    })

    if (!ret) {
      console.log('Global shortcut registration failed:', shortcut)
    } else {
      console.log('Global shortcut registered:', shortcut)
      currentGlobalShortcut = shortcut
    }
  } catch (err) {
    console.error('Error registering global shortcut:', err)
  }
}

function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number)
  const parts2 = v2.split('.').map(Number)
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0
    const p2 = parts2[i] || 0
    if (p1 > p2) return 1
    if (p1 < p2) return -1
  }
  return 0
}

// ─── 应用内更新系统 ────────────────────────────────────────────────────────────

interface UpdateInfo {
  version: string
  tagName: string
  downloadUrl: string
  /** 官方 GitHub browser_download_url，镜像失败时回退 */
  originalDownloadUrl?: string
  fileName: string
  releaseNotes: string
}

let pendingUpdate: UpdateInfo | null = null
let updateDownloadPath = ''
let updateDownloading = false
/** 安装更新时跳过 before-quit 的生成中确认 */
let installingUpdate = false
/** 当前下载请求，关闭窗口时用于中断 */
let activeUpdateRequest: http.ClientRequest | null = null
let updateDownloadAborted = false

class UpdateDownloadAbortedError extends Error {
  constructor() {
    super('下载已取消')
    this.name = 'UpdateDownloadAbortedError'
  }
}

function abortActiveUpdateDownload(): void {
  updateDownloadAborted = true
  const req = activeUpdateRequest
  activeUpdateRequest = null
  if (req) {
    try {
      req.destroy(new UpdateDownloadAbortedError())
    } catch {
      // ignore
    }
  }
  // 仅中断进行中的下载时删除临时文件；下载完成后保留安装包供「立即安装」使用
  if (updateDownloading && updateDownloadPath) {
    try {
      unlink(updateDownloadPath, () => {})
    } catch {
      // ignore
    }
  }
  updateDownloading = false
}

function sendUpdateToastEvent(channel: string, data?: unknown): void {
  if (updateToastWindow && !updateToastWindow.isDestroyed()) {
    updateToastWindow.webContents.send(channel, data)
  }
}

function closeUpdateToastWindow(): void {
  abortActiveUpdateDownload()
  updateToastReveal = null
  updateToastRevealed = false
  if (!updateToastWindow || updateToastWindow.isDestroyed()) {
    updateToastWindow = null
    repositionToastStack()
    return
  }
  const win = updateToastWindow
  updateToastWindow = null
  // closable:false 时 close() 可能无效；且淡出后实色/半透明壳会残留，必须立刻销毁
  try {
    win.hide()
  } catch {
    // ignore
  }
  try {
    win.destroy()
  } catch {
    // ignore
  }
  repositionToastStack()
}

function slideInWindow(win: BrowserWindow, x: number, targetY: number, startY: number): void {
  win.setPosition(x, startY, false)
  let step = 0
  const steps = 16
  const animate = () => {
    step++
    const t = step / steps
    const eased = 1 - Math.pow(1 - t, 3)
    const curY = Math.round(startY + (targetY - startY) * eased)
    if (!win.isDestroyed()) win.setPosition(x, curY, false)
    if (step < steps) setTimeout(animate, 16)
  }
  animate()
}

function createUpdateToastWindow(info: UpdateInfo): void {
  const display = screen.getPrimaryDisplay()
  const { width: sw, height: sh } = display.workAreaSize
  const hasNotes = Boolean(info.releaseNotes && info.releaseNotes.trim())
  const initialH = hasNotes ? UPDATE_TOAST_EXPANDED_INITIAL : UPDATE_TOAST_COMPACT_HEIGHT
  updateToastCurrentHeight = initialH
  const x = sw - UPDATE_TOAST_WIDTH - TOAST_MARGIN

  if (updateToastWindow && !updateToastWindow.isDestroyed()) {
    sendUpdateToastEvent('update-show', info)
    updateToastRevealed = true
    placeUpdateToastWindow(updateToastWindow, initialH)
    if (!updateToastWindow.isVisible()) updateToastWindow.showInactive()
    updateToastWindow.moveTop()
    return
  }

  const win = new BrowserWindow({
    width: UPDATE_TOAST_WIDTH,
    height: initialH,
    x,
    y: sh + 10,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#1e1f24',
    roundedCorners: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: true,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  const paintChrome = () => {
    void win.webContents.insertCSS(
      'html,body,#root{background:#1e1f24!important;margin:0;padding:0;overflow:hidden;}'
    )
  }
  win.webContents.on('dom-ready', paintChrome)
  paintChrome()

  updateToastWindow = win
  updateToastRevealed = false
  updateToastReveal = () => {
    if (updateToastRevealed || win.isDestroyed()) return
    updateToastRevealed = true
    const h = updateToastCurrentHeight
    const targetY = sh - TOAST_MARGIN - h
    if (!win.isVisible()) win.showInactive()
    win.moveTop()
    slideInWindow(win, x, targetY, sh + 10)
    repositionToastStack()
    console.log(`[UpdateToast] revealed height=${h} targetY=${targetY}`)
  }

  win.on('closed', () => {
    if (updateToastWindow === win) updateToastWindow = null
    updateToastCurrentHeight = UPDATE_TOAST_COMPACT_HEIGHT
    updateToastReveal = null
    updateToastRevealed = false
    abortActiveUpdateDownload()
    repositionToastStack()
  })

  const onDismiss = (event: Electron.IpcMainEvent) => {
    if (event.sender.id !== win.webContents.id) return
    ipcMain.off('update-toast-dismiss', onDismiss)
    closeUpdateToastWindow()
  }
  ipcMain.on('update-toast-dismiss', onDismiss)

  win.webContents.on('did-finish-load', () => {
    win.webContents.send('update-show', info)
    // 兜底：渲染层未回调时仍揭幕
    setTimeout(() => {
      if (!updateToastRevealed && updateToastWindow === win) updateToastReveal?.()
    }, 1500)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/#/update-toast`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'update-toast' })
  }
}

function downloadFileWithProgress(
  url: string,
  dest: string,
  onProgress: (percent: number, receivedBytes: number, totalBytes: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (updateDownloadAborted) {
      reject(new UpdateDownloadAbortedError())
      return
    }

    const file = createWriteStream(dest)
    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }

    const attachReq = (req: http.ClientRequest) => {
      activeUpdateRequest = req
      req.on('error', (err) => {
        if (activeUpdateRequest === req) activeUpdateRequest = null
        settle(() => {
          unlink(dest, () => {})
          reject(updateDownloadAborted || err?.name === 'UpdateDownloadAbortedError'
            ? new UpdateDownloadAbortedError()
            : err)
        })
      })
    }

    const handleResponse = (response: http.IncomingMessage, currentUrl: string) => {
      if (updateDownloadAborted) {
        response.destroy()
        settle(() => {
          unlink(dest, () => {})
          reject(new UpdateDownloadAbortedError())
        })
        return
      }
      if (
        response.statusCode === 301 ||
        response.statusCode === 302 ||
        response.statusCode === 307 ||
        response.statusCode === 308
      ) {
        if (response.headers.location) {
          const nextUrl = new URL(response.headers.location, currentUrl).toString()
          response.resume()
          const getter = nextUrl.startsWith('http://') ? http.get : https.get
          const nextReq = getter(nextUrl, { headers: { 'User-Agent': 'fin-agent-desktop' } }, (res) =>
            handleResponse(res, nextUrl)
          )
          attachReq(nextReq)
          return
        }
      }
      if (response.statusCode !== 200) {
        settle(() => {
          unlink(dest, () => {})
          reject(new Error(`Download failed: HTTP ${response.statusCode}`))
        })
        return
      }

      const totalBytes = parseInt(response.headers['content-length'] || '0', 10)
      let receivedBytes = 0

      response.on('data', (chunk: Buffer) => {
        if (updateDownloadAborted) {
          response.destroy()
          return
        }
        receivedBytes += chunk.length
        const percent = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0
        onProgress(percent, receivedBytes, totalBytes)
      })

      response.pipe(file)

      file.on('finish', () => {
        file.close()
        settle(() => {
          if (updateDownloadAborted) {
            unlink(dest, () => {})
            reject(new UpdateDownloadAbortedError())
          } else {
            resolve()
          }
        })
      })
      file.on('error', (err) => {
        settle(() => {
          unlink(dest, () => {})
          reject(updateDownloadAborted ? new UpdateDownloadAbortedError() : err)
        })
      })
    }

    const getter = url.startsWith('http://') ? http.get : https.get
    const req = getter(url, { headers: { 'User-Agent': 'fin-agent-desktop' } }, (res) =>
      handleResponse(res, url)
    )
    attachReq(req)
  })
}

async function downloadUpdatePackage(
  originalUrl: string,
  dest: string,
  onProgress: (percent: number, receivedBytes: number, totalBytes: number) => void
): Promise<string> {
  let candidates = await getUpdateDownloadCandidates(originalUrl)
  console.log('[Update] download candidates:', candidates)
  let lastError: unknown
  let refreshedOnce = false

  for (let i = 0; i < candidates.length; i++) {
    if (updateDownloadAborted) throw new UpdateDownloadAbortedError()
    const url = candidates[i]
    try {
      await downloadFileWithProgress(url, dest, onProgress)
      console.log('[Update] downloaded via', url)
      return url
    } catch (err) {
      if (updateDownloadAborted || (err as Error)?.name === 'UpdateDownloadAbortedError') {
        throw new UpdateDownloadAbortedError()
      }
      lastError = err
      console.error(`[Update] download failed (${i + 1}/${candidates.length}):`, url, err)
      try {
        unlink(dest, () => {})
      } catch {
        // ignore
      }
      if (!refreshedOnce && i === 0) {
        refreshedOnce = true
        try {
          const refreshed = await getUpdateDownloadCandidates(originalUrl, { forceRefresh: true })
          const failed = new Set([url])
          candidates = [url, ...refreshed.filter((u) => !failed.has(u))]
          // 去重保序
          const seen = new Set<string>()
          candidates = candidates.filter((u) => {
            if (seen.has(u)) return false
            seen.add(u)
            return true
          })
          console.log('[Update] candidates after mirror refresh:', candidates)
        } catch (refreshErr) {
          console.error('[Update] mirror force refresh failed', refreshErr)
        }
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

type UpdateCheckResult =
  | { status: 'available'; version: string; currentVersion: string }
  | { status: 'uptodate'; version: string; currentVersion: string }
  | { status: 'no_asset'; version: string; currentVersion: string }
  | { status: 'error'; error: string }

function checkForUpdates(options?: { showWindow?: boolean }): Promise<UpdateCheckResult> {
  const showWindow = options?.showWindow !== false
  console.log('[Update] Starting update check...')
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: '/repos/YUHAI0/fin-agent-desktop/releases/latest',
        method: 'GET',
        headers: { 'User-Agent': 'fin-agent-desktop' }
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          if (res.statusCode !== 200) {
            const error = `检查失败：HTTP ${res.statusCode}`
            console.error('[Update]', error)
            resolve({ status: 'error', error })
            return
          }
          try {
            const release = JSON.parse(data)
            const latestVersion = String(release.tag_name || '').replace(/^v/, '')
            const currentVersion = getVersion()
            console.log(`[Update] current=${currentVersion}, latest=${latestVersion}`)

            if (!latestVersion) {
              resolve({ status: 'error', error: '未获取到远端版本号' })
              return
            }

            if (compareVersions(latestVersion, currentVersion) <= 0) {
              resolve({ status: 'uptodate', version: latestVersion, currentVersion })
              return
            }

            const assetExt =
              process.platform === 'win32' ? '.exe' : process.platform === 'darwin' ? '.dmg' : ''
            const asset = release.assets?.find((a: any) => a.name.endsWith(assetExt))
            if (!asset?.browser_download_url) {
              console.log('[Update] No suitable asset found')
              resolve({ status: 'no_asset', version: latestVersion, currentVersion })
              return
            }

            const originalDownloadUrl = asset.browser_download_url as string
            pendingUpdate = {
              version: latestVersion,
              tagName: release.tag_name,
              downloadUrl: originalDownloadUrl,
              originalDownloadUrl,
              fileName: asset.name,
              releaseNotes: (release.body || '').slice(0, 2500)
            }

            void getUpdateDownloadCandidates(originalDownloadUrl)
              .then((urls) => {
                if (
                  pendingUpdate &&
                  pendingUpdate.originalDownloadUrl === originalDownloadUrl &&
                  urls[0]
                ) {
                  pendingUpdate.downloadUrl = urls[0]
                }
              })
              .catch((err) => console.error('[Update] mirror warm-up failed', err))

            if (showWindow) {
              createUpdateToastWindow(pendingUpdate)
              console.log(`[Update] Showing update window for v${latestVersion}`)
            }
            resolve({ status: 'available', version: latestVersion, currentVersion })
          } catch (e) {
            console.error('[Update] Parse error', e)
            resolve({ status: 'error', error: e instanceof Error ? e.message : String(e) })
          }
        })
      }
    )
    req.on('error', (e) => {
      console.error('[Update] Check failed', e)
      resolve({ status: 'error', error: e.message || String(e) })
    })
    req.setTimeout(15000, () => {
      req.destroy()
      resolve({ status: 'error', error: '检查超时，请稍后重试' })
    })
    req.end()
  })
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function isAppInternalNavigation(url: string): boolean {
  const renderer = process.env['ELECTRON_RENDERER_URL']
  if (renderer && url.startsWith(renderer)) return true
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'file:') return false
    const pathName = decodeURIComponent(parsed.pathname).replace(/\\/g, '/')
    return pathName.endsWith('/index.html') || pathName.endsWith('index.html')
  } catch {
    return false
  }
}

function openHttpExternal(url: string): Promise<void> {
  if (!isHttpUrl(url)) return Promise.resolve()
  return shell.openExternal(url).catch((err) => {
    console.error('[Main] openExternal failed:', url, err)
  })
}

function attachExternalLinkGuard(contents: Electron.WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    void openHttpExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (isAppInternalNavigation(url)) return
    event.preventDefault()
    void openHttpExternal(url)
  })
}

app.on('web-contents-created', (_event, contents) => {
  attachExternalLinkGuard(contents)
})

app.whenReady().then(() => {
  electronApp.setAppUserModelId(APP_USER_MODEL_ID)
  ensureWindowsToastShortcut()
  initUpdateMirror(app.getPath('userData'))

  if (!Notification.isSupported()) {
    console.warn('[Notification] System notifications are not supported on this platform')
  }

  if (!app.getLoginItemSettings().openAtLogin) {
    app.setLoginItemSettings({ openAtLogin: true })
  }

  // 禁用应用菜单栏
  Menu.setApplicationMenu(null)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
    // 确保所有新创建的窗口都禁用菜单栏
    window.setMenuBarVisibility(false)
    window.setMenu(null)
  })

  setupLogging()
  loadSeenNotifications()

  startPythonServer()
  createChatWindow()
  createTray()

  // 启动时显示主界面（聊天窗口）
  if (chatWindow) {
    // 立即显示窗口，即使内容还在加载
    chatWindow.show()
    chatWindow.focus()
    console.log('[Main] Main window displayed on startup')
    
    // 确保窗口在内容加载完成后获得焦点
    chatWindow.webContents.once('did-finish-load', () => {
      chatWindow?.focus()
    })
  }

  // Polling for API readiness and config check
  const checkConfigLoop = async () => {
    let attempts = 0
    while (attempts < 30) {
      try {
        const config = await makeApiRequestRaw('/config')

        if (!serverReady) {
          serverReady = true
          serverReadyResolve?.()
          console.log('[Main] Python server is ready')
        }

        if (config && config.wake_up_shortcut) {
            registerGlobalShortcut(config.wake_up_shortcut)
        } else {
            registerGlobalShortcut('Ctrl+Alt+Q')
        }

        const res = await makeApiRequestRaw('/config/check')
        if (res && res.configured === false) {
          console.log('[Main] Config missing, but allowing user to see main interface first')
        } else {
          console.log('[Main] Config check passed')
        }
        break; 
      } catch (e) {
        await new Promise(r => setTimeout(r, 1000))
        attempts++
      }
    }
    if (!serverReady) {
      console.error('[Main] Python server failed to start after 30 seconds')
      serverReady = true
      serverReadyResolve?.()
    }
  }
  
  // Start checking slightly after startup to let Python init
  setTimeout(checkConfigLoop, 1000)

  // Initial update check
  void checkForUpdates()
  // Check updates every 4 hours
  setInterval(() => void checkForUpdates(), 4 * 60 * 60 * 1000)

  // Poll for desktop notifications from scheduler
  const pollNotifications = async () => {
    try {
      const res = await makeApiRequest('/notifications/poll')
      if (res && res.notifications && Array.isArray(res.notifications)) {
        res.notifications.forEach((notif: DesktopNotificationPayload) => {
          const ids = [
            ...new Set([
              ...(notif.notification_ids || []),
              ...(notif.notification_id ? [notif.notification_id] : [])
            ].filter(Boolean))
          ]

          if (ids.length > 0 && ids.some((id) => inFlightNotificationIds.has(id))) {
            // 上一轮已经在构造/等待展示确认：既不重复构造，也绝不能 ACK
            // ——展示结果（show/failed）还没揭晓，交给对应事件处理器决定
            return
          }

          if (isNotificationSeen(ids)) {
            // 之前已经确认展示过（本次运行内 show 过，或持久化记录跨重启命中）：
            // 不再弹窗。若上次展示后的同步落盘失败，必须先重试持久化；
            // 只有持久化成功才 ACK，避免进程在 ACK 后崩溃导致跨重启丢失幂等记录。
            const persisted = persistSeenNotificationsNow()
            if (persisted && notif.ack_required) {
              void ackNotifications(ids, notif.news_ids?.length ? notif.news_ids : notif.news_id)
            }
            return
          }

          if (ids.length > 0) {
            ids.forEach((id) => inFlightNotificationIds.add(id))
          }

          const title = notif.title || 'Fin-Agent 提醒'
          const body = notif.body || ''
          console.log(
            `[Toast] poll hit type=${notif.type || ''} title="${title}" ids=${JSON.stringify(ids)} ack=${!!notif.ack_required}`
          )

          // 测试推送的 app_update：写入 pendingUpdate 并直接打开更新窗（不走飞书 Toast）
          if (notif.type === 'app_update') {
            const update = notif.update
            if (update?.version) {
              const downloadUrl =
                update.downloadUrl || 'https://example.com/Fin-Agent-test.exe'
              pendingUpdate = {
                version: update.version || '9.9.9',
                tagName: update.tagName || `v${update.version || '9.9.9'}`,
                downloadUrl,
                originalDownloadUrl: update.originalDownloadUrl || downloadUrl,
                fileName: update.fileName || `Fin-Agent-${update.version || '9.9.9'}-test.exe`,
                releaseNotes:
                  update.releaseNotes || body || '发现新版本，点击通知后可下载安装。'
              }
              if (ids.length > 0) {
                markNotificationsSeen(ids)
                persistSeenNotificationsNow()
                if (notif.ack_required) {
                  void ackNotifications(ids, notif.news_ids?.length ? notif.news_ids : notif.news_id)
                }
                ids.forEach((id) => inFlightNotificationIds.delete(id))
              }
              createUpdateToastWindow(pendingUpdate)
              console.log(`[Update] test app_update → update window v${pendingUpdate.version}`)
            } else if (ids.length > 0) {
              ids.forEach((id) => inFlightNotificationIds.delete(id))
            }
            return
          }

          // 应用内浮窗（飞书式），不依赖系统通知权限；
          // 等渲染层 toast-shown 后再 ACK，避免空白窗假成功
          createToastWindow(
            { ...notif, _title: title, _body: body },
            ids,
            {
              newsIds: notif.news_ids?.length ? notif.news_ids : notif.news_id,
              ackRequired: notif.ack_required
            }
          )
        })
      }
    } catch (e) {
      // API might not be ready yet, ignore errors
    }
  }

  // Poll for notifications every 2 seconds
  setInterval(pollNotifications, 2000)

  // 后台低频清理过期的 seen 记录（非关键路径，允许防抖落盘）
  setInterval(pruneExpiredSeenNotifications, 10 * 60 * 1000)

  // IPC handlers for config
  ipcMain.handle('suspend-shortcut', () => {
      console.log('[Main] Suspending global shortcut')
      globalShortcut.unregisterAll()
  })

  ipcMain.handle('resume-shortcut', () => {
      console.log('[Main] Resuming global shortcut:', currentGlobalShortcut)
      if (currentGlobalShortcut) {
          registerGlobalShortcut(currentGlobalShortcut)
      }
  })

  ipcMain.handle('check-shortcut', (_, shortcut) => {
      try {
          if (globalShortcut.isRegistered(shortcut)) {
             // If we already registered it (e.g. current one), it returns true.
             // But if we suspended, it should be gone.
             return false
          }
          const ret = globalShortcut.register(shortcut, () => {})
          if (ret) {
              globalShortcut.unregister(shortcut)
              return true
          }
          return false
      } catch (err) {
          console.error('Error checking shortcut:', err)
          return false
      }
  })

  ipcMain.handle('check-config', async () => {
    return await makeApiRequest('/config/check')
  })

  ipcMain.handle('get-config', async () => {
    return await makeApiRequest('/config')
  })

  ipcMain.handle('list-local-models', async (_e, payload: { backend?: string; base_url?: string; api_key?: string }) => {
    const params = new URLSearchParams()
    if (payload?.backend) params.set('backend', payload.backend)
    if (payload?.base_url) params.set('base_url', payload.base_url)
    if (payload?.api_key) params.set('api_key', payload.api_key)
    const qs = params.toString()
    return makeApiRequest(`/config/local-models${qs ? `?${qs}` : ''}`)
  })

  ipcMain.handle('get-profile', async () => {
    return await makeApiRequest('/profile')
  })

  ipcMain.handle('save-profile', async (_, data) => {
    return await makeApiRequest('/profile', 'POST', data)
  })

  ipcMain.handle('skip-onboarding', () => {
    markOnboardingStatus('skipped')
    return { success: true }
  })
  ipcMain.handle('complete-onboarding', () => {
    markOnboardingStatus('completed')
    return { success: true }
  })

  ipcMain.handle('open-external', async (_, url: string) => {
    const target = typeof url === 'string' ? url.trim() : ''
    if (!target) {
      return { success: false, error: '链接为空' }
    }
    if (!isHttpUrl(target)) {
      console.error('[Main] open-external rejected invalid or disallowed URL:', target)
      return { success: false, error: '只允许打开 http/https 链接' }
    }
    try {
      await shell.openExternal(target)
      return { success: true }
    } catch (e) {
      console.error('[Main] open-external failed:', e)
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('save-config', async (_, data) => {
    // Update shortcut immediately if present
    if (data.wake_up_shortcut) {
        registerGlobalShortcut(data.wake_up_shortcut)
    }
    return await makeApiRequest('/config/save', 'POST', data)
  })

  ipcMain.on('open-settings', () => {
    if (chatWindow) {
      chatWindow.show()
      chatWindow.focus()
      chatWindow.webContents.send('navigate-route', '/config')
    }
  })

  // Initial shortcut registration (temporary default until config loads)
  // We'll try to register the default one immediately, then update it when config loads
  registerGlobalShortcut('Ctrl+Alt+Q')
  
  // Clean up on exit
  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    persistSeenNotificationsNow()
  })

  type NewsCardPayload = {
    intent: 'interpret' | 'portfolio_impact' | 'next_actions' | 'related_stocks'
    news: {
      id: string
      title: string
      summary: string
      url: string
      source: string
      published_at: string
      sentiment?: string | null
      matched_symbols: string[]
    }
  }

  ipcMain.on('submit-input', async (_, text, sessionId?: string, newsCard?: NewsCardPayload) => {
    console.log('[Main] Received submit-input:', text)

    const trimmed = (text || '').trim()
    const hasNewsCard = newsCard != null && typeof newsCard === 'object'
    const message = trimmed || (hasNewsCard ? '请解读这条新闻' : '')
    if (!message) {
      return
    }
    
    // Check config before processing
    try {
      const configStatus = await makeApiRequest('/config/check')
      if (!configStatus || !configStatus.configured) {
        console.log('[Main] Config not configured, redirecting to config page')
        if (chatWindow) {
          chatWindow.show()
          chatWindow.focus()
          chatWindow.webContents.send('navigate-route', '/config')
        }
        return
      }
    } catch (err) {
      console.error('[Main] Config check failed:', err)
      // If check fails, assume not configured and redirect
      if (chatWindow) {
        chatWindow.show()
        chatWindow.focus()
        chatWindow.webContents.send('navigate-route', '/config')
      }
      return
    }
    
    if (chatWindow) {
      chatWindow.show()
      chatWindow.focus()
      chatWindow.webContents.send('new-message', { text: message, sessionId, newsCard })

      const reqKey = streamRequestKey(sessionId)
      const tagStream = (payload: Record<string, unknown>) => {
        if (chatWindow) {
          chatWindow.webContents.send('bot-stream', { ...payload, sessionId })
        }
      }

      try {
        console.log('[Main] Sending POST to http://127.0.0.1:5678/chat')

        const postBody: Record<string, unknown> = { message, session_id: sessionId }
        if (hasNewsCard) {
          postBody.news_card = newsCard
        }
        const postData = JSON.stringify(postBody)
        console.log('[Main] POST data:', postData)
        console.log('[Main] POST data length:', Buffer.byteLength(postData))

        const options: http.RequestOptions = {
          hostname: '127.0.0.1',
          port: 5678,
          path: '/chat',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
            'Connection': 'close'  // Don't reuse connection for SSE streams
          },
          // No timeout - streaming responses can take as long as needed
          timeout: 0
        }

        console.log('[Main] Request options:', JSON.stringify(options, null, 2))

        let req: http.ClientRequest

        const flushEvent = (eventText: string) => {
          // Normalize newlines
          const lines = eventText.split('\n')
          const dataPayloads: string[] = []

          for (const rawLine of lines) {
            const line = rawLine.trimEnd()
            if (!line) continue
            // Ignore comments / other SSE fields for now (event:, id:, retry:)
            if (line.startsWith('data:')) {
              // "data:" or "data: "
              const value = line.slice(5).replace(/^\s/, '')
              dataPayloads.push(value)
            }
          }

          if (dataPayloads.length === 0) return

          // SSE 允许同一事件内多行 data:；用 \n 拼成一串再 JSON.parse 会得到非法 JSON，
          // 导致多条 tool_result 等事件丢失，前端只看到「一条」。
          for (const value of dataPayloads) {
            if (value === '[DONE]') {
              console.log('[Main] Received [DONE], sending finish event to renderer')
              if (activeRequests.get(reqKey) === req) {
                activeRequests.delete(reqKey)
              }
              tagStream({ type: 'finish' })
              console.log('[Main] Finish event sent to renderer')
              continue
            }

            try {
              const data = JSON.parse(value)
              tagStream(data)
            } catch (e) {
              console.error('Error parsing SSE data line:', e, value)
            }
          }
        }

        req = http.request(options, (res) => {
          console.log('[Main] Response status:', res.statusCode)
          console.log('[Main] Response headers:', JSON.stringify(res.headers, null, 2))

          if (res.statusCode !== 200) {
            console.error('[Main] Non-200 status code received')
            if (activeRequests.get(reqKey) === req) {
              activeRequests.delete(reqKey)
            }
            throw new Error(`HTTP error! status: ${res.statusCode}`)
          }

          let buffer = ''

          res.setEncoding('utf8')

          res.on('data', (chunk: string) => {
            buffer += chunk
            // Handle CRLF just in case
            buffer = buffer.replace(/\r\n/g, '\n')

            let idx: number
            while ((idx = buffer.indexOf('\n\n')) !== -1) {
              const eventText = buffer.slice(0, idx)
              buffer = buffer.slice(idx + 2)
              flushEvent(eventText)
            }
          })

          res.on('end', () => {
            // Flush any trailing event without the final separator (best-effort)
            if (buffer.trim()) {
              flushEvent(buffer)
            }
            console.log('[Main] Response stream ended')
            if (activeRequests.get(reqKey) === req) {
              activeRequests.delete(reqKey)
            }
            userStoppedKeys.delete(reqKey)
          })

          res.on('error', (err) => {
            if (activeRequests.get(reqKey) === req) {
              activeRequests.delete(reqKey)
            }
            // 如果是用户主动停止，静默处理，不打印任何日志
            if (!userStoppedKeys.has(reqKey)) {
              console.error('[Main] Response stream error:', err)
              tagStream({ type: 'error', content: `Stream error: ${err.message}` })
            }
            userStoppedKeys.delete(reqKey)
          })
        })

        // 按会话保存请求引用，支持多标签并行
        activeRequests.set(reqKey, req)

        req.on('error', (err: any) => {
          if (activeRequests.get(reqKey) === req) {
            activeRequests.delete(reqKey)
          }
          // ECONNRESET 和 EPIPE 是正常的，当进程关闭时连接会断开
          if (err.code === 'ECONNRESET' || err.code === 'EPIPE') {
            // 如果是用户主动停止，不打印日志
            if (!userStoppedKeys.has(reqKey)) {
              console.log('[Main] Request connection closed (process terminated)')
            }
          } else if (err.code === 'ECONNABORTED' || err.message === 'aborted' || err.message?.includes('aborted')) {
            // 用户主动停止，不打印错误日志
            // 静默处理，不打印任何日志
          } else {
            // 如果是用户主动停止，不显示错误
            if (!userStoppedKeys.has(reqKey)) {
              console.error('[Main] Request error:', err)
              console.error('[Main] Error code:', err.code)
              console.error('[Main] Error stack:', err.stack)
              tagStream({ type: 'error', content: `Request error: ${err.message}` })
            }
          }
          userStoppedKeys.delete(reqKey)
        })

        req.on('socket', (socket) => {
          console.log('[Main] Socket assigned')
          socket.on('connect', () => {
            console.log('[Main] Socket connected')
          })
          socket.on('error', (err: any) => {
            // ECONNRESET 是正常的，当进程关闭时连接会断开
            if (err.code === 'ECONNRESET' || err.code === 'EPIPE') {
              console.log('[Main] Socket closed (process terminated)')
            } else {
              console.error('[Main] Socket error:', err)
            }
          })
          socket.on('close', () => {
            console.log('[Main] Socket closed')
          })
        })

        // Write data to request body
        console.log('[Main] Writing request body...')
        req.write(postData)
        console.log('[Main] Ending request...')
        req.end()
        console.log('[Main] Request sent')

      } catch (err) {
        console.error('[Main] API Error:', err)
        console.error('[Main] Error stack:', (err as Error).stack)
        activeRequests.delete(reqKey)
        tagStream({ type: 'error', content: `Error: ${err}` })
      }
    }
  })

  // 停止生成处理器（可按 sessionId 停止单个会话的流）
  ipcMain.on('stop-generation', (_e, sessionId?: string) => {
    console.log('[Main] Received stop-generation request', sessionId)
    const keys = sessionId
      ? [streamRequestKey(sessionId)]
      : [...activeRequests.keys()]
    let stopped = false
    for (const key of keys) {
      const active = activeRequests.get(key)
      if (!active) continue
      console.log('[Main] Aborting request:', key)
      userStoppedKeys.add(key)
      active.destroy()
      activeRequests.delete(key)
      if (chatWindow) {
        const sid = key === '__default__' ? undefined : key
        chatWindow.webContents.send('bot-stream', { type: 'finish', sessionId: sid })
      }
      stopped = true
    }
    if (!stopped) {
      console.log('[Main] No active request to stop')
    }
  })

  ipcMain.handle('get-version', () => {
    return getVersion()
  })

  // ── 应用内更新 IPC ─────────────────────────────────────────────────────────
  ipcMain.handle('get-pending-update', () => pendingUpdate)

  ipcMain.handle('check-for-updates', async () => checkForUpdates({ showWindow: true }))

  ipcMain.handle('resize-update-toast', (_e, height: number) => {
    if (!updateToastWindow || updateToastWindow.isDestroyed()) return { success: false }
    placeUpdateToastWindow(updateToastWindow, height)
    return { success: true, height: updateToastCurrentHeight }
  })

  ipcMain.on('update-toast-ready', (event) => {
    if (!updateToastWindow || updateToastWindow.isDestroyed()) return
    if (event.sender.id !== updateToastWindow.webContents.id) return
    updateToastReveal?.()
  })

  ipcMain.handle('resize-toast', (event, height: number, variant?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return { success: false }
    const entry = toastStack.find((t) => t.win === win)
    if (!entry) return { success: false }
    const isNews = entry.width >= TOAST_NEWS_WIDTH - 1
    const isPriceAlert = variant === 'price_alert'
    const minH = isNews ? TOAST_NEWS_MIN_HEIGHT : 72
    const maxH = isNews
      ? TOAST_NEWS_MAX_HEIGHT
      : isPriceAlert
        ? TOAST_PRICE_ALERT_MAX_HEIGHT
        : TOAST_HEIGHT + 24
    const h = Math.max(minH, Math.min(maxH, Math.round(Number(height) || minH)))
    if (Math.abs((entry.height || 0) - h) <= 1) {
      return { success: true, height: entry.height }
    }
    entry.height = h
    repositionToastStack()
    console.log(`[Toast] resize id=${event.sender.id} height=${h}`)
    return { success: true, height: h }
  })

  ipcMain.handle('get-pending-toast', (event) => {
    const entry = pendingToasts.get(event.sender.id)
    return entry?.payload ?? null
  })

  ipcMain.on('focus-main-prefill', (_event, text: string) => {
    const value = typeof text === 'string' ? text.trim() : ''
    if (!value) return
    if (!focusChatWindow() || !chatWindow) return
    chatWindow.webContents.send('chat-prefill', value)
  })

  ipcMain.on('toast-shown', (event) => {
    const entry = pendingToasts.get(event.sender.id)
    if (!entry) return
    // 先揭幕再标记 delivered，保证只滑入一次
    if (!entry.revealed) {
      entry.reveal?.()
    }
    if (entry.delivered) return
    entry.delivered = true
    console.log(
      `[Toast] shown confirmed id=${event.sender.id} title="${entry.payload._title}"`
    )
    const ids = entry.notificationIds
    if (ids.length > 0) {
      ids.forEach((id) => inFlightNotificationIds.delete(id))
      confirmNotificationDelivery(ids, {
        ...entry.payload,
        ack_required: entry.ackRequired,
        news_id: Array.isArray(entry.newsIds) ? entry.newsIds[0] : entry.newsIds,
        news_ids: Array.isArray(entry.newsIds)
          ? entry.newsIds
          : entry.newsIds
            ? [entry.newsIds]
            : undefined
      })
    }
  })

  ipcMain.handle('set-toast-chrome', (event, theme?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return { success: false }
    const light = theme === 'light'
    const bg = light ? '#ffffff' : '#1e1f24'
    try {
      win.setBackgroundColor(bg)
    } catch {
      // ignore
    }
    void win.webContents.insertCSS(
      `html,body,#root{background:${bg}!important;margin:0;padding:0;overflow:hidden;}`
    )
    return { success: true, background: bg }
  })

  // 开发期：手动触发一条测试浮窗，便于验证显示链路
  ipcMain.handle('debug-show-toast', () => {
    const id = `debug_toast_${Date.now()}`
    createToastWindow(
      {
        notification_id: id,
        type: 'price_alert',
        title: '测试桌面通知',
        body: '如果你能看到这条，飞书式浮窗已生效',
        _title: '测试桌面通知',
        _body: '如果你能看到这条，飞书式浮窗已生效'
      },
      [id],
      { ackRequired: false }
    )
    return { success: true, id }
  })

  ipcMain.handle('start-update-download', async () => {
    if (!pendingUpdate) return { error: '没有待更新版本' }
    if (updateDownloading) return { error: '已在下载中' }
    updateDownloading = true
    updateDownloadAborted = false
    const safeName = (pendingUpdate.fileName || 'Fin-Agent-update.exe').replace(/[^\w.\-]+/g, '_')
    updateDownloadPath = join(
      app.getPath('temp'),
      `fa-update-${Date.now()}-${process.pid}-${safeName}`
    )
    const originalUrl = pendingUpdate.originalDownloadUrl || pendingUpdate.downloadUrl
    try {
      const usedUrl = await downloadUpdatePackage(
        originalUrl,
        updateDownloadPath,
        (percent, received, total) => {
          if (!updateDownloadAborted) {
            sendUpdateToastEvent('update-download-progress', { percent, received, total })
          }
        }
      )
      if (updateDownloadAborted) {
        updateDownloading = false
        return { error: '下载已取消', cancelled: true }
      }
      if (pendingUpdate) pendingUpdate.downloadUrl = usedUrl
      updateDownloading = false
      activeUpdateRequest = null
      sendUpdateToastEvent('update-download-done')
      return { success: true }
    } catch (err: any) {
      const cancelled =
        updateDownloadAborted ||
        err?.name === 'UpdateDownloadAbortedError' ||
        String(err?.message || err).includes('下载已取消')
      updateDownloading = false
      activeUpdateRequest = null
      if (cancelled) {
        console.log('[Update] download cancelled by user')
        return { error: '下载已取消', cancelled: true }
      }
      sendUpdateToastEvent('update-download-error', String(err?.message ?? err))
      return { error: String(err?.message ?? err) }
    }
  })

  ipcMain.handle('install-update', async () => {
    if (!updateDownloadPath) {
      return { error: '安装包不存在，请重新下载' }
    }
    if (!existsSync(updateDownloadPath)) {
      updateDownloadPath = ''
      return { error: '安装包已失效，请重新下载' }
    }
    installingUpdate = true
    killPythonProcess()
    const installerPath = updateDownloadPath
    try {
      if (process.platform === 'darwin') {
        const err = await shell.openPath(installerPath)
        if (err) throw new Error(err)
      } else if (process.platform === 'win32') {
        const err = await shell.openPath(installerPath)
        if (err) {
          await new Promise<void>((resolve, reject) => {
            try {
              const sub = spawn(installerPath, [], {
                detached: true,
                stdio: 'ignore',
                windowsHide: false
              })
              sub.on('error', reject)
              sub.unref()
              resolve()
            } catch (spawnErr) {
              reject(spawnErr)
            }
          })
        }
      } else {
        await new Promise<void>((resolve, reject) => {
          try {
            const sub = spawn(installerPath, [], { detached: true, stdio: 'ignore' })
            sub.on('error', reject)
            sub.unref()
            resolve()
          } catch (spawnErr) {
            reject(spawnErr)
          }
        })
      }
      console.log('[Update] installer launched:', installerPath)
      setTimeout(() => app.exit(0), 400)
      return { success: true }
    } catch (err: any) {
      installingUpdate = false
      const msg = String(err?.message ?? err)
      console.error('[Update] install failed:', msg)
      return { error: `无法启动安装程序：${msg}` }
    }
  })

  ipcMain.handle('set-title-bar-theme', (_e, theme: 'dark' | 'light') => {
    applyTitleBarTheme(chatWindow, theme === 'light' ? 'light' : 'dark')
  })

  ipcMain.handle('get-config-dir', () => {
    return join(app.getPath('appData'), 'fin-agent')
  })

  ipcMain.handle('list-scheduler-tasks', async () => {
    try {
      return await makeApiRequest('/scheduler/tasks')
    } catch (e) {
      console.error('[Main] list-scheduler-tasks failed:', e)
      return { error: String(e) }
    }
  })

  ipcMain.handle('remove-scheduler-task', async (_, taskId: string) => {
    try {
      return await makeApiRequest('/scheduler/tasks/remove', 'POST', { task_id: taskId })
    } catch (e) {
      console.error('[Main] remove-scheduler-task failed:', e)
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('create-price-alert-pct', async (
    _,
    payload: { ts_code: string; direction: 'up' | 'down'; pct: number; email?: string }
  ) => {
    try {
      return await makeApiRequest('/scheduler/tasks/price-alert-pct', 'POST', payload)
    } catch (e) {
      console.error('[Main] create-price-alert-pct failed:', e)
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('list-alert-history', async () => {
    try {
      return await makeApiRequest('/scheduler/alert-history')
    } catch (e) {
      console.error('[Main] list-alert-history failed:', e)
      return { error: String(e) }
    }
  })

  ipcMain.handle('list-news-subscriptions', async (
    _e,
    filters?: { enabled?: boolean; type?: string }
  ) => {
    const params = new URLSearchParams()
    if (filters?.enabled !== undefined) params.set('enabled', String(filters.enabled))
    if (filters?.type) params.set('type', filters.type)
    const query = params.toString()
    return makeApiRequest(`/news/subscriptions${query ? `?${query}` : ''}`)
  })

  ipcMain.handle('create-news-subscription', async (_e, payload: unknown) =>
    makeApiRequest('/news/subscriptions/create', 'POST', payload)
  )

  ipcMain.handle('update-news-subscription', async (_e, id: string, payload: unknown) =>
    makeApiRequest('/news/subscriptions/update', 'POST', {
      ...(payload as Record<string, unknown>),
      id
    })
  )

  ipcMain.handle('delete-news-subscription', async (_e, id: string) =>
    makeApiRequest('/news/subscriptions/delete', 'POST', { id })
  )

  ipcMain.handle('toggle-news-subscription', async (_e, id: string, enabled: boolean) =>
    makeApiRequest('/news/subscriptions/toggle', 'POST', { id, enabled })
  )

  ipcMain.handle('list-news', async (
    _e,
    filters?: {
      page?: number
      pageSize?: number
      unread?: boolean
      type?: string
      source?: string
      symbol?: string
      query?: string
      subscriptionId?: string
      newsId?: string
    }
  ) => {
    const params = new URLSearchParams()
    params.set('page', String(filters?.page ?? 1))
    params.set('page_size', String(filters?.pageSize ?? 50))
    if (filters?.unread !== undefined) params.set('unread', String(filters.unread))
    if (filters?.type) params.set('type', filters.type)
    if (filters?.source) params.set('source', filters.source)
    if (filters?.symbol) params.set('symbol', filters.symbol)
    if (filters?.query) params.set('query', filters.query)
    if (filters?.subscriptionId) params.set('subscription_id', filters.subscriptionId)
    if (filters?.newsId) params.set('id', filters.newsId)
    return makeApiRequest(`/news?${params.toString()}`)
  })

  ipcMain.handle('get-news-unread-count', async () =>
    makeApiRequest('/news/unread-count')
  )

  ipcMain.handle('mark-news-read', async (_e, id: string, read: boolean = true) =>
    makeApiRequest('/news/mark-read', 'POST', { id, read })
  )

  ipcMain.handle('mark-news-read-batch', async (_e, ids: string[], read: boolean = true) =>
    makeApiRequest('/news/mark-read-batch', 'POST', { ids, read })
  )

  ipcMain.handle('mark-all-news-read', async () =>
    makeApiRequest('/news/mark-all-read', 'POST', {})
  )

  ipcMain.handle('clear-news', async () =>
    makeApiRequest('/news/clear', 'POST', {})
  )

  ipcMain.handle('get-news-monitor-status', async () =>
    makeApiRequest('/news/monitor/status')
  )

  ipcMain.handle('refresh-news', async () =>
    makeApiRequest('/news/refresh', 'POST', {})
  )

  ipcMain.handle('list-sessions', async (_e, offset: number, limit: number) => {
    return makeApiRequest(`/sessions?offset=${offset ?? 0}&limit=${limit ?? 30}`)
  })

  ipcMain.handle('get-session', async (_e, id: string) => {
    return makeApiRequest(`/sessions/detail?id=${encodeURIComponent(id)}`)
  })

  ipcMain.handle('create-session', async (_e, title?: string) => {
    return makeApiRequest('/sessions/create', 'POST', { title })
  })

  ipcMain.handle('delete-session', async (_e, id: string) => {
    return makeApiRequest('/sessions/delete', 'POST', { id })
  })

  ipcMain.handle('rename-session', async (_e, id: string, title: string) => {
    return makeApiRequest('/sessions/rename', 'POST', { id, title })
  })

  ipcMain.handle('pin-session', async (_e, id: string, pinned: boolean) => {
    return makeApiRequest('/sessions/pin', 'POST', { id, pinned })
  })

  ipcMain.handle('search-sessions', async (_e, keyword: string) => {
    return makeApiRequest('/sessions/search', 'POST', { keyword })
  })

  ipcMain.handle('save-session-ui', async (_e, id: string, uiMessages: unknown[]) => {
    return makeApiRequest('/sessions/ui', 'POST', { id, ui_messages: uiMessages })
  })

  ipcMain.handle('list-portfolios', async () => makeApiRequest('/portfolio/list'))

  ipcMain.handle('get-dashboard-summary', async (_e, portfolioId?: string) => {
    const q = portfolioId ? `?portfolio_id=${encodeURIComponent(portfolioId)}` : ''
    return makeApiRequest(`/dashboard/summary${q}`)
  })

  ipcMain.handle('set-active-portfolio', async (_e, id: string) =>
    makeApiRequest('/portfolio/active', 'POST', { id })
  )

  ipcMain.handle('generate-dashboard-comment', async (_e, payload: unknown) =>
    makeApiRequest('/dashboard/comment', 'POST', payload)
  )

  ipcMain.handle('list-analysis-favorites', async () =>
    makeApiRequest('/reports/favorites')
  )

  ipcMain.handle('list-watchlist', async () => makeApiRequest('/watchlist'))

  ipcMain.handle('get-watchlist-status', async (_e, tsCode: string) =>
    makeApiRequest(`/watchlist/status?ts_code=${encodeURIComponent(tsCode)}`)
  )

  ipcMain.handle('add-watchlist', async (_e, payload: unknown) =>
    makeApiRequest('/watchlist/add', 'POST', payload)
  )

  ipcMain.handle('set-watchlist-group', async (_e, payload: unknown) =>
    makeApiRequest('/watchlist/group', 'POST', payload)
  )

  ipcMain.handle('set-watchlist-alert-pct', async (_e, payload: unknown) =>
    makeApiRequest('/watchlist/alert-pct', 'POST', payload)
  )

  ipcMain.handle('remove-watchlist', async (_e, id: string) =>
    makeApiRequest('/watchlist/remove', 'POST', { id })
  )

  ipcMain.handle('save-analysis-favorite', async (_e, payload: unknown) =>
    makeApiRequest('/reports/favorites', 'POST', payload)
  )

  ipcMain.handle('delete-analysis-favorite', async (_e, id: string) =>
    makeApiRequest('/reports/favorites', 'DELETE', { id })
  )

  ipcMain.handle('get-portfolio-detail', async (_e, id?: string) =>
    makeApiRequest(`/portfolio/detail${id ? `?id=${encodeURIComponent(id)}` : ''}`)
  )

  ipcMain.handle('create-portfolio', async (_e, name: string) =>
    makeApiRequest('/portfolio/create', 'POST', { name })
  )

  ipcMain.handle('rename-portfolio', async (_e, id: string, name: string) =>
    makeApiRequest('/portfolio/rename', 'POST', { id, name })
  )

  ipcMain.handle('delete-portfolio', async (_e, id: string) =>
    makeApiRequest('/portfolio/delete', 'POST', { id })
  )

  ipcMain.handle('add-position', async (_e, payload: unknown) =>
    makeApiRequest('/portfolio/position/add', 'POST', payload)
  )

  ipcMain.handle('update-position', async (_e, payload: unknown) =>
    makeApiRequest('/portfolio/position/update', 'POST', payload)
  )

  ipcMain.handle('delete-position', async (_e, id: string | undefined, tsCode: string) =>
    makeApiRequest('/portfolio/position/delete', 'POST', { id, ts_code: tsCode })
  )

  ipcMain.handle('search-stocks', async (_e, q: string) =>
    makeApiRequest(`/market/search?q=${encodeURIComponent(q || '')}`)
  )
  ipcMain.handle('get-stock-quote', async (_e, tsCode: string) =>
    makeApiRequest(`/market/quote?ts_code=${encodeURIComponent(tsCode || '')}`)
  )
  ipcMain.handle('get-stock-kline', async (_e, tsCode: string, period?: string) =>
    makeApiRequest(
      `/market/kline?ts_code=${encodeURIComponent(tsCode || '')}&period=${encodeURIComponent(period || '6M')}`
    )
  )
  ipcMain.handle('get-stock-valuation', async (_e, tsCode: string) =>
    makeApiRequest(`/market/valuation?ts_code=${encodeURIComponent(tsCode || '')}`)
  )
  ipcMain.handle('get-stock-financials', async (_e, tsCode: string) =>
    makeApiRequest(`/market/financials?ts_code=${encodeURIComponent(tsCode || '')}`)
  )
  ipcMain.handle('get-stock-moneyflow', async (_e, tsCode: string) =>
    makeApiRequest(`/market/moneyflow?ts_code=${encodeURIComponent(tsCode || '')}`)
  )

  ipcMain.handle('get-auto-launch', () => {
    const settings = app.getLoginItemSettings()
    return settings.openAtLogin
  })

  ipcMain.handle('set-auto-launch', (_, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled })
    return app.getLoginItemSettings().openAtLogin
  })

  // 重置对话上下文（保留 IPC 兼容，快捷键逻辑已不再依赖此标志）
  ipcMain.on('reset-conversation-context', () => {
    console.log('[Main] reset-conversation-context (no-op)')
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createChatWindow()
    }
  })
})

// 终止 Python 进程的函数（带优雅关闭尝试）
function killPythonProcess() {
  // 防止重复执行清理
  if (isCleaningUp) {
    return
  }
  
  if (pyProc && pyProc.pid) {
    isCleaningUp = true
    const pid = pyProc.pid  // 保存 PID，避免空值检查问题
    console.log('[Cleanup] Terminating Python process (PID:', pid, ')...')
    
    try {
      // 方法1: 先尝试发送 SIGTERM 让进程优雅退出
      if (process.platform === 'win32') {
        // Windows: 先尝试温和的终止（抑制错误输出）
        try {
          execSync(`taskkill /pid ${pid} /t`, { 
            timeout: 2000,
            stdio: 'ignore'  // 抑制所有输出，包括错误信息
          })
          console.log('[Cleanup] Python process terminated gracefully')
          pyProc = null
          isCleaningUp = false
          return
        } catch (err) {
          // 优雅终止失败，继续强制终止
        }
        
        // 方法2: 强制终止（抑制错误输出）
        try {
          execSync(`taskkill /pid ${pid} /f /t`, { 
            timeout: 5000,
            stdio: 'ignore'  // 抑制所有输出
          })
          console.log('[Cleanup] Python process terminated')
        } catch (err: any) {
          // 进程可能已经退出，这是正常的
          console.log('[Cleanup] Process may have already exited')
        }
      } else {
        // macOS/Linux: 先 SIGTERM，再 SIGKILL
        try {
          const pid = pyProc.pid
          process.kill(pid, 'SIGTERM')
          // 等待一下看是否自己退出
          setTimeout(() => {
            try {
              process.kill(pid, 'SIGKILL')
              console.log('[Cleanup] Python process killed with SIGKILL')
            } catch (err) {
              console.log('[Cleanup] Process already exited')
            }
          }, 1000)
        } catch (err) {
          console.log('[Cleanup] Process may have already exited')
        }
      }
    } catch (err) {
      console.error('[Cleanup] Failed to kill Python process:', err)
    }
    
    pyProc = null
    isCleaningUp = false
  } else {
    console.log('[Cleanup] No Python process to terminate')
  }
}

// 检查是否有正在进行的生成
function hasActiveGeneration(): boolean {
  return activeRequests.size > 0
}

// 停止当前正在进行的生成
async function stopActiveGeneration(): Promise<void> {
  if (activeRequests.size === 0) return
  console.log('[Main] Stopping active generation before quit...')
  const keys = [...activeRequests.keys()]
  for (const key of keys) {
    userStoppedKeys.add(key)
    const req = activeRequests.get(key)
    if (req) {
      req.destroy()
    }
    activeRequests.delete(key)
    if (chatWindow) {
      const sessionId = key === '__default__' ? undefined : key
      chatWindow.webContents.send('bot-stream', { type: 'finish', sessionId })
    }
  }
  await new Promise(resolve => setTimeout(resolve, 100))
}

app.on('window-all-closed', () => {
  killPythonProcess()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 等待用户确认退出的 Promise
let quitConfirmResolve: ((confirmed: boolean) => void) | null = null

app.on('before-quit', async (event) => {
  // 安装更新时直接退出，不弹「正在生成」确认框
  if (installingUpdate) {
    killPythonProcess()
    return
  }
  // 检查是否有正在进行的生成
  if (hasActiveGeneration()) {
    // 再次检查，确保请求真的还在进行（防止竞态条件）
    if (!hasActiveGeneration()) {
      // 请求已经被清除，直接退出
      console.log('[Main] Request already cleared, exiting directly')
      killPythonProcess()
      return
    }
    
    // 阻止默认退出行为
    event.preventDefault()
    
    // 优先显示聊天窗口
    if (chatWindow) {
      if (!chatWindow.isVisible()) {
        chatWindow.show()
        chatWindow.focus()
      }
      
      // 最后一次检查，确保请求还在进行
      if (!hasActiveGeneration()) {
        // 请求已经被清除，直接退出
        console.log('[Main] Request cleared before showing dialog, exiting directly')
        killPythonProcess()
        app.exit(0)
        return
      }
      
      // 通过 IPC 请求渲染进程显示确认对话框
      chatWindow.webContents.send('quit-confirm')
      
      // 等待用户响应
      const confirmed = await new Promise<boolean>((resolve) => {
        quitConfirmResolve = resolve
        // 设置超时，如果 30 秒内没有响应，默认取消
        setTimeout(() => {
          if (quitConfirmResolve === resolve) {
            quitConfirmResolve = null
            resolve(false)
          }
        }, 30000)
      })
      
      // 用户响应后，再次检查请求是否还在进行
      if (!hasActiveGeneration()) {
        // 请求已经被清除，直接退出
        console.log('[Main] Request cleared during dialog, exiting directly')
        killPythonProcess()
        app.exit(0)
        return
      }
      
      if (confirmed) {
        // 用户选择继续退出，停止生成并退出
        await stopActiveGeneration()
        killPythonProcess()
        app.exit(0)
      } else {
        // 用户选择取消，不退出
        console.log('[Main] User cancelled quit')
      }
    } else {
      // 没有聊天窗口，直接退出
      await stopActiveGeneration()
      killPythonProcess()
      app.exit(0)
    }
  } else {
    // 没有正在进行的生成，正常退出
    killPythonProcess()
  }
})

// 处理用户确认退出的响应
ipcMain.on('quit-confirmed', (_, confirmed: boolean) => {
  console.log('[Main] Received quit confirmation response:', confirmed)
  if (quitConfirmResolve) {
    quitConfirmResolve(confirmed)
    quitConfirmResolve = null
  }
})

app.on('will-quit', () => {
  disposeBackdropHelper()
  killPythonProcess()
})

// 处理异常退出
process.on('exit', () => {
  killPythonProcess()
})

process.on('SIGINT', () => {
  console.log('[Cleanup] Received SIGINT')
  killPythonProcess()
  app.quit()
})

process.on('SIGTERM', () => {
  console.log('[Cleanup] Received SIGTERM')
  killPythonProcess()
  app.quit()
})

// 确保在任何情况下都尝试清理
process.on('uncaughtException', (err) => {
  console.error('[Fatal] Uncaught exception:', err)
  killPythonProcess()
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  console.error('[Fatal] Unhandled rejection:', reason)
  killPythonProcess()
  process.exit(1)
})
