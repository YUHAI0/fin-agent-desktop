import {
  BrowserWindow,
  nativeTheme,
  type BrowserWindowConstructorOptions
} from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { writeFileSync } from 'fs'
import { join } from 'path'
import os from 'os'

export type WindowBackdrop = 'mica' | 'vibrancy' | 'none'

/** Windows 11 起支持 Mica；22H2 (22621) 起效果稳定 */
export function supportsWindowsMica(): boolean {
  if (process.platform !== 'win32') return false
  const parts = os.release().split('.')
  const build = Number(parts[2] || 0)
  return Number.isFinite(build) && build >= 22000
}

export function supportsMacVibrancy(): boolean {
  return process.platform === 'darwin'
}

export function currentWindowBackdrop(): WindowBackdrop {
  if (supportsWindowsMica()) return 'mica'
  if (supportsMacVibrancy()) return 'vibrancy'
  return 'none'
}

export function applyNativeThemeSource(theme: 'dark' | 'light'): void {
  nativeTheme.themeSource = theme
}

export function applyNativeBackdrop(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  const kind = currentWindowBackdrop()
  if (kind === 'none') return
  win.setBackgroundColor('#00000000')
  if (kind === 'mica') {
    try {
      win.setBackgroundMaterial('mica')
    } catch (err) {
      console.warn('[Window] setBackgroundMaterial(mica) failed:', err)
    }
    restoreWindowsMicaFrame(win)
    return
  }
  try {
    win.setVibrancy('under-window')
    win.setBackgroundColor('#00000000')
  } catch (err) {
    console.warn('[Window] setVibrancy(under-window) failed:', err)
  }
}

export function nativeBackdropBrowserOptions(): BrowserWindowConstructorOptions {
  const kind = currentWindowBackdrop()
  if (kind === 'mica') {
    return {
      backgroundMaterial: 'mica',
      backgroundColor: '#00000000'
    }
  }
  if (kind === 'vibrancy') {
    return {
      vibrancy: 'under-window',
      visualEffectState: 'active',
      backgroundColor: '#00000000'
    }
  }
  return {}
}

/**
 * Electron 28 最大化时 Chromium 会重设 DwmExtendFrameIntoClientArea，Mica 被冲掉。
 * 在 maximize/restore 后重新写入 DWM 属性。
 */
export function attachBackdropPersistence(win: BrowserWindow): void {
  if (currentWindowBackdrop() === 'none') return
  const refresh = () => {
    if (win.isDestroyed()) return
    applyNativeBackdrop(win)
  }
  const refreshLater = () => {
    refresh()
    setTimeout(refresh, 32)
    setTimeout(refresh, 120)
  }
  win.on('maximize', refreshLater)
  win.on('unmaximize', refreshLater)
  win.on('restore', refreshLater)
  win.on('enter-full-screen', refreshLater)
  win.on('leave-full-screen', refreshLater)
  win.on('show', refresh)
  win.on('focus', refresh)
  refresh()
}

export function disposeBackdropHelper(): void {
  if (!dwmHelper) return
  try {
    dwmHelper.stdin.write('QUIT\n')
  } catch {
    /* ignore */
  }
  try {
    dwmHelper.kill()
  } catch {
    /* ignore */
  }
  dwmHelper = null
}

const DWM_HELPER_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class FaDwm {
  [StructLayout(LayoutKind.Sequential)]
  public struct MARGINS {
    public int cxLeftWidth;
    public int cxRightWidth;
    public int cyTopHeight;
    public int cyBottomHeight;
  }
  [DllImport("dwmapi.dll")]
  public static extern int DwmExtendFrameIntoClientArea(IntPtr hWnd, ref MARGINS pMarInset);
  [DllImport("dwmapi.dll")]
  public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);
  public static int Apply(long hwnd, int maximized) {
    var h = new IntPtr(hwnd);
    var m = new MARGINS { cxLeftWidth = -1, cxRightWidth = -1, cyTopHeight = -1, cyBottomHeight = -1 };
    DwmExtendFrameIntoClientArea(h, ref m);
    int mica = 2;
    DwmSetWindowAttribute(h, 38, ref mica, 4);
    int corner = maximized != 0 ? 1 : 2;
    DwmSetWindowAttribute(h, 33, ref corner, 4);
    return 0;
  }
}
"@
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line -eq 'QUIT') { break }
  $parts = $line.Trim().Split(' ')
  [void][FaDwm]::Apply([int64]$parts[0], [int]$parts[1])
}
`

let dwmHelper: ChildProcessWithoutNullStreams | null = null
let dwmHelperReady = false
const dwmHelperQueue: string[] = []

function ensureDwmHelper(): void {
  if (process.platform !== 'win32') return
  if (dwmHelper && !dwmHelper.killed) return
  dwmHelperReady = false
  const scriptPath = join(os.tmpdir(), 'fin-agent-dwm-helper.ps1')
  writeFileSync(scriptPath, DWM_HELPER_SCRIPT, 'utf8')
  dwmHelper = spawn(
    'powershell.exe',
    ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
  )
  dwmHelper.stdout.setEncoding('utf8')
  dwmHelper.stdout.on('data', (chunk: string) => {
    if (!chunk.includes('READY')) return
    dwmHelperReady = true
    for (const line of dwmHelperQueue.splice(0)) {
      dwmHelper?.stdin.write(line)
    }
  })
  dwmHelper.stderr.on('data', (chunk: Buffer | string) => {
    console.warn('[Window] DWM helper:', String(chunk).trim())
  })
  dwmHelper.on('exit', () => {
    dwmHelper = null
    dwmHelperReady = false
  })
}

function hwndToInt64(win: BrowserWindow): string {
  const buf = win.getNativeWindowHandle()
  const value = buf.length >= 8 ? buf.readBigInt64LE(0) : BigInt(buf.readInt32LE(0))
  return value.toString()
}

function restoreWindowsMicaFrame(win: BrowserWindow): void {
  if (!supportsWindowsMica() || win.isDestroyed()) return
  try {
    ensureDwmHelper()
    const line = `${hwndToInt64(win)} ${win.isMaximized() || win.isFullScreen() ? 1 : 0}\n`
    if (dwmHelperReady && dwmHelper) {
      dwmHelper.stdin.write(line)
    } else {
      dwmHelperQueue.push(line)
    }
  } catch (err) {
    console.warn('[Window] restoreWindowsMicaFrame failed:', err)
  }
}
