#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))

const skipBuild = args.has('--skip-build')
const skipClean = args.has('--skip-clean')
const arch = process.env.MAC_BUILD_ARCH || process.arch

const log = (message) => {
  console.log(`[mac-package] ${message}`)
}

const run = (command, commandArgs, options = {}) =>
  new Promise((resolve, reject) => {
    log(`${command} ${commandArgs.join(' ')}`)

    const child = spawn(command, commandArgs, {
      cwd: rootDir,
      env: {
        ...process.env,
        ELECTRON_MIRROR: process.env.ELECTRON_MIRROR ?? 'https://npmmirror.com/mirrors/electron/',
        ELECTRON_BUILDER_BINARIES_MIRROR:
          process.env.ELECTRON_BUILDER_BINARIES_MIRROR ??
          'https://npmmirror.com/mirrors/electron-builder-binaries/'
      },
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...options
    })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`${command} exited with code ${code}`))
    })
  })

const cleanMacArtifacts = async () => {
  const distDir = path.join(rootDir, 'dist')

  if (!existsSync(distDir)) {
    return
  }

  const entries = await readdir(distDir, { withFileTypes: true })
  const macArtifactPattern = /^(mac|.*-(x64|arm64|universal)\.(dmg|zip|blockmap)$|.*\.dmg\.blockmap$)/

  await Promise.all(
    entries
      .filter((entry) => macArtifactPattern.test(entry.name))
      .map((entry) => rm(path.join(distDir, entry.name), { recursive: true, force: true }))
  )
}

if (process.platform !== 'darwin') {
  console.error('[mac-package] macOS dmg must be built on macOS.')
  process.exit(1)
}

if (!['arm64', 'x64'].includes(arch)) {
  console.error(`[mac-package] unsupported mac arch: ${arch}`)
  process.exit(1)
}

try {
  if (!skipClean) {
    log('clean old mac artifacts')
    await cleanMacArtifacts()
  }

  if (!skipBuild) {
    await run('npm', ['run', 'build'])
  }

  await run('npx', ['electron-builder', '--mac', `--${arch}`, '--publish', 'never'])
  log('done')
} catch (error) {
  console.error(`[mac-package] ${error.message}`)
  process.exit(1)
}
