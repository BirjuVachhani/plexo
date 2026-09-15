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
import { reserveDestinationPath } from './paths'
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

/** Records that `interfaceId` delivered `deltaBytes` of this block. Attribution is per-network
 * rather than a single winner because one block can be started on one network and finished on
 * another (a retry after a dropped connection, or a pause/resume), and the grid colors blocks
 * by who actually moved the bytes. */
function creditBlockBytes(block: BlockState, interfaceId: string, deltaBytes: number): void {
  if (deltaBytes <= 0) return
  block.bytesByInterface[interfaceId] = (block.bytesByInterface[interfaceId] ?? 0) + deltaBytes
}

/** Drops attribution for bytes that turned out not to be on disk, so the per-network tallies
 * keep summing to the block's real byte count. The lost bytes are always at the tail of the
 * part file, so they come off the network that wrote last before spilling over to the rest. */
function trimBlockAttribution(block: BlockState, keepBytes: number, lastWriter?: string): void {
  let attributed = 0
  for (const bytes of Object.values(block.bytesByInterface)) attributed += bytes

  let excess = attributed - keepBytes
  if (excess <= 0) return

  const order = Object.keys(block.bytesByInterface).sort((a, b) =>
    a === lastWriter ? -1 : b === lastWriter ? 1 : 0
  )

  for (const interfaceId of order) {
    if (excess <= 0) break
    const taken = Math.min(block.bytesByInterface[interfaceId], excess)
    const remaining = block.bytesByInterface[interfaceId] - taken
    excess -= taken
    if (remaining > 0) block.bytesByInterface[interfaceId] = remaining
    else delete block.bytesByInterface[interfaceId]
  }
}

/** Total live speed across a download's worker connections (bounded by MAX_CHUNKS, unlike blocks). */
function sumChunkSpeeds(runtime: DownloadRuntime): number {
  let total = 0
  for (const chunk of runtime.state.chunks) {
    total += chunk.speedBytesPerSec
  }
  return total
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

    // Claimed on disk, not just picked, so a second download of the same file
    // name can't pick it too and overwrite this one at reassembly time.
    const destinationPath = await reserveDestinationPath(
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

    // Block size stays fixed regardless of file size, so work granularity — and
    // therefore resumability and load-balancing across workers — doesn't degrade
    // on huge files. MAX_REAL_BLOCKS is only a safety valve for pathologically
    // large files (multi-TB) so the block array doesn't blow up; it grows the
    // block size instead of the count once a file is big enough to hit it.
    // The UI caps how many cells it renders separately (see BlockGrid), by
    // bucketing these blocks rather than by shrinking their count here.
    const BASE_BLOCK_BYTES = 8 * 1024 * 1024 // 8 MB
    const MAX_REAL_BLOCKS = 4096

    let blockSizeBytes = 0
    const blocks: BlockState[] = []

    if (canSplit) {
      blockSizeBytes = Math.max(
        BASE_BLOCK_BYTES,
        Math.ceil(requestPayload.totalBytes / MAX_REAL_BLOCKS)
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
          bytesDownloaded: 0,
          bytesByInterface: {}
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
        bytesDownloaded: 0,
        bytesByInterface: {}
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
      await this.discardUnfinishedDestination(runtime)
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
    void this.discardUnfinishedDestination(runtime)
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
        await this.discardUnfinishedDestination(runtime)
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
    await this.discardUnfinishedDestination(runtime)
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

      // Whoever held this block before now is the one whose tail bytes a truncation below
      // would discard — capture it before the lease overwrites the field.
      const previousWriter = block.interfaceId
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
        trimBlockAttribution(block, resumeOffset, previousWriter)
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
              this.onWorkerProgress(runtime, chunk.id, block.index, iface.id, delta)
            }
          }
        })

        // Block finished successfully
        block.status = 'completed'
        block.interfaceId = iface.id
        if (block.rangeEnd !== null) {
          // Progress events can lag the final write, so square the block up to its exact size
          // and credit the shortfall to the network that finished it.
          const blockBytes = block.rangeEnd - block.rangeStart + 1
          creditBlockBytes(block, iface.id, blockBytes - block.bytesDownloaded)
          block.bytesDownloaded = blockBytes
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
    interfaceId: string,
    deltaBytes: number
  ): void {
    const chunk = runtime.state.chunks.find((entry) => entry.id === chunkId)
    const block = runtime.blocks[blockIndex]
    if (!chunk || !block) return

    chunk.bytesDownloaded += deltaBytes
    block.bytesDownloaded += deltaBytes
    creditBlockBytes(block, interfaceId, deltaBytes)
    chunk.currentBlockIndex = blockIndex

    const now = Date.now()
    let samples = runtime.speedSamplesByChunk.get(chunkId)
    if (!samples) {
      samples = []
      runtime.speedSamplesByChunk.set(chunkId, samples)
    }
    chunk.speedBytesPerSec = pushSpeedSample(samples, chunk.bytesDownloaded, now)

    // This runs on every socket data event, so it folds the delta in rather than re-summing
    // every block — that sum is O(blocks), and a large file has thousands of them. The other
    // callers of recomputeAggregates are rare enough to afford the full pass, and each one
    // re-derives the true total, so any drift here cannot accumulate.
    runtime.state.bytesDownloaded += deltaBytes
    runtime.state.speedBytesPerSec = sumChunkSpeeds(runtime)
    this.scheduleUpdate(runtime)
  }

  private recomputeAggregates(runtime: DownloadRuntime): void {
    runtime.state.bytesDownloaded = runtime.blocks.reduce(
      (sum, entry) => sum + entry.bytesDownloaded,
      0
    )
    runtime.state.speedBytesPerSec = sumChunkSpeeds(runtime)
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

  /**
   * Concatenates the part files into the destination, refusing to write a file
   * that isn't demonstrably the whole download. Every check here is a backstop
   * for a bug elsewhere rather than an expected condition — but the failure
   * mode it guards against is the worst one this app has: handing the user a
   * truncated file, calling it completed, and deleting the parts that would
   * have let them resume it.
   */
  private async reassemble(runtime: DownloadRuntime): Promise<void> {
    const missing = runtime.blocks.filter((block) => block.status !== 'completed')
    if (missing.length > 0) {
      throw new Error(
        `Download is incomplete: ${missing.length} of ${runtime.totalBlocks} parts never finished`
      )
    }

    const output = createWriteStream(runtime.state.destinationPath)
    let bytesWritten = 0

    // Attached before the first write, and kept for the stream's whole life:
    // destroying the output after a failed check can surface an in-flight
    // write as an 'error' event, and an unhandled 'error' on a stream takes
    // down the main process rather than failing this one download.
    const outputErrors: Error[] = []
    output.on('error', (error: Error) => outputErrors.push(error))

    try {
      for (let i = 0; i < runtime.totalBlocks; i++) {
        const partPath = join(runtime.tempDir, `part-${i}`)
        const block = runtime.blocks[i]
        const expectedBytes = block.rangeEnd === null ? null : block.rangeEnd - block.rangeStart + 1
        const actualBytes = (await stat(partPath)).size

        if (expectedBytes !== null && actualBytes !== expectedBytes) {
          throw new Error(
            `Part ${i} is ${actualBytes} bytes but should be ${expectedBytes} — refusing to write a corrupt file`
          )
        }

        await appendFileToStream(partPath, output)
        if (outputErrors.length > 0) throw outputErrors[0]
        bytesWritten += actualBytes
      }

      await new Promise<void>((resolve, reject) => {
        if (outputErrors.length > 0) {
          reject(outputErrors[0])
          return
        }
        output.on('error', reject)
        output.end(resolve)
      })
      if (outputErrors.length > 0) throw outputErrors[0]

      if (runtime.state.totalBytes > 0 && bytesWritten !== runtime.state.totalBytes) {
        throw new Error(
          `Assembled file is ${bytesWritten} bytes but should be ${runtime.state.totalBytes} — refusing to keep a corrupt file`
        )
      }
    } catch (error) {
      output.destroy()
      // Leaving a half-written file where the user expects their download is
      // worse than leaving nothing: it looks like the download they asked for.
      await rm(runtime.state.destinationPath, { force: true })
      throw error
    }
  }

  /**
   * Releases the placeholder file reserved at start when the download won't be
   * filling it in, so its name is free for the next attempt. Only ever removes
   * a path this download created and never finished writing — a completed
   * download keeps its file.
   */
  private async discardUnfinishedDestination(runtime: DownloadRuntime): Promise<void> {
    if (runtime.state.status === 'completed') return
    try {
      await rm(runtime.state.destinationPath, { force: true })
    } catch {
      // Best-effort — a stray empty file isn't worth failing the download over.
    }
  }

  private async cleanupTempDir(runtime: DownloadRuntime): Promise<void> {
    try {
      await rm(runtime.tempDir, { recursive: true, force: true })
    } catch {
      // Best-effort cleanup — a leftover temp dir isn't worth surfacing an error for.
    }
  }
}
