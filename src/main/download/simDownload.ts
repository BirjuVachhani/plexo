import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { NetworkInterfaceInfo, SimulatedNetworkConfig } from '../../shared/types'
import type { ChunkDownloadOptions } from './chunkDownloader'

/** Marks a download as sourced from a local file rather than the network — the rest of
 * `DownloadManager` treats `requestPayload.url` as opaque, so this prefix is the only thing
 * that has to recognize a simulated download and route it to `downloadChunkSimulated` instead
 * of the real HTTP `downloadChunk`. */
const SIM_URL_PREFIX = 'plexo-sim://'

export function isSimulatedUrl(url: string): boolean {
  return url.startsWith(SIM_URL_PREFIX)
}

interface SimSession {
  sourcePath: string
  /** Keyed by the synthetic NetworkInterfaceInfo.id assigned to each simulated network. */
  networks: Map<string, SimulatedNetworkConfig>
  /** When each network is next free to deliver, by the same id. A network's speed is shared by
   * all of its streams, as a real link's is: a stream more doesn't make it any faster. */
  busyUntil: Map<string, number>
}

const sessions = new Map<string, SimSession>()

/** Registers one dev-tool "virtual download" run and returns the `plexo-sim://<token>` url to
 * use as its `StartDownloadRequest.url` — everything downstream (blocks, chunks, persistence,
 * storage) is unaware this isn't a real network transfer. */
function registerSimSession(
  sourcePath: string,
  networks: Map<string, SimulatedNetworkConfig>
): string {
  const token = randomUUID()
  sessions.set(token, { sourcePath, networks, busyUntil: new Map() })
  return token
}

export function unregisterSimSession(url: string): void {
  if (!isSimulatedUrl(url)) return
  sessions.delete(url.slice(SIM_URL_PREFIX.length))
}

/** Builds the synthetic interfaces + registers the sim session a `StartDownloadRequest` needs
 * to drive a simulated download through the normal `DownloadManager.start()` path. */
export async function createSimSession(
  sourceFilePath: string,
  networkConfigs: SimulatedNetworkConfig[]
): Promise<{ url: string; interfaces: NetworkInterfaceInfo[]; totalBytes: number }> {
  const fileStat = await stat(sourceFilePath)
  const networks = new Map<string, SimulatedNetworkConfig>()
  const interfaces: NetworkInterfaceInfo[] = networkConfigs.map((config, index) => {
    const id = `sim-${index}-${randomUUID().slice(0, 8)}`
    networks.set(id, config)
    return {
      id,
      device: id,
      displayName: config.label,
      addresses: [],
      kind: config.kind
    }
  })

  const token = registerSimSession(sourceFilePath, networks)
  return { url: `${SIM_URL_PREFIX}${token}`, interfaces, totalBytes: fileStat.size }
}

const DEFAULT_SPEED_BYTES_PER_SEC = 3 * 1024 * 1024

/** Local-file stand-in for `downloadChunk()` — same contract (resolves only once the exact
 * byte range is written to the supplied writer, honors `signal`, calls `onProgress` with
 * cumulative bytes) so `DownloadManager` can swap one for the other without knowing which one
 * it's running. Reads the requested range off disk instead of over HTTP, throttled to the
 * simulated network's configured speed so the UI has something real to show — a chunk grid or
 * speed readout that jumped from 0 to 100% instantly would defeat the point of simulating it. */
export function downloadChunkSimulated(options: ChunkDownloadOptions): Promise<void> {
  const {
    url,
    rangeStart,
    rangeEnd,
    connection,
    createDestination,
    onNetworkProgress,
    onProgress,
    signal
  } = options

  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const session = sessions.get(url.slice(SIM_URL_PREFIX.length))
    if (!session) {
      reject(new Error('Simulated download session no longer exists (was the dev tool closed?)'))
      return
    }

    const network = session.networks.get(connection.iface.id)
    if (network && Math.random() * 100 < network.faultRatePercent) {
      reject(new Error(`Simulated drop on ${network.label}`))
      return
    }
    const speedBytesPerSec = network?.speedBytesPerSec ?? DEFAULT_SPEED_BYTES_PER_SEC

    const expectedBytes = rangeEnd === null ? null : rangeEnd - rangeStart + 1
    const input = createReadStream(session.sourcePath, {
      start: rangeStart,
      end: rangeEnd ?? undefined
    })
    const output = createDestination()

    let bytesWritten = 0
    let settled = false

    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      fn()
    }
    const fail = (error: Error): void =>
      settle(() => {
        input.destroy()
        output.destroy()
        reject(error)
      })
    const onAbort = (): void => fail(new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort)

    input.on('error', fail)
    output.on('error', fail)

    input.on('data', (chunk: string | Buffer) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      // Pausing the source for a delay proportional to this chunk's size — rather than writing
      // everything Node hands us as fast as disk I/O allows — is what makes the simulated speed
      // real: a real download is limited by the network, so the block grid and speed readout
      // should move at a rate this slow, not spike and then sit idle.
      input.pause()
      const now = Date.now()
      const deliveredAt =
        Math.max(now, session.busyUntil.get(connection.iface.id) ?? 0) +
        (buffer.length / speedBytesPerSec) * 1000
      session.busyUntil.set(connection.iface.id, deliveredAt)
      const delayMs = Math.max(1, deliveredAt - now)
      setTimeout(() => {
        if (settled) return
        bytesWritten += buffer.length
        const progress = bytesWritten
        onNetworkProgress(progress)
        output.write(buffer, (error) => {
          if (error) fail(error)
          else if (!settled) {
            onProgress(progress)
            input.resume()
          }
        })
      }, delayMs)
    })

    input.on('end', () => output.end())
    output.on('finish', () => {
      if (expectedBytes !== null && bytesWritten !== expectedBytes) {
        fail(new Error(`Simulated chunk wrote ${bytesWritten} bytes but expected ${expectedBytes}`))
        return
      }
      settle(resolve)
    })
  })
}
