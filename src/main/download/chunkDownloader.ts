import { createWriteStream } from 'node:fs'
import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { URL } from 'node:url'

export interface ChunkDownloadOptions {
  url: string
  rangeStart: number
  /** null = open-ended range, download to end of file. */
  rangeEnd: number | null
  /** Local IP of the network interface this chunk's connection binds to. */
  localAddress: string
  destinationPath: string
  /** true when resuming a paused chunk — appends to the existing part file instead of overwriting it. */
  append: boolean
  onProgress: (bytesDownloadedThisRun: number) => void
  signal: AbortSignal
}

/** Downloads a single byte range of a URL, bound to one network interface, into a part file. */
export function downloadChunk(options: ChunkDownloadOptions): Promise<void> {
  const { url, rangeStart, rangeEnd, localAddress, destinationPath, append, onProgress, signal } =
    options

  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const parsed = new URL(url)
    const requester = parsed.protocol === 'https:' ? httpsRequest : httpRequest
    let bytesDownloaded = 0
    let settled = false

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      fn()
    }

    const fail = (error: Error): void =>
      finish(() => {
        req.destroy()
        reject(error)
      })

    const onAbort = (): void => fail(new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort)

    const rangeHeader =
      rangeEnd === null ? `bytes=${rangeStart}-` : `bytes=${rangeStart}-${rangeEnd}`

    const req: ClientRequest = requester(
      {
        method: 'GET',
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        localAddress,
        // localAddress is always an IPv4 interface address — force the remote
        // host to resolve to IPv4 too, or binding fails with EINVAL when DNS
        // hands back an IPv6 address for it instead.
        family: 4,
        headers: { 'User-Agent': 'Plexo/1.0', Range: rangeHeader }
      },
      (res: IncomingMessage) => {
        // A 200 is only correct here if we asked for the whole file from byte
        // 0 — otherwise the server ignored our Range and we'd silently write
        // the wrong bytes into this chunk's slot.
        const isValidFullBody = res.statusCode === 200 && rangeStart === 0
        if (res.statusCode !== 206 && !isValidFullBody) {
          fail(new Error(`Unexpected status ${res.statusCode} for range request`))
          res.resume()
          return
        }

        const fileStream = createWriteStream(destinationPath, { flags: append ? 'a' : 'w' })

        res.on('data', (chunk: Buffer) => {
          bytesDownloaded += chunk.length
          onProgress(bytesDownloaded)
        })

        res.on('error', fail)
        fileStream.on('error', fail)
        fileStream.on('finish', () => finish(resolve))

        res.pipe(fileStream)
      }
    )

    req.on('error', fail)
    req.end()
  })
}
