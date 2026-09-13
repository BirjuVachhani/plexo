import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rm, stat, statfs, truncate } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { app } from 'electron'
import { IpcChannels } from '../../shared/ipc-channels'
import type {
  BlockState,
  ChunkState,
  DownloadState,
  DownloadStatus,
  NetworkInterfaceInfo,
  StartDownloadRequest
} from '../../shared/types'
import { downloadChunk } from './chunkDownloader'
import { getAvailableDestinationPath } from './paths'
import { isResourceUnchanged } from './probe'

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
  blocks: BlockState[]
  totalBlocks: number
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

// Defensive cap independent of whatever the renderer sends — chunks are
// distributed round-robin across interfaces, not tied 1:1 to them anymore.
const MAX_CHUNKS = 32

const MAX_CHUNK_RETRIES = 5
const RETRY_BASE_DELAY_MS = 1000
const RETRY_MAX_DELAY_MS = 15_000

function retryDelayMs(attempt: number): number {
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS)
}

/** Waits, but returns early if the signal aborts (pause/cancel shouldn't wait out a retry backoff). */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

// A part file's on-disk size is the only thing we can actually trust across
// a retry or resume — appending opens the file with flag 'a', which always
// writes at the real end-of-file regardless of what byte count we think
// we're at, so any mismatch (a crash, a write that hadn't flushed yet)
// would otherwise silently shift every byte after it. Truncating to the
// smaller of the two counts keeps the part file's length and our own
// bookkeeping in agreement before we append another byte to it.
async function reconcilePartFileSize(partPath: string, expectedBytes: number): Promise<number> {
  let actualBytes = 0
  try {
    actualBytes = (await stat(partPath)).size
  } catch {
    actualBytes = 0
  }

  const safeBytes = Math.min(expectedBytes, actualBytes)
  if (actualBytes !== safeBytes) {
    await truncate(partPath, safeBytes)
  }
  return safeBytes
}

function formatGigabytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

/** Throws if the destination volume doesn't have room for the download — a full disk should
 * fail upfront with a clear reason, not partway through as a confusing ENOSPC write error. */
async function ensureDiskSpace(destinationDir: string, requiredBytes: number): Promise<void> {
  if (requiredBytes <= 0) return // unknown size — nothing to check against

  const stats = await statfs(destinationDir)
  const availableBytes = stats.bavail * stats.bsize
  if (availableBytes < requiredBytes) {
    throw new Error(
      `Not enough disk space: this download needs ${formatGigabytes(requiredBytes)} but only ${formatGigabytes(availableBytes)} is free`
    )
  }
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

    await ensureDiskSpace(requestPayload.destinationDir, requestPayload.totalBytes)

    const id = randomUUID()
    const tempDir = join(app.getPath('temp'), 'plexo', id)
    await mkdir(tempDir, { recursive: true })

    const destinationPath = getAvailableDestinationPath(
      requestPayload.destinationDir,
      requestPayload.suggestedFileName
    )

    const connectionsPerNetwork = Math.max(
      1,
      Math.min(
        8,
        requestPayload.connectionsPerNetwork ??
          Math.max(1, Math.round(requestPayload.chunkCount / interfaces.length))
      )
    )
    const canSplit = requestPayload.supportsRanges && requestPayload.totalBytes > 0

    const TARGET_BLOCKS = 64
    const MIN_BLOCK_BYTES = 4 * 1024 * 1024 // 4 MB minimum block size

    let blockSizeBytes = 0
    const blocks: BlockState[] = []

    if (canSplit) {
      blockSizeBytes = Math.max(
        MIN_BLOCK_BYTES,
        Math.ceil(requestPayload.totalBytes / TARGET_BLOCKS)
      )
      let offset = 0
      let bIdx = 0
      while (offset < requestPayload.totalBytes) {
        const bEnd = Math.min(offset + blockSizeBytes - 1, requestPayload.totalBytes - 1)
        blocks.push({
          index: bIdx++,
          rangeStart: offset,
          rangeEnd: bEnd,
          status: 'pending',
          bytesDownloaded: 0
        })
        offset = bEnd + 1
      }
    } else {
      blockSizeBytes = requestPayload.totalBytes > 0 ? requestPayload.totalBytes : 0
      blocks.push({
        index: 0,
        rangeStart: 0,
        rangeEnd: requestPayload.totalBytes > 0 ? requestPayload.totalBytes - 1 : null,
        status: 'pending',
        bytesDownloaded: 0
      })
    }

    const chunks: ChunkState[] = []
    const activeInterfaces: NetworkInterfaceInfo[] = []
    let workerIdCounter = 0

    if (canSplit) {
      for (const iface of interfaces) {
        for (let connIdx = 0; connIdx < connectionsPerNetwork; connIdx++) {
          if (chunks.length >= MAX_CHUNKS) break
          activeInterfaces.push(iface)
          chunks.push({
            id: workerIdCounter++,
            interfaceId: iface.id,
            interfaceLabel: iface.displayName,
            interfaceKind: iface.kind,
            rangeStart: 0,
            rangeEnd: null,
            bytesDownloaded: 0,
            speedBytesPerSec: 0,
            status: 'pending',
            retryCount: 0
          })
        }
      }
    } else {
      activeInterfaces.push(interfaces[0])
      chunks.push({
        id: 0,
        interfaceId: interfaces[0].id,
        interfaceLabel: interfaces[0].displayName,
        interfaceKind: interfaces[0].kind,
        rangeStart: 0,
        rangeEnd: requestPayload.totalBytes > 0 ? requestPayload.totalBytes - 1 : null,
        bytesDownloaded: 0,
        speedBytesPerSec: 0,
        status: 'pending',
        retryCount: 0
      })
    }

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
      blocks,
      totalBlocks: blocks.length,
      blockSizeBytes,
      startedAt: Date.now()
    }

    const runtime: DownloadRuntime = {
      state,
      requestPayload,
      activeInterfaces,
      chunkRuntimes: new Map(),
      tempDir,
      speedSamplesByChunk: new Map(),
      pushScheduled: false,
      blocks,
      totalBlocks: blocks.length
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
    runtime.state.speedBytesPerSec = 0
    runtime.state.pausedAt = Date.now()
    for (const chunk of runtime.state.chunks) {
      if (chunk.status !== 'completed') {
        chunk.status = 'paused'
      }
      chunk.speedBytesPerSec = 0
    }
    for (const block of runtime.blocks) {
      if (block.status === 'downloading') {
        block.status = 'pending'
      }
    }
    for (const chunkRuntime of runtime.chunkRuntimes.values()) {
      chunkRuntime.controller.abort()
    }
    this.pushUpdate(runtime)
  }

  resume(id: string): void {
    const runtime = this.runtimes.get(id)
    if (!runtime || runtime.state.status !== 'paused') return

    void this.resumeAfterVerifying(runtime)
  }

  // Appending onto part files assumes the remote file hasn't changed since
  // it was probed — if the server's ETag/Last-Modified moved on while this
  // download sat paused, resuming would silently stitch old and new bytes
  // together. Check first, and refuse to resume rather than corrupt the
  // output (the user can always start the download over from scratch).
  private async resumeAfterVerifying(runtime: DownloadRuntime): Promise<void> {
    const { url, etag, lastModified } = runtime.requestPayload
    const unchanged = await isResourceUnchanged(url, etag, lastModified)

    if (runtime.state.status !== 'paused') return // cancelled while we were checking

    if (!unchanged) {
      runtime.state.status = 'error'
      runtime.state.error =
        'The remote file changed while this download was paused, so resuming would corrupt it. Start the download over instead.'
      this.pushUpdate(runtime)
      return
    }

    runtime.state.status = 'downloading'
    if (runtime.state.pausedAt) {
      runtime.state.totalPausedMs =
        (runtime.state.totalPausedMs || 0) + (Date.now() - runtime.state.pausedAt)
      runtime.state.pausedAt = undefined
    }
    for (const block of runtime.blocks) {
      if (block.status !== 'completed') {
        block.status = 'pending'
      }
    }
    for (const chunk of runtime.state.chunks) {
      if (chunk.status !== 'completed') {
        chunk.status = 'pending'
      }
      runtime.speedSamplesByChunk.delete(chunk.id)
      chunk.speedBytesPerSec = 0
    }
    this.pushUpdate(runtime)

    const pending = runtime.state.chunks.filter((chunk) => chunk.status !== 'completed')
    void this.runChunksToCompletion(runtime, pending.length > 0 ? pending : runtime.state.chunks)
  }

  cancel(id: string): void {
    const runtime = this.runtimes.get(id)
    if (!runtime || (runtime.state.status !== 'downloading' && runtime.state.status !== 'paused'))
      return

    runtime.state.status = 'cancelled'
    runtime.state.speedBytesPerSec = 0
    for (const chunk of runtime.state.chunks) {
      chunk.speedBytesPerSec = 0
      chunk.status = 'cancelled'
    }
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

  /** Runs (or resumes) fixed worker streams in parallel, leasing blocks until all are completed. */
  private async runChunksToCompletion(
    runtime: DownloadRuntime,
    chunks: ChunkState[]
  ): Promise<void> {
    const active = new Map<number, Promise<number>>()
    for (const chunk of chunks) {
      active.set(
        chunk.id,
        this.runWorker(runtime, chunk).then(() => chunk.id)
      )
    }

    while (active.size > 0) {
      const finishedId = await Promise.race(active.values())
      active.delete(finishedId)
    }

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

  private async runWorker(runtime: DownloadRuntime, chunk: ChunkState): Promise<void> {
    const iface =
      runtime.activeInterfaces.find((i) => i.id === chunk.interfaceId) ??
      runtime.activeInterfaces[chunk.id]

    const controller = new AbortController()
    runtime.chunkRuntimes.set(chunk.id, { controller, partPath: '' })

    let attempt = 0

    while (runtime.state.status === 'downloading') {
      if (controller.signal.aborted) break

      // Atomically lease the next pending block in this event tick
      const block = runtime.blocks.find((b) => b.status === 'pending')
      if (!block) {
        // If other workers are still downloading, remain idle briefly in case a block fails and resets
        const anyStillDownloading = runtime.blocks.some((b) => b.status === 'downloading')
        if (anyStillDownloading) {
          chunk.speedBytesPerSec = 0
          this.scheduleUpdate(runtime)
          await delay(250, controller.signal).catch(() => {})
          continue
        }
        chunk.status = 'completed'
        chunk.speedBytesPerSec = 0
        this.scheduleUpdate(runtime)
        break
      }

      block.status = 'downloading'
      block.interfaceId = iface.id
      chunk.status = 'downloading'
      chunk.rangeStart = block.rangeStart
      chunk.rangeEnd = block.rangeEnd
      chunk.currentBlockIndex = block.index
      this.scheduleUpdate(runtime)

      const partPath = join(runtime.tempDir, `part-${block.index}`)
      const chunkRuntime = runtime.chunkRuntimes.get(chunk.id)
      if (chunkRuntime) {
        chunkRuntime.partPath = partPath
      }

      const resumeOffset = await reconcilePartFileSize(partPath, block.bytesDownloaded)
      if (resumeOffset !== block.bytesDownloaded) {
        block.bytesDownloaded = resumeOffset
        this.recomputeAggregates(runtime)
      }

      if (block.rangeEnd !== null && block.rangeStart + resumeOffset > block.rangeEnd) {
        block.status = 'completed'
        block.interfaceId = iface.id
        this.recomputeAggregates(runtime)
        this.scheduleUpdate(runtime)
        continue
      }

      let lastReportedThisRun = 0

      try {
        await downloadChunk({
          url: runtime.requestPayload.url,
          rangeStart: block.rangeStart + resumeOffset,
          rangeEnd: block.rangeEnd,
          localAddress: iface.address,
          destinationPath: partPath,
          append: resumeOffset > 0,
          signal: controller.signal,
          onProgress: (bytesThisRun) => {
            const delta = bytesThisRun - lastReportedThisRun
            lastReportedThisRun = bytesThisRun
            if (delta > 0) {
              this.onWorkerProgress(runtime, chunk.id, block.index, delta)
            }
          }
        })

        // Block finished successfully
        block.status = 'completed'
        block.interfaceId = iface.id
        if (block.rangeEnd !== null) {
          block.bytesDownloaded = block.rangeEnd - block.rangeStart + 1
        }
        attempt = 0
        this.recomputeAggregates(runtime)
        this.scheduleUpdate(runtime)
      } catch (error) {
        const currentStatus = runtime.state.status as DownloadStatus
        if (controller.signal.aborted || currentStatus !== 'downloading') {
          if (currentStatus === 'paused') {
            block.status = 'pending'
            chunk.status = 'paused'
          } else {
            chunk.status = 'cancelled'
          }
          chunk.speedBytesPerSec = 0
          break
        }

        const message = error instanceof Error ? error.message : String(error)
        chunk.error = message
        attempt += 1
        chunk.retryCount += 1

        // Return block back to queue so any available worker can pick it up
        block.status = 'pending'

        if (attempt > MAX_CHUNK_RETRIES) {
          chunk.status = 'error'
          chunk.speedBytesPerSec = 0
          const allErrored = runtime.state.chunks.every((c) => c.status === 'error')
          if (allErrored && (runtime.state.status as DownloadStatus) === 'downloading') {
            runtime.state.status = 'error'
            runtime.state.error = message
            for (const cr of runtime.chunkRuntimes.values()) {
              cr.controller.abort()
            }
          }
          break
        }

        chunk.status = 'retrying'
        this.scheduleUpdate(runtime)
        await delay(retryDelayMs(attempt), controller.signal).catch(() => {})
        const statusAfterDelay = runtime.state.status as DownloadStatus
        if (controller.signal.aborted || statusAfterDelay !== 'downloading') {
          chunk.status = statusAfterDelay === 'paused' ? 'paused' : 'cancelled'
          chunk.speedBytesPerSec = 0
          break
        }
        chunk.status = 'downloading'
      }
    }

    this.scheduleUpdate(runtime)
  }

  private onWorkerProgress(
    runtime: DownloadRuntime,
    chunkId: number,
    blockIndex: number,
    deltaBytes: number
  ): void {
    const chunk = runtime.state.chunks.find((entry) => entry.id === chunkId)
    const block = runtime.blocks[blockIndex]
    if (!chunk || !block) return

    chunk.bytesDownloaded += deltaBytes
    block.bytesDownloaded += deltaBytes
    chunk.currentBlockIndex = blockIndex

    const now = Date.now()
    let samples = runtime.speedSamplesByChunk.get(chunkId)
    if (!samples) {
      samples = []
      runtime.speedSamplesByChunk.set(chunkId, samples)
    }
    chunk.speedBytesPerSec = pushSpeedSample(samples, chunk.bytesDownloaded, now)

    this.recomputeAggregates(runtime)
    this.scheduleUpdate(runtime)
  }

  private recomputeAggregates(runtime: DownloadRuntime): void {
    runtime.state.bytesDownloaded = runtime.blocks.reduce(
      (sum, entry) => sum + entry.bytesDownloaded,
      0
    )
    runtime.state.speedBytesPerSec = runtime.state.chunks.reduce(
      (sum, entry) => sum + entry.speedBytesPerSec,
      0
    )
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
    if (runtime.state.status === 'paused' || runtime.state.status === 'cancelled') {
      runtime.state.speedBytesPerSec = 0
    }
    window.webContents.send(IpcChannels.downloadUpdated, structuredClone(runtime.state))
  }

  private async reassemble(runtime: DownloadRuntime): Promise<void> {
    const output = createWriteStream(runtime.state.destinationPath)

    try {
      for (let i = 0; i < runtime.totalBlocks; i++) {
        const partPath = join(runtime.tempDir, `part-${i}`)
        await appendFileToStream(partPath, output)
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
