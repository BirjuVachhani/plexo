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

/** Shortens an absolute path under the user's home directory to a "~/..." form for display. */
export function toDisplayPath(path: string, homeDir: string): string {
  if (homeDir && (path === homeDir || path.startsWith(`${homeDir}/`))) {
    return `~${path.slice(homeDir.length)}`
  }
  return path
}
