import { createWriteStream, type WriteStream } from 'node:fs'
import { open, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** The only large file owned by a download. It lives beside the final file so publishing it
 * requires no copy and never needs a second file's worth of disk space. */
export class DownloadFile {
  readonly path: string

  constructor(
    readonly destinationPath: string,
    id: string
  ) {
    // Keep the component short even when the final filename is near the filesystem limit.
    this.path = join(dirname(destinationPath), `.plexo-${id}.part`)
  }

  async create(): Promise<void> {
    const handle = await open(this.path, 'wx+')
    await handle.close()
  }

  /** Every writer has its own descriptor and explicit offset. Never use append mode here. */
  writer(position: number): WriteStream {
    return createWriteStream(this.path, { flags: 'r+', start: position })
  }

  async read(position: number, length: number): Promise<Buffer> {
    const handle = await open(this.path, 'r')
    try {
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, position)
      return buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  }

  async writeBuffers(position: number, buffers: readonly Buffer[]): Promise<void> {
    const handle = await open(this.path, 'r+')
    try {
      for (const buffer of buffers) {
        let written = 0
        while (written < buffer.length) {
          const result = await handle.write(buffer, written, buffer.length - written, position)
          if (result.bytesWritten === 0) throw new Error('Could not write the download file')
          written += result.bytesWritten
          position += result.bytesWritten
        }
      }
    } finally {
      await handle.close()
    }
  }

  /** Flushes the staging file before a recovery checkpoint or final publication. */
  async sync(): Promise<void> {
    const handle = await open(this.path, 'r+')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  async size(): Promise<number> {
    return (await stat(this.path)).size
  }

  async publish(expectedBytes: number): Promise<void> {
    if (expectedBytes > 0 && (await this.size()) !== expectedBytes) {
      throw new Error('Download file size does not match the expected size')
    }
    await this.sync()
    await rename(this.path, this.destinationPath)
  }

  async discard(): Promise<void> {
    await rm(this.path, { force: true })
  }
}
