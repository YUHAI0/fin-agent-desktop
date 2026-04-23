import { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, Notification, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { spawn, ChildProcess, exec, execSync } from 'child_process'
import { readFileSync, existsSync, appendFileSync, createWriteStream, unlink } from 'fs'
import * as http from 'http'
import * as https from 'https'
import { promisify, format } from 'util'

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


let inputWindow: BrowserWindow | null = null
let chatWindow: BrowserWindow | null = null
let tray: Tray | null = null
let pyProc: ChildProcess | null = null
let hasConversationContext = false  // 跟踪是否有对话上下文
let isCleaningUp = false  // 防止重复执行清理
let currentRequest: http.ClientRequest | null = null  // 保存当前正在进行的 HTTP 请求
let isUserStopped = false  // 标记是否是用户主动停止
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

function createInputWindow(): void {
  inputWindow = new BrowserWindow({
    width: 600,
    height: 80, // Slightly larger for padding
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  inputWindow.on('blur', () => {
    inputWindow?.hide()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    inputWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/#/input`)
  } else {
    inputWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'input' })
  }
}

function createChatWindow(): void {
  chatWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    title: 'Fin-Agent',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // 禁用 Alt 键显示菜单栏
  chatWindow.setMenuBarVisibility(false)
  chatWindow.setMenu(null)

  chatWindow.on('close', (e) => {
    e.preventDefault()
    chatWindow?.hide()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    chatWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/#/chat`)
  } else {
    chatWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'chat' })
  }
}

function createTray() {
  const iconPath = join(__dirname, '../../resources/icon.ico')
  const icon = nativeImage.createFromPath(iconPath)
  
  tray = new Tray(icon)
  
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示/隐藏', click: () => toggleMainWindow() },
    { type: 'separator' },
    { label: '退出', click: async () => {
        // 检查是否有正在进行的生成
        if (hasActiveGeneration()) {
          // 再次检查，确保请求真的还在进行
          if (!currentRequest) {
            // 请求已经被清除，直接退出
            console.log('[Main] Request already cleared, exiting directly from tray')
            clearChatHistory()
            if (chatWindow) {
                chatWindow.destroy()
                chatWindow = null
            }
            if (inputWindow) {
                inputWindow.destroy()
                inputWindow = null
            }
            app.quit()
            return
          }
          
          // 优先显示聊天窗口，隐藏输入窗口
          if (chatWindow) {
            if (!chatWindow.isVisible()) {
              chatWindow.show()
              chatWindow.focus()
            }
            // 隐藏输入窗口（如果可见）
            if (inputWindow && inputWindow.isVisible()) {
              inputWindow.hide()
            }
            
            // 最后一次检查，确保请求还在进行
            if (!currentRequest) {
              // 请求已经被清除，直接退出
              console.log('[Main] Request cleared before showing dialog from tray, exiting directly')
              clearChatHistory()
              if (chatWindow) {
                  chatWindow.destroy()
                  chatWindow = null
              }
              if (inputWindow) {
                  inputWindow.destroy()
                  inputWindow = null
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
            if (!currentRequest) {
              // 请求已经被清除，直接退出
              console.log('[Main] Request cleared during dialog from tray, exiting directly')
              clearChatHistory()
              if (chatWindow) {
                  chatWindow.destroy()
                  chatWindow = null
              }
              if (inputWindow) {
                  inputWindow.destroy()
                  inputWindow = null
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
        
        // 清空聊天历史
        clearChatHistory()
        // 销毁窗口以确保 app.quit 能正常工作
        if (chatWindow) {
            chatWindow.destroy()
            chatWindow = null
        }
        if (inputWindow) {
            inputWindow.destroy()
            inputWindow = null
        }
        app.quit()
    }}
  ])
  
  tray.setToolTip('Fin-Agent')
  tray.setContextMenu(contextMenu)
  
  tray.on('double-click', () => {
    toggleMainWindow()
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
    } else if (inputWindow) {
      if (inputWindow.isMinimized()) {
        inputWindow.restore()
      }
      inputWindow.show()
      inputWindow.focus()
      inputWindow.webContents.send('focus-input')
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

// 切换主窗口显示状态
function toggleMainWindow() {
  // 检查是否在配置页面，如果是则不允许切换
  if (chatWindow && chatWindow.isVisible()) {
    const url = chatWindow.webContents.getURL()
    // 检查 URL 中是否包含 #/config
    if (url.includes('#/config') || url.includes('hash=config')) {
      console.log('[Main] Currently in config page, ignoring shortcut')
      return
    }
  }

  // 优先处理聊天窗口：如果聊天窗口可见，则关闭它
  if (chatWindow && chatWindow.isVisible()) {
    chatWindow.hide()
    // 隐藏聊天窗口时，也隐藏输入框
    if (inputWindow) {
      inputWindow.hide()
    }
    return
  }

  // 如果聊天窗口不可见，根据是否有对话上下文决定显示哪个窗口
  if (hasConversationContext) {
    // 有上下文，显示对话窗口
    if (chatWindow) {
      if (chatWindow.isMinimized()) {
        chatWindow.restore()
      }
      chatWindow.show()
      chatWindow.focus()
      chatWindow.webContents.send('focus-input')
      // 显示聊天窗口时，确保输入框隐藏
      if (inputWindow) {
        inputWindow.hide()
      }
    }
  } else {
    // 没有上下文，显示输入框
    if (inputWindow) {
      if (inputWindow.isVisible()) {
        inputWindow.hide()
        // 隐藏输入框时，也隐藏聊天窗口
        if (chatWindow) {
          chatWindow.hide()
        }
      } else {
        if (inputWindow.isMinimized()) {
          inputWindow.restore()
        }
        inputWindow.show()
        inputWindow.focus()
        inputWindow.webContents.send('focus-input')
        // 显示输入框时，确保聊天窗口隐藏
        if (chatWindow) {
          chatWindow.hide()
        }
      }
    }
  }
}

// Store current shortcut in a global variable for resumption
let currentGlobalShortcut = 'Ctrl+Alt+Q'

function registerGlobalShortcut(shortcut: string) {
  globalShortcut.unregisterAll()
  try {
    const ret = globalShortcut.register(shortcut, () => {
      toggleMainWindow()
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

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest)
    
    const handleResponse = (response: http.IncomingMessage) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        if (response.headers.location) {
          const redirectUrl = response.headers.location
          console.log(`[Update] Redirecting to: ${redirectUrl}`)
          https.get(redirectUrl, handleResponse).on('error', (err) => {
            unlink(dest, () => {})
            reject(err)
          })
          return
        }
      }

      if (response.statusCode !== 200) {
        unlink(dest, () => {})
        reject(new Error(`Failed to download: ${response.statusCode}`))
        return
      }

      response.pipe(file)
      
      file.on('finish', () => {
        file.close()
        resolve()
      })

      file.on('error', (err) => {
        unlink(dest, () => {})
        reject(err)
      })
    }

    https.get(url, { headers: { 'User-Agent': 'fin-agent-desktop' } }, handleResponse)
      .on('error', (err) => {
        unlink(dest, () => {})
        reject(err)
      })
  })
}

function checkForUpdates() {
  console.log('[Update] Starting update check...')
  const options = {
    hostname: 'api.github.com',
    path: '/repos/YUHAI0/fin-agent-desktop/releases/latest',
    method: 'GET',
    headers: {
      'User-Agent': 'fin-agent-desktop'
    }
  }

  const req = https.request(options, (res) => {
    let data = ''
    res.on('data', (chunk) => {
      data += chunk
    })

    res.on('end', () => {
      if (res.statusCode === 200) {
        try {
          const release = JSON.parse(data)
          const latestVersion = release.tag_name.replace(/^v/, '')
          const currentVersion = getVersion()

          console.log(`[Update] Version check: current=${currentVersion}, latest=${latestVersion}`)

          if (compareVersions(latestVersion, currentVersion) > 0) {
            console.log(`[Update] New version found: ${latestVersion}`)
            
            // Determine asset extension based on platform
            let assetExt = ''
            if (process.platform === 'win32') {
                assetExt = '.exe'
            } else if (process.platform === 'darwin') {
                assetExt = '.dmg'
            }
            
            // Find asset
            const asset = release.assets.find((a: any) => a.name.endsWith(assetExt))
            if (asset && asset.browser_download_url) {
                console.log(`[Update] Found update asset: ${asset.name}`)
                const tempPath = join(app.getPath('temp'), asset.name)
                
                // Show a gentle notification or log that download is starting?
                // For now, silent background download as requested
                console.log(`[Update] Starting download from ${asset.browser_download_url} to ${tempPath}`)
                
                downloadFile(asset.browser_download_url, tempPath)
                  .then(() => {
                    console.log('[Update] Download complete')
                    const notification = new Notification({
                      title: '新版本就绪',
                      body: `新版本 ${release.tag_name} 已下载完毕，点击此处立即安装更新。`,
                      silent: false
                    })

                    notification.on('click', () => {
                        console.log('[Update] User clicked notification. Spawning installer and quitting...')
                        
                        // Kill Python process before installing update
                        killPythonProcess()
                        
                        // Wait a bit for Python process to terminate
                        setTimeout(() => {
                            if (process.platform === 'darwin') {
                                // macOS: Mount DMG and instruct user (simple way) or just open it
                                // Opening DMG usually mounts it. Automating install from DMG is complex without Sparkle.
                                // For this simple implementation, we just open the DMG file so user can drag-drop.
                                shell.openPath(tempPath)
                                // On macOS we might not want to quit immediately if we just open the DMG window,
                                // but usually "updating" implies replacing the app. 
                                // Standard behavior without auto-updater framework: Open DMG, user drags to App folder.
                                // We can just exit to let them overwrite? 
                                // Actually, if the app is running, they can't overwrite it easily.
                                // Let's just open it and NOT quit automatically on Mac, 
                                // or quit so they can drag-drop. Quitting is safer for overwrite.
                                app.quit()
                            } else {
                                // Windows
                                const subprocess = spawn(tempPath, [], {
                                    detached: true,
                                    stdio: 'ignore'
                                })
                                subprocess.unref()
                                app.quit()
                            }
                        }, 500)
                    })

                    notification.show()
                  })
                  .catch(err => {
                    console.error('[Update] Download failed:', err)
                  })
            } else {
                console.log(`[Update] No suitable asset found for platform ${process.platform}`)
            }
          }
        } catch (e) {
          console.error('[Update] Failed to parse release info', e)
        }
      }
    })
  })

  req.on('error', (e) => {
    console.error('[Update] Check failed', e)
  })

  req.end()
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('fin-agent')

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

  startPythonServer()
  createInputWindow()
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
  checkForUpdates()
  // Check updates every 4 hours
  setInterval(checkForUpdates, 4 * 60 * 60 * 1000)

  // Poll for desktop notifications from scheduler
  const pollNotifications = async () => {
    try {
      const res = await makeApiRequest('/notifications/poll')
      if (res && res.notifications && Array.isArray(res.notifications)) {
        res.notifications.forEach((notif: { title: string; body: string }) => {
          const notification = new Notification({
            title: notif.title || 'Fin-Agent 提醒',
            body: notif.body || '',
            silent: false
          })
          
          notification.on('click', () => {
            // Show chat window when notification is clicked
            if (chatWindow) {
              if (chatWindow.isMinimized()) {
                chatWindow.restore()
              }
              chatWindow.show()
              chatWindow.focus()
            }
          })
          
          notification.show()
        })
      }
    } catch (e) {
      // API might not be ready yet, ignore errors
    }
  }
  
  // Poll for notifications every 2 seconds
  setInterval(pollNotifications, 2000)

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

  ipcMain.handle('open-external', async (_, url: string) => {
    shell.openExternal(url)
  })

  ipcMain.handle('save-config', async (_, data) => {
    // Update shortcut immediately if present
    if (data.wake_up_shortcut) {
        registerGlobalShortcut(data.wake_up_shortcut)
    }
    return await makeApiRequest('/config/save', 'POST', data)
  })

  ipcMain.on('open-settings', () => {
    if (inputWindow) inputWindow.hide()
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
  })

  ipcMain.on('submit-input', async (_, text) => {
    console.log('[Main] Received submit-input:', text)
    
    // Check config before processing
    try {
      const configStatus = await makeApiRequest('/config/check')
      if (!configStatus || !configStatus.configured) {
        console.log('[Main] Config not configured, redirecting to config page')
        if (inputWindow) inputWindow.hide()
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
      if (inputWindow) inputWindow.hide()
      if (chatWindow) {
        chatWindow.show()
        chatWindow.focus()
        chatWindow.webContents.send('navigate-route', '/config')
      }
      return
    }
    
    // 标记为有对话上下文
    hasConversationContext = true
    
    if (inputWindow) inputWindow.hide()
    if (chatWindow) {
      chatWindow.show()
      chatWindow.focus()
      chatWindow.webContents.send('new-message', text)
      
      try {
        console.log('[Main] Sending POST to http://127.0.0.1:5678/chat')
        
        const postData = JSON.stringify({ message: text })
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
              currentRequest = null
              if (chatWindow) {
                chatWindow.webContents.send('bot-stream', { type: 'finish' })
                console.log('[Main] Finish event sent to renderer')
              }
              continue
            }

            try {
              const data = JSON.parse(value)
              if (chatWindow) {
                chatWindow.webContents.send('bot-stream', data)
              }
            } catch (e) {
              console.error('Error parsing SSE data line:', e, value)
            }
          }
        }

        const req = http.request(options, (res) => {
          console.log('[Main] Response status:', res.statusCode)
          console.log('[Main] Response headers:', JSON.stringify(res.headers, null, 2))

          if (res.statusCode !== 200) {
            console.error('[Main] Non-200 status code received')
            currentRequest = null  // 清除请求引用
            throw new Error(`HTTP error! status: ${res.statusCode}`)
          }

          let buffer = ''

          res.setEncoding('utf8')
          
          res.on('data', (chunk: string) => {
            // console.log('[Main] Received data chunk, length:', chunk.length)
            // console.log('[Main] Chunk content:', chunk.substring(0, 200))
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
            // 清除请求引用（如果还没有清除的话，可能在收到 [DONE] 时已经清除了）
            if (currentRequest === req) {
              currentRequest = null
            }
            isUserStopped = false  // 重置标志
          })

          res.on('error', (err) => {
            currentRequest = null  // 清除请求引用
            // 如果是用户主动停止，静默处理，不打印任何日志
            if (!isUserStopped) {
              console.error('[Main] Response stream error:', err)
              if (chatWindow) {
                chatWindow.webContents.send('bot-stream', { type: 'error', content: `Stream error: ${err.message}` })
              }
            }
            // 用户主动停止时，静默处理，不打印任何日志
            isUserStopped = false  // 重置标志
          })
        })
        
        // 保存当前请求引用
        currentRequest = req

        req.on('error', (err: any) => {
          currentRequest = null  // 清除请求引用
          // ECONNRESET 和 EPIPE 是正常的，当进程关闭时连接会断开
          if (err.code === 'ECONNRESET' || err.code === 'EPIPE') {
            // 如果是用户主动停止，不打印日志
            if (!isUserStopped) {
              console.log('[Main] Request connection closed (process terminated)')
            }
          } else if (err.code === 'ECONNABORTED' || err.message === 'aborted' || err.message?.includes('aborted')) {
            // 用户主动停止，不打印错误日志
            // 静默处理，不打印任何日志
          } else {
            // 如果是用户主动停止，不显示错误
            if (!isUserStopped) {
              console.error('[Main] Request error:', err)
              console.error('[Main] Error code:', err.code)
              console.error('[Main] Error stack:', err.stack)
              if (chatWindow) {
                chatWindow.webContents.send('bot-stream', { type: 'error', content: `Request error: ${err.message}` })
              }
            }
          }
          isUserStopped = false  // 重置标志
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
        currentRequest = null  // 清除请求引用
        if (chatWindow) {
          chatWindow.webContents.send('bot-stream', { type: 'error', content: `Error: ${err}` })
        }
      }
    }
  })
  
  // 停止生成处理器
  ipcMain.on('stop-generation', () => {
    console.log('[Main] Received stop-generation request')
    if (currentRequest) {
      console.log('[Main] Aborting current request...')
      isUserStopped = true  // 标记为用户主动停止
      currentRequest.destroy()  // 销毁请求，这会触发连接关闭
      currentRequest = null
      
      // 通知前端生成已停止
      if (chatWindow) {
        chatWindow.webContents.send('bot-stream', { type: 'finish' })
        console.log('[Main] Sent finish event to renderer after stop')
      }
    } else {
      console.log('[Main] No active request to stop')
    }
  })
  
  ipcMain.on('resize-input', (_, height) => {
      if(inputWindow) {
          const [width] = inputWindow.getSize()
          inputWindow.setSize(width, height)
      }
  })

  ipcMain.handle('get-version', () => {
    return getVersion()
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

  ipcMain.handle('get-auto-launch', () => {
    const settings = app.getLoginItemSettings()
    return settings.openAtLogin
  })

  ipcMain.handle('set-auto-launch', (_, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled })
    return app.getLoginItemSettings().openAtLogin
  })

  // 重置对话上下文（清空对话时调用）
  ipcMain.on('reset-conversation-context', () => {
    console.log('[Main] Resetting conversation context')
    hasConversationContext = false
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createInputWindow()
      createChatWindow()
    }
  })
})

// 清空聊天历史
function clearChatHistory() {
  console.log('[Cleanup] Clearing chat history...')
  const allWindows = BrowserWindow.getAllWindows()
  allWindows.forEach(window => {
    try {
      window.webContents.send('clear-chat-history')
      console.log('[Cleanup] Sent clear-chat-history to window')
    } catch (err) {
      console.error('[Cleanup] Failed to send clear-chat-history:', err)
    }
  })
}

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
  return currentRequest !== null
}

// 停止当前正在进行的生成
async function stopActiveGeneration(): Promise<void> {
  if (currentRequest) {
    console.log('[Main] Stopping active generation before quit...')
    isUserStopped = true
    currentRequest.destroy()
    currentRequest = null
    
    // 通知前端生成已停止
    if (chatWindow) {
      chatWindow.webContents.send('bot-stream', { type: 'finish' })
    }
    
    // 等待一小段时间确保请求已完全停止
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

app.on('window-all-closed', () => {
  clearChatHistory()
  killPythonProcess()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 等待用户确认退出的 Promise
let quitConfirmResolve: ((confirmed: boolean) => void) | null = null

app.on('before-quit', async (event) => {
  // 检查是否有正在进行的生成
  if (hasActiveGeneration()) {
    // 再次检查，确保请求真的还在进行（防止竞态条件）
    if (!currentRequest) {
      // 请求已经被清除，直接退出
      console.log('[Main] Request already cleared, exiting directly')
      clearChatHistory()
      killPythonProcess()
      return
    }
    
    // 阻止默认退出行为
    event.preventDefault()
    
    // 优先显示聊天窗口，隐藏输入窗口
    if (chatWindow) {
      if (!chatWindow.isVisible()) {
        chatWindow.show()
        chatWindow.focus()
      }
      // 隐藏输入窗口（如果可见）
      if (inputWindow && inputWindow.isVisible()) {
        inputWindow.hide()
      }
      
      // 最后一次检查，确保请求还在进行
      if (!currentRequest) {
        // 请求已经被清除，直接退出
        console.log('[Main] Request cleared before showing dialog, exiting directly')
        clearChatHistory()
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
      if (!currentRequest) {
        // 请求已经被清除，直接退出
        console.log('[Main] Request cleared during dialog, exiting directly')
        clearChatHistory()
        killPythonProcess()
        app.exit(0)
        return
      }
      
      if (confirmed) {
        // 用户选择继续退出，停止生成并退出
        await stopActiveGeneration()
        clearChatHistory()
        killPythonProcess()
        app.exit(0)
      } else {
        // 用户选择取消，不退出
        console.log('[Main] User cancelled quit')
      }
    } else {
      // 没有聊天窗口，直接退出
      await stopActiveGeneration()
      clearChatHistory()
      killPythonProcess()
      app.exit(0)
    }
  } else {
    // 没有正在进行的生成，正常退出
    clearChatHistory()
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
  clearChatHistory()
  killPythonProcess()
})

// 处理异常退出
process.on('exit', () => {
  killPythonProcess()
})

process.on('SIGINT', () => {
  console.log('[Cleanup] Received SIGINT')
  clearChatHistory()
  killPythonProcess()
  app.quit()
})

process.on('SIGTERM', () => {
  console.log('[Cleanup] Received SIGTERM')
  clearChatHistory()
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
