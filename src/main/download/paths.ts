import { app } from 'electron'
import { existsSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

export function getDefaultDownloadsDir(): string {
  return app.getPath('downloads')
}

export function getHomeDir(): string {
  return app.getPath('home')
}

/** <directory>/<fileName>, or <directory>/<fileName> (1), (2), ... if it already exists. */
export function getAvailableDestinationPath(directory: string, fileName: string): string {
  const ext = extname(fileName)
  const base = basename(fileName, ext)

  let candidate = join(directory, fileName)
  let counter = 1
  while (existsSync(candidate)) {
    candidate = join(directory, `${base} (${counter})${ext}`)
    counter += 1
  }
  return candidate
}
