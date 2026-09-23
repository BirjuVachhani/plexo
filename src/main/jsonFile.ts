import { readFile, rename, writeFile } from 'node:fs/promises'

/** Parsed contents, or undefined when the file is missing (first run) or corrupt. Any other
 * failure (a lock, too many open files) throws, so a save never overwrites what it couldn't read. */
export async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf-8'))
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

const writeChains = new Map<string, Promise<unknown>>()

/** Read-modify-write, queued per file so two quick saves can't drop each other's change, and
 * written via a temp file + rename so a crash mid-write can't leave a half-written file (which
 * would read back as corrupt and wipe every saved value). */
export function updateJson<T>(path: string, update: (current: unknown) => T): Promise<T> {
  const next = (writeChains.get(path) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const value = update(await readJson(path))
      const temporaryPath = `${path}.tmp`
      await writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf-8')
      await rename(temporaryPath, path)
      return value
    })
  writeChains.set(path, next)
  return next
}
