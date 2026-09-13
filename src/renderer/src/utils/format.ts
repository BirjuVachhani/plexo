const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${UNITS[exponent]}`
}

export function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`
}

export function formatEta(remainingBytes: number, bytesPerSec: number): string {
  if (bytesPerSec <= 0 || remainingBytes <= 0) return '—'
  const seconds = remainingBytes / bytesPerSec
  if (!Number.isFinite(seconds)) return '—'
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export function formatPercent(bytesDownloaded: number, totalBytes: number): number {
  if (totalBytes <= 0) return 0
  return Math.min(100, Math.round((bytesDownloaded / totalBytes) * 100))
}

export function fileNameFromPath(path: string): string {
  return path.split('/').pop() ?? path
}

/** m:ss, or h:mm:ss past an hour. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hrs = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  return `${mins}:${String(secs).padStart(2, '0')}`
}

/** "12.3 MB" -> { value: "12.3", unit: "MB" } — for readouts that size the number and unit separately. */
export function splitFormattedBytes(bytes: number): { value: string; unit: string } {
  const [value, unit] = formatBytes(bytes).split(' ')
  return { value, unit }
}

export function dirnameOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index <= 0 ? '/' : path.slice(0, index)
}

/** For chunks that share the same interface (multiple connections per link, or ones split
 * off by dynamic rebalancing), returns a per-chunk " #N" suffix so they can be told apart
 * in the UI — empty string when an interface only has a single chunk. */
export function connectionSuffixes(
  chunks: Array<{ id: number; interfaceId: string }>
): Map<number, string> {
  const totalByInterface = new Map<string, number>()
  for (const chunk of chunks) {
    totalByInterface.set(chunk.interfaceId, (totalByInterface.get(chunk.interfaceId) ?? 0) + 1)
  }

  const seenByInterface = new Map<string, number>()
  const suffixes = new Map<number, string>()
  for (const chunk of chunks) {
    if ((totalByInterface.get(chunk.interfaceId) ?? 0) <= 1) {
      suffixes.set(chunk.id, '')
      continue
    }
    const seen = (seenByInterface.get(chunk.interfaceId) ?? 0) + 1
    seenByInterface.set(chunk.interfaceId, seen)
    suffixes.set(chunk.id, ` #${seen}`)
  }
  return suffixes
}

/** Shortens an absolute path under the user's home directory to a "~/..." form for display. */
export function toDisplayPath(path: string, homeDir: string): string {
  if (homeDir && (path === homeDir || path.startsWith(`${homeDir}/`))) {
    return `~${path.slice(homeDir.length)}`
  }
  return path
}

const IPC_INVOKE_PREFIX = /^Error invoking remote method '[^']*':\s*/
const NESTED_ERROR_PREFIX = /^Error:\s*/

const NETWORK_ERROR_HINTS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /ENOTFOUND/,
    message: 'Could not resolve that host — check the URL and your connection.'
  },
  { pattern: /ECONNREFUSED/, message: 'The server refused the connection.' },
  { pattern: /ECONNRESET/, message: 'The connection was reset by the server.' },
  { pattern: /ETIMEDOUT/, message: 'The connection timed out.' },
  { pattern: /CERT|SSL|TLS/i, message: "The server's security certificate could not be verified." }
]

/** Electron wraps a rejected IPC call as "Error invoking remote method 'x': Error: <message>" —
 * strip that framework noise and translate common network error codes into plain English. */
export function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const stripped = raw.replace(IPC_INVOKE_PREFIX, '').replace(NESTED_ERROR_PREFIX, '')

  for (const { pattern, message } of NETWORK_ERROR_HINTS) {
    if (pattern.test(stripped)) return message
  }

  return stripped
}
