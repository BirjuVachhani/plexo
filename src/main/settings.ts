import { join } from 'node:path'
import { app, nativeTheme } from 'electron'
import type { ThemeSource } from '../shared/types'
import { readJson, updateJson } from './jsonFile'

function settingsPath(): string {
  return join(app.getPath('userData'), 'app-settings.json')
}

interface AppSettings {
  themeSource?: ThemeSource
  dismissedUpdateVersion?: string
  streamsPerNetwork?: number
  destinationDir?: string
}

function asSettings(parsed: unknown): AppSettings {
  return typeof parsed === 'object' && parsed !== null ? (parsed as AppSettings) : {}
}

export async function loadSettings(): Promise<AppSettings> {
  return asSettings(await readJson(settingsPath()))
}

export async function saveSettings(patch: AppSettings): Promise<void> {
  await updateJson(settingsPath(), (current) => ({ ...asSettings(current), ...patch }))
}

export async function loadThemeSource(): Promise<ThemeSource> {
  const settings = await loadSettings()
  if (settings.themeSource === 'light' || settings.themeSource === 'dark') {
    return settings.themeSource
  }
  // First run, or a pre-existing settings file from when 'system' was an option — fall back to
  // whatever the OS appearance is right now rather than defaulting to a fixed theme.
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}
