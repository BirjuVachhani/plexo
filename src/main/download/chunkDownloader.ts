import { createWriteStream, type WriteStream } from 'node:fs'
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

// A server that accepts the connection and then goes silent (no data, no
// error, no close) would otherwise hang the chunk forever with no way to
// detect or retry it.
const STALL_TIMEOUT_MS = 20_000

// Only the initial probe resolves redirects today — if a CDN reissues a
// redirect mid-download (e.g. a signed URL rotates), a chunk needs to be
// able to follow it too instead of failing outright.
const MAX_REDIRECTS = 5

interface ServedRange {
  start: number
  end: number
}

/** Parses `Content-Range: bytes <start>-<end>/<total>`. Returns null if it isn't in that form. */
function parseContentRange(value: string | string[] | undefined): ServedRange | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) return null
  const match = /^\s*bytes\s+(\d+)-(\d+)\/(?:\d+|\*)\s*$/i.exec(raw)
  if (!match) return null
  const start = Number(match[1])
  const end = Number(match[2])
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return { start, end }
}

/**
 * Downloads a single byte range of a URL, bound to one network interface, into a part file.
 *
 * Resolving means the *entire* requested range was written, and nothing else was:
 * a chunk's bytes land at a fixed offset in the reassembled file, so a response
 * that is short, starts somewhere else, or overruns the range would corrupt the
 * output rather than just this chunk. Every one of those is a rejection, which
 * puts the block back on the queue for a retry instead of marking it done.
 */
export function downloadChunk(options: ChunkDownloadOptions): Promise<void> {
  const { url, rangeStart, rangeEnd, localAddress, destinationPath, append, onProgress, signal } =
    options

  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const expectedBytes = rangeEnd === null ? null : rangeEnd - rangeStart + 1

    let bytesDownloaded = 0
    let settled = false
    let currentReq: ClientRequest | null = null
    let currentFileStream: WriteStream | null = null

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      fn()
    }

    const fail = (error: Error): void =>
      finish(() => {
        currentReq?.destroy()
        // Closing the part file matters twice over: an abandoned stream holds
        // its descriptor for the life of the process (a paused-and-resumed
        // download, or a chunk that retries a few times, leaks one per
        // attempt until the process hits its open-file limit), and its
        // buffered writes would otherwise land in the part file *after* a
        // resume has already reconciled that file's length. Discarding those
        // writes is safe: what survives on disk is what the next attempt
        // resumes from.
        const stream = currentFileStream
        if (stream && !stream.closed) {
          stream.once('close', () => reject(error))
          stream.destroy()
        } else {
          reject(error)
        }
      })

    const onAbort = (): void => fail(new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort)

    const rangeHeader =
      rangeEnd === null ? `bytes=${rangeStart}-` : `bytes=${rangeStart}-${rangeEnd}`

    const attempt = (targetUrl: URL, redirectsLeft: number): void => {
      const requester = targetUrl.protocol === 'https:' ? httpsRequest : httpRequest

      const req: ClientRequest = requester(
        {
          method: 'GET',
          hostname: targetUrl.hostname,
          port: targetUrl.port || undefined,
          path: `${targetUrl.pathname}${targetUrl.search}`,
          localAddress,
          // localAddress is always an IPv4 interface address — force the remote
          // host to resolve to IPv4 too, or binding fails with EINVAL when DNS
          // hands back an IPv6 address for it instead.
          family: 4,
          headers: { 'User-Agent': 'Plexo/1.0', Range: rangeHeader }
        },
        (res: IncomingMessage) => {
          const status = res.statusCode ?? 0

          if (status >= 300 && status < 400) {
            res.resume()
            if (!res.headers.location || redirectsLeft <= 0) {
              fail(new Error('Too many redirects for range request'))
              return
            }
            attempt(new URL(res.headers.location, targetUrl), redirectsLeft - 1)
            return
          }

          // A 200 is only correct here if we asked from byte 0 — otherwise the
          // server ignored our Range and we'd silently write the wrong bytes
          // into this chunk's slot. When the range is also bounded, the
          // length check at the end of the body is what confirms the server
          // sent this chunk rather than the whole file.
          const isValidFullBody = status === 200 && rangeStart === 0
          if (status !== 206 && !isValidFullBody) {
            fail(new Error(`Unexpected status ${status} for range request`))
            res.resume()
            return
          }

          // A 206 says where in the file these bytes belong — check it lines up
          // with what we asked for before writing any of them into the part file.
          if (status === 206) {
            const served = parseContentRange(res.headers['content-range'])
            if (!served) {
              fail(new Error('Server sent a 206 without a usable Content-Range header'))
              res.resume()
              return
            }
            if (served.start !== rangeStart) {
              fail(
                new Error(
                  `Server returned the wrong range: asked for byte ${rangeStart}, got ${served.start}`
                )
              )
              res.resume()
              return
            }
            if (rangeEnd !== null && served.end > rangeEnd) {
              fail(
                new Error(
                  `Server returned more than the requested range: through byte ${served.end}, asked through ${rangeEnd}`
                )
              )
              res.resume()
              return
            }
          }

          const fileStream: WriteStream = createWriteStream(destinationPath, {
            flags: append ? 'a' : 'w'
          })
          currentFileStream = fileStream

          res.on('error', fail)
          fileStream.on('error', fail)

          // Written by hand rather than piped so an overlong body can be cut off
          // at the range boundary: a part file longer than its block would push
          // every byte after it out of place at reassembly time.
          res.on('data', (chunk: Buffer) => {
            if (settled) return

            const remaining =
              expectedBytes === null ? chunk.length : expectedBytes - bytesDownloaded
            const usable =
              chunk.length <= remaining ? chunk : chunk.subarray(0, Math.max(remaining, 0))

            if (usable.length > 0) {
              bytesDownloaded += usable.length
              onProgress(bytesDownloaded)
              if (!fileStream.write(usable)) {
                res.pause()
                fileStream.once('drain', () => res.resume())
              }
            }

            if (usable.length < chunk.length) {
              fail(new Error('Server sent more data than the requested range'))
            }
          })

          res.on('end', () => {
            if (settled) return
            if (expectedBytes !== null && bytesDownloaded !== expectedBytes) {
              fail(
                new Error(
                  `Server returned ${bytesDownloaded} bytes for a ${expectedBytes}-byte range`
                )
              )
              return
            }
            // Windows cannot reliably reopen/remove a file until its handle closes.
            fileStream.once('close', () => finish(resolve))
            fileStream.end()
          })
        }
      )

      currentReq = req
      req.on('error', fail)
      req.setTimeout(STALL_TIMEOUT_MS, () =>
        fail(new Error('Connection stalled: no response from server'))
      )
      req.end()
    }

    attempt(new URL(url), MAX_REDIRECTS)
  })
}
