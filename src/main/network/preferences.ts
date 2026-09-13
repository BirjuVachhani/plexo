import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { NetworkPreference, NetworkPreferences } from '../../shared/types'

function preferencesPath(): string {
  return join(app.getPath('userData'), 'network-preferences.json')
}

export async function loadNetworkPreferences(): Promise<NetworkPreferences> {
  try {
    const raw = await readFile(preferencesPath(), 'utf-8')
    return JSON.parse(raw) as NetworkPreferences
  } catch {
    // No file yet (first run) or it's unreadable/corrupt — either way, no saved prefs.
    return {}
  }
}

/** Merges `patch` into the stored preference for `id` — an explicit `undefined` field in
 * `patch` clears that field, a field simply left out of `patch` is left untouched. An id left
 * with no fields set is dropped entirely, so resetting a network removes it from the file. */
export async function saveNetworkPreference(
  id: string,
  patch: NetworkPreference
): Promise<NetworkPreferences> {
  const current = await loadNetworkPreferences()
  const merged: NetworkPreference = { ...current[id], ...patch }
  const next: NetworkPreferences = { ...current }

  if (merged.customName || merged.colorId) {
    next[id] = merged
  } else {
    delete next[id]
  }

  await writeFile(preferencesPath(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}
