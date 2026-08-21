import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export type OnboardingDiskStatus = 'pending' | 'completed' | 'skipped' | 'migrated'

export function finAgentConfigDir(): string {
  if (process.platform === 'win32') {
    return join(app.getPath('appData'), 'fin-agent')
  }
  const xdg = process.env.XDG_CONFIG_HOME
  if (xdg) return join(xdg, 'fin-agent')
  return join(app.getPath('home') || homedir(), '.config', 'fin-agent')
}

function onboardingPath(): string {
  return join(finAgentConfigDir(), 'onboarding.json')
}

function hasLegacyData(dir: string): boolean {
  return (
    existsSync(join(dir, 'user_profile.json')) ||
    existsSync(join(dir, '.env')) ||
    existsSync(join(dir, 'app_config.json')) ||
    existsSync(join(dir, 'sessions', 'index.json'))
  )
}

function writeStatus(status: OnboardingDiskStatus): void {
  const dir = finAgentConfigDir()
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    onboardingPath(),
    JSON.stringify({ status, updated_at: new Date().toISOString() }, null, 2),
    'utf8'
  )
}

export function markOnboardingStatus(status: 'completed' | 'skipped'): void {
  writeStatus(status)
}

export function resolveStartupHash(): 'onboarding' | 'chat' {
  try {
    const dir = finAgentConfigDir()
    const file = onboardingPath()
    if (!existsSync(file)) {
      if (hasLegacyData(dir)) {
        writeStatus('migrated')
        return 'chat'
      }
      return 'onboarding'
    }
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const status = raw && typeof raw.status === 'string' ? raw.status : ''
    if (status === 'completed' || status === 'skipped' || status === 'migrated') {
      return 'chat'
    }
    return 'onboarding'
  } catch (err) {
    console.warn('[Onboarding] resolveStartupHash failed, falling back to chat:', err)
    return 'chat'
  }
}
