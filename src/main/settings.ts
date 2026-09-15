import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { ThemeSource } from '../shared/types'

function settingsPath(): string {
  return join(app.getPath('userData'), 'app-settings.json')
}

interface AppSettings {
  themeSource?: ThemeSource
}

async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await readFile(settingsPath(), 'utf-8')
    return JSON.parse(raw) as AppSettings
  } catch {
    // No file yet (first run) or it's unreadable/corrupt — either way, no saved settings.
    return {}
  }
}

export async function loadThemeSource(): Promise<ThemeSource> {
  const settings = await loadSettings()
  return settings.themeSource ?? 'system'
}

export async function saveThemeSource(themeSource: ThemeSource): Promise<void> {
  const settings = await loadSettings()
  await writeFile(settingsPath(), JSON.stringify({ ...settings, themeSource }, null, 2), 'utf-8')
}
