import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { app } from 'electron'
import { IpcChannels } from '../../shared/ipc-channels'
import type {
  ChunkState,
  DownloadState,
  NetworkInterfaceInfo,
  StartDownloadRequest
} from '../../shared/types'
import { downloadChunk } from './chunkDownloader'
import { getAvailableDestinationPath } from './paths'

interface ChunkRuntime {
  controller: AbortController
  partPath: string
}

interface SpeedSample {
  bytes: number
  time: number
}

interface DownloadRuntime {
  state: DownloadState
  requestPayload: StartDownloadRequest
  activeInterfaces: NetworkInterfaceInfo[]
  chunkRuntimes: Map<number, ChunkRuntime>
  tempDir: string
  speedSamplesByChunk: Map<number, SpeedSample[]>
  pushScheduled: boolean
}

const PROGRESS_THROTTLE_MS = 200

// Raw per-event deltas are too noisy to display (socket buffers flush in
// irregular bursts a few ms apart). Averaging over a few seconds instead
// gives a speed/ETA reading that tracks reality without jumping around.
const SPEED_WINDOW_MS = 3000

// Appends a sample and returns the average byte rate over SPEED_WINDOW_MS.
function pushSpeedSample(samples: SpeedSample[], bytes: number, time: number): number {
  samples.push({ bytes, time })

  const cutoff = time - SPEED_WINDOW_MS
  while (samples.length > 2 && samples[1].time <= cutoff) {
    samples.shift()
  }

  const oldest = samples[0]
  const deltaSeconds = (time - oldest.time) / 1000
  return deltaSeconds > 0 ? (bytes - oldest.bytes) / deltaSeconds : 0
}

function splitIntoRanges(
  totalBytes: number,
  count: number
): Array<{ start: number; end: number | null }> {
  const ranges: Array<{ start: number; end: number | null }> = []
  const baseSize = Math.floor(totalBytes / count)
  let start = 0
  for (let index = 0; index < count; index += 1) {
    const isLast = index === count - 1
    const end = isLast ? totalBytes - 1 : start + baseSize - 1
    ranges.push({ start, end })
    start = end + 1
  }
  return ranges
}

/** Appends one file's bytes onto an already-open writable, without ending it. */
function appendFileToStream(sourcePath: string, output: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    const input = createReadStream(sourcePath)
    input.on('error', reject)
    input.on('data', (chunk) => {
      const canContinue = output.write(chunk)
      if (!canContinue) {
        input.pause()
        output.once('drain', () => input.resume())
      }
    })
    input.on('end', resolve)
  })
}

export class DownloadManager {
  private runtimes = new Map<string, DownloadRuntime>()

  constructor(
    private getWindow: () => BrowserWindow | null,
    private getInterfaceById: (id: string) => NetworkInterfaceInfo | undefined
  ) {}

  async start(requestPayload: StartDownloadRequest): Promise<string> {
    const interfaces = requestPayload.interfaceIds
      .map((interfaceId) => this.getInterfaceById(interfaceId))
      .filter((iface): iface is NetworkInterfaceInfo => Boolean(iface))

    if (interfaces.length === 0) {
      throw new Error('Select at least one network interface')
    }

    const id = randomUUID()
    const tempDir = join(app.getPath('temp'), 'plexo', id)
    await mkdir(tempDir, { recursive: true })

    const destinationPath = getAvailableDestinationPath(
      requestPayload.destinationDir,
      requestPayload.suggestedFileName
    )

    const canSplit =
      requestPayload.supportsRanges && requestPayload.totalBytes > 0 && interfaces.length > 1
    const ranges = canSplit
      ? splitIntoRanges(requestPayload.totalBytes, interfaces.length)
      : [{ start: 0, end: requestPayload.totalBytes > 0 ? requestPayload.totalBytes - 1 : null }]
    const activeInterfaces = canSplit ? interfaces : [interfaces[0]]

    const chunks: ChunkState[] = ranges.map((range, index) => ({
      id: index,
      interfaceId: activeInterfaces[index].id,
      interfaceLabel: activeInterfaces[index].displayName,
      interfaceKind: activeInterfaces[index].kind,
      rangeStart: range.start,
      rangeEnd: range.end,
      bytesDownloaded: 0,
      speedBytesPerSec: 0,
      status: 'pending'
    }))

    const state: DownloadState = {
      id,
      url: requestPayload.url,
      fileName: basename(destinationPath),
      destinationPath,
      totalBytes: requestPayload.totalBytes,
      bytesDownloaded: 0,
      speedBytesPerSec: 0,
      status: 'downloading',
      chunks,
      startedAt: Date.now()
    }

    const runtime: DownloadRuntime = {
      state,
      requestPayload,
      activeInterfaces,
      chunkRuntimes: new Map(),
      tempDir,
      speedSamplesByChunk: new Map(),
      pushScheduled: false
    }
    this.runtimes.set(id, runtime)
    this.pushUpdate(runtime)

    void this.runChunksToCompletion(runtime, runtime.state.chunks)

    return id
  }

  pause(id: string): void {
    const runtime = this.runtimes.get(id)
    if (!runtime || runtime.state.status !== 'downloading') return

    runtime.state.status = 'paused'
    for (const chunkRuntime of runtime.chunkRuntimes.values()) {
      chunkRuntime.controller.abort()
    }
    this.pushUpdate(runtime)
  }

  resume(id: string): void {
    const runtime = this.runtimes.get(id)
    if (!runtime || runtime.state.status !== 'paused') return

    runtime.state.status = 'downloading'
    const pending = runtime.state.chunks.filter((chunk) => chunk.status !== 'completed')
    for (const chunk of pending) {
      runtime.speedSamplesByChunk.delete(chunk.id)
      chunk.speedBytesPerSec = 0
    }
    this.pushUpdate(runtime)

    void this.runChunksToCompletion(runtime, pending)
  }

  cancel(id: string): void {
    const runtime = this.runtimes.get(id)
    if (!runtime || (runtime.state.status !== 'downloading' && runtime.state.status !== 'paused'))
      return

    runtime.state.status = 'cancelled'
    for (const chunkRuntime of runtime.chunkRuntimes.values()) {
      chunkRuntime.controller.abort()
    }
    this.pushUpdate(runtime)
    void this.cleanupTempDir(runtime)
  }

  remove(id: string): void {
    const runtime = this.runtimes.get(id)
    if (runtime && (runtime.state.status === 'downloading' || runtime.state.status === 'paused')) {
      this.cancel(id)
    }
    this.runtimes.delete(id)
  }

  cancelAll(): void {
    for (const id of this.runtimes.keys()) {
      this.cancel(id)
    }
  }

  /** Runs (or resumes) a set of chunks in parallel, then reassembles once they're all done. */
  private async runChunksToCompletion(
    runtime: DownloadRuntime,
    chunks: ChunkState[]
  ): Promise<void> {
    const tasks = chunks.map((chunk) => this.runChunk(runtime, chunk))
    // Each task catches its own errors below, so this never rejects.
    await Promise.all(tasks)

    if (runtime.state.status !== 'downloading') {
      // Paused, errored, or cancelled — nothing left to do right now.
      if (runtime.state.status === 'error' || runtime.state.status === 'cancelled') {
        this.pushUpdate(runtime)
        await this.cleanupTempDir(runtime)
      }
      return
    }

    try {
      await this.reassemble(runtime)
      runtime.state.status = 'completed'
      runtime.state.completedAt = Date.now()
      runtime.state.bytesDownloaded = runtime.state.totalBytes || runtime.state.bytesDownloaded
    } catch (error) {
      runtime.state.status = 'error'
      runtime.state.error = error instanceof Error ? error.message : String(error)
    }

    this.pushUpdate(runtime)
    await this.cleanupTempDir(runtime)
  }

  private async runChunk(runtime: DownloadRuntime, chunk: ChunkState): Promise<void> {
    const iface = runtime.activeInterfaces[chunk.id]
    const resumeOffset = chunk.bytesDownloaded
    const controller = new AbortController()
    const existing = runtime.chunkRuntimes.get(chunk.id)
    const partPath = existing?.partPath ?? join(runtime.tempDir, `part-${chunk.id}`)
    runtime.chunkRuntimes.set(chunk.id, { controller, partPath })
    chunk.status = 'downloading'
    this.scheduleUpdate(runtime)

    try {
      await downloadChunk({
        url: runtime.requestPayload.url,
        rangeStart: chunk.rangeStart + resumeOffset,
        rangeEnd: chunk.rangeEnd,
        localAddress: iface.address,
        destinationPath: partPath,
        append: resumeOffset > 0,
        signal: controller.signal,
        onProgress: (bytesThisRun) =>
          this.onChunkProgress(runtime, chunk.id, resumeOffset + bytesThisRun)
      })
      chunk.status = 'completed'
    } catch (error) {
      if (controller.signal.aborted) {
        chunk.status = runtime.state.status === 'paused' ? 'paused' : 'cancelled'
      } else {
        const message = error instanceof Error ? error.message : String(error)
        chunk.status = 'error'
        chunk.error = message
        // Fail fast: one broken connection shouldn't leave the others
        // downloading a file we're about to discard anyway.
        if (runtime.state.status === 'downloading') {
          runtime.state.status = 'error'
          runtime.state.error = message
          for (const chunkRuntime of runtime.chunkRuntimes.values()) {
            chunkRuntime.controller.abort()
          }
        }
      }
    } finally {
      this.scheduleUpdate(runtime)
    }
  }

  private onChunkProgress(
    runtime: DownloadRuntime,
    chunkId: number,
    bytesDownloaded: number
  ): void {
    const chunk = runtime.state.chunks.find((entry) => entry.id === chunkId)
    if (!chunk) return

    const now = Date.now()
    let samples = runtime.speedSamplesByChunk.get(chunkId)
    if (!samples) {
      samples = []
      runtime.speedSamplesByChunk.set(chunkId, samples)
    }
    chunk.speedBytesPerSec = pushSpeedSample(samples, bytesDownloaded, now)
    chunk.bytesDownloaded = bytesDownloaded

    runtime.state.bytesDownloaded = runtime.state.chunks.reduce(
      (sum, entry) => sum + entry.bytesDownloaded,
      0
    )
    runtime.state.speedBytesPerSec = runtime.state.chunks.reduce(
      (sum, entry) => sum + entry.speedBytesPerSec,
      0
    )

    this.scheduleUpdate(runtime)
  }

  private scheduleUpdate(runtime: DownloadRuntime): void {
    if (runtime.pushScheduled) return
    runtime.pushScheduled = true
    setTimeout(() => {
      runtime.pushScheduled = false
      this.pushUpdate(runtime)
    }, PROGRESS_THROTTLE_MS)
  }

  private pushUpdate(runtime: DownloadRuntime): void {
    const window = this.getWindow()
    if (!window || window.isDestroyed()) return
    window.webContents.send(IpcChannels.downloadUpdated, structuredClone(runtime.state))
  }

  private async reassemble(runtime: DownloadRuntime): Promise<void> {
    const output = createWriteStream(runtime.state.destinationPath)

    try {
      for (const chunk of runtime.state.chunks) {
        const chunkRuntime = runtime.chunkRuntimes.get(chunk.id)
        if (!chunkRuntime) throw new Error(`Missing part file for chunk ${chunk.id}`)
        await appendFileToStream(chunkRuntime.partPath, output)
      }
    } catch (error) {
      output.destroy()
      throw error
    }

    await new Promise<void>((resolve, reject) => {
      output.on('error', reject)
      output.end(resolve)
    })
  }

  private async cleanupTempDir(runtime: DownloadRuntime): Promise<void> {
    try {
      await rm(runtime.tempDir, { recursive: true, force: true })
    } catch {
      // Best-effort cleanup — a leftover temp dir isn't worth surfacing an error for.
    }
  }
}
