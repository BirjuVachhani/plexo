import { join } from 'node:path'
import { app } from 'electron'
import type { NetworkPreference, NetworkPreferences } from '../../shared/types'
import { readJson, updateJson } from '../jsonFile'

function preferencesPath(): string {
  return join(app.getPath('userData'), 'network-preferences.json')
}

/** Trusts nothing past "this is valid JSON" — a hand-edited or partially-migrated file could have
 * any shape on disk. Keeps only string customName/colorId fields (what every reader downstream
 * assumes, e.g. NetworkEditPopover's `customName?.trim()`) and drops anything else, entry by
 * entry, rather than discarding the whole file over one bad entry. */
function sanitizeNetworkPreferences(parsed: unknown): NetworkPreferences {
  if (typeof parsed !== 'object' || parsed === null) return {}

  const result: NetworkPreferences = {}
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue
    const { customName, colorId } = value as Record<string, unknown>
    const preference: NetworkPreference = {}
    if (typeof customName === 'string') preference.customName = customName
    if (typeof colorId === 'string') preference.colorId = colorId
    if (preference.customName || preference.colorId) result[id] = preference
  }
  return result
}

export async function loadNetworkPreferences(): Promise<NetworkPreferences> {
  return sanitizeNetworkPreferences(await readJson(preferencesPath()))
}

/** Merges `patch` into the stored preference for `id` — an explicit `undefined` field in
 * `patch` clears that field, a field simply left out of `patch` is left untouched. An id left
 * with no fields set is dropped entirely, so resetting a network removes it from the file. */
export function saveNetworkPreference(
  id: string,
  patch: NetworkPreference
): Promise<NetworkPreferences> {
  return updateJson(preferencesPath(), (parsed) => {
    const current = sanitizeNetworkPreferences(parsed)
    const merged: NetworkPreference = { ...current[id], ...patch }
    const next: NetworkPreferences = { ...current }

    if (merged.customName || merged.colorId) {
      next[id] = merged
    } else {
      delete next[id]
    }
    return next
  })
}
