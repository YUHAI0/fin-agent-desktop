import { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { spawn, ChildProcess, exec, execSync } from 'child_process'
import { readFileSync } from 'fs'
import * as http from 'http'
import { promisify } from 'util'

const execPromise = promisify(exec)

let inputWindow: BrowserWindow | null = null
let chatWindow: BrowserWindow | null = null
let tray: Tray | null = null
let pyProc: ChildProcess | null = null
let hasConversationContext = false  // 跟踪是否有对话上下文

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
  } catch (err) {
    // 如果命令执行失败，可能是因为没有进程占用端口
    console.log(`[Cleanup] No process found on port ${port} or cleanup failed:`, err)
  }
}

function makeApiRequest(path: string, method: string = 'GET', data?: any): Promise<any> {
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

async function startPythonServer() {
  // 先清理可能存在的僵尸进程
  await killProcessOnPort(5678)
  
  const pythonDist = is.dev
    ? join(__dirname, '../../python')
    : join(process.resourcesPath, 'python')

  const executableName = process.platform === 'win32' ? 'api.exe' : 'api'
  const executable = is.dev
    ? 'python'
    : join(pythonDist, 'api', executableName)

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
    { label: '退出', click: () => {
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
  // 根据是否有对话上下文决定显示哪个窗口
  if (hasConversationContext) {
    // 有上下文，显示对话窗口
    if (chatWindow) {
      if (chatWindow.isVisible()) {
        chatWindow.hide()
      } else {
        if (chatWindow.isMinimized()) {
          chatWindow.restore()
        }
        chatWindow.show()
        chatWindow.focus()
        chatWindow.webContents.send('focus-input')
      }
    }
  } else {
    // 没有上下文，显示输入框
    if (inputWindow) {
      if (inputWindow.isVisible()) {
        inputWindow.hide()
      } else {
        if (inputWindow.isMinimized()) {
          inputWindow.restore()
        }
        inputWindow.show()
        inputWindow.focus()
        inputWindow.webContents.send('focus-input')
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

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.quickchat')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  startPythonServer()
  createInputWindow()
  createChatWindow()
  createTray()

  // Polling for API readiness and config check
  const checkConfigLoop = async () => {
    let attempts = 0
    while (attempts < 20) { // Try for 20 seconds
      try {
        // First get the full config to register shortcut (even if not fully configured)
        const config = await makeApiRequest('/config')
        if (config && config.wake_up_shortcut) {
            registerGlobalShortcut(config.wake_up_shortcut)
        } else {
            registerGlobalShortcut('Ctrl+Alt+Q') // Default fallback
        }

        const res = await makeApiRequest('/config/check')
        if (res && res.configured === false) {
          console.log('[Main] Config missing, redirecting to config page')
          if (chatWindow) {
            chatWindow.show()
            chatWindow.focus()
            // Navigate to config page
            if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
              chatWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/#/config`)
            } else {
              chatWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'config' })
            }
          }
          if (inputWindow) {
            inputWindow.hide()
          }
        } else {
          console.log('[Main] Config check passed')
        }
        break; 
      } catch (e) {
        // API likely not ready yet
        await new Promise(r => setTimeout(r, 1000))
        attempts++
      }
    }
  }
  
  // Start checking slightly after startup to let Python init
  setTimeout(checkConfigLoop, 1000)

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
          const dataLines: string[] = []

          for (const rawLine of lines) {
            const line = rawLine.trimEnd()
            if (!line) continue
            // Ignore comments / other SSE fields for now (event:, id:, retry:)
            if (line.startsWith('data:')) {
              // "data:" or "data: "
              const value = line.slice(5).replace(/^\s/, '')
              dataLines.push(value)
            }
          }

          if (dataLines.length === 0) return

          const dataStr = dataLines.join('\n')
          if (dataStr === '[DONE]') {
            console.log('[Main] Received [DONE], sending finish event to renderer')
            if (chatWindow) {
              chatWindow.webContents.send('bot-stream', { type: 'finish' })
              console.log('[Main] Finish event sent to renderer')
            }
            return
          }

          try {
            const data = JSON.parse(dataStr)
            if (chatWindow) {
              chatWindow.webContents.send('bot-stream', data)
            }
          } catch (e) {
            console.error('Error parsing SSE data:', e, dataStr)
          }
        }

        const req = http.request(options, (res) => {
          console.log('[Main] Response status:', res.statusCode)
          console.log('[Main] Response headers:', JSON.stringify(res.headers, null, 2))

          if (res.statusCode !== 200) {
            console.error('[Main] Non-200 status code received')
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
          })

          res.on('error', (err) => {
            console.error('[Main] Response stream error:', err)
            if (chatWindow) {
              chatWindow.webContents.send('bot-stream', { type: 'error', content: `Stream error: ${err.message}` })
            }
          })
        })

        req.on('error', (err) => {
          console.error('[Main] Request error:', err)
          console.error('[Main] Error code:', (err as any).code)
          console.error('[Main] Error stack:', err.stack)
          if (chatWindow) {
            chatWindow.webContents.send('bot-stream', { type: 'error', content: `Request error: ${err.message}` })
          }
        })
        
        req.on('socket', (socket) => {
          console.log('[Main] Socket assigned')
          socket.on('connect', () => {
            console.log('[Main] Socket connected')
          })
          socket.on('error', (err) => {
            console.error('[Main] Socket error:', err)
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
        if (chatWindow) {
          chatWindow.webContents.send('bot-stream', { type: 'error', content: `Error: ${err}` })
        }
      }
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

// 终止 Python 进程的函数（带优雅关闭尝试）
function killPythonProcess() {
  if (pyProc && pyProc.pid) {
    const pid = pyProc.pid  // 保存 PID，避免空值检查问题
    console.log('[Cleanup] Terminating Python process (PID:', pid, ')...')
    
    try {
      // 方法1: 先尝试发送 SIGTERM 让进程优雅退出
      console.log('[Cleanup] Sending SIGTERM...')
      if (process.platform === 'win32') {
        // Windows: 先尝试温和的终止
        try {
          execSync(`taskkill /pid ${pid} /t`, { timeout: 2000 })
          console.log('[Cleanup] Python process terminated gracefully')
          pyProc = null
          return
        } catch (err) {
          console.log('[Cleanup] Graceful termination failed, forcing...')
        }
        
        // 方法2: 强制终止
        try {
          execSync(`taskkill /pid ${pid} /f /t`, { timeout: 5000 })
          console.log('[Cleanup] Python process terminated forcefully')
        } catch (err: any) {
          // 进程可能已经退出
          if (err.status !== 128 && !err.message?.includes('not found')) {
            console.log('[Cleanup] Process may have already exited:', err.message)
          } else {
            console.log('[Cleanup] Process terminated')
          }
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
  } else {
    console.log('[Cleanup] No Python process to terminate')
  }
}

app.on('window-all-closed', () => {
  killPythonProcess()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  killPythonProcess()
})

app.on('will-quit', () => {
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
