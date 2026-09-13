import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rm, stat, statfs, truncate } from 'node:fs/promises'
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
  /** Chunk ids whose in-flight request was just aborted by a range split, not a pause/cancel —
   * runChunk checks this to tell the two apart and restart instead of stopping. */
  resizingChunkIds: Set<number>
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

// A connection that finishes its own range early shouldn't just sit idle
// while a sibling connection is still crawling through a much bigger one —
// steal half of whichever chunk has the most bytes left. Only worth it
// above a minimum size, so a nearly-finished download doesn't spawn a
// connection for the last few KB.
const MIN_STEAL_BYTES = 1024 * 1024

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
    const canSplit =
      requestPayload.supportsRanges &&
      requestPayload.totalBytes > 0 &&
      (interfaces.length > 1 || connectionsPerNetwork > 1)

    const chunks: ChunkState[] = []
    const activeInterfaces: NetworkInterfaceInfo[] = []

    if (canSplit) {
      const netCount = interfaces.length
      let chunkIdCounter = 0

      for (let netIdx = 0; netIdx < netCount; netIdx++) {
        const iface = interfaces[netIdx]
        const netStart = Math.floor((netIdx * requestPayload.totalBytes) / netCount)
        const netEnd =
          netIdx === netCount - 1
            ? requestPayload.totalBytes - 1
            : Math.floor(((netIdx + 1) * requestPayload.totalBytes) / netCount) - 1
        const netSize = netEnd - netStart + 1

        for (let connIdx = 0; connIdx < connectionsPerNetwork; connIdx++) {
          if (chunks.length >= MAX_CHUNKS) break
          const chunkStart = netStart + Math.floor((connIdx * netSize) / connectionsPerNetwork)
          const chunkEnd =
            connIdx === connectionsPerNetwork - 1
              ? netEnd
              : netStart + Math.floor(((connIdx + 1) * netSize) / connectionsPerNetwork) - 1

          activeInterfaces.push(iface)
          chunks.push({
            id: chunkIdCounter++,
            interfaceId: iface.id,
            interfaceLabel: iface.displayName,
            interfaceKind: iface.kind,
            rangeStart: chunkStart,
            rangeEnd: chunkEnd,
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
      resizingChunkIds: new Set()
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
    runtime.state.speedBytesPerSec = 0
    for (const chunk of runtime.state.chunks) {
      chunk.speedBytesPerSec = 0
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

  /** Runs (or resumes) a set of chunks in parallel, then reassembles once they're all done. */
  private async runChunksToCompletion(
    runtime: DownloadRuntime,
    chunks: ChunkState[]
  ): Promise<void> {
    // A plain Promise.all can't grow once started — but a chunk that finishes
    // early may hand off half of a slower sibling's remaining range to a
    // brand new chunk, so the wait set has to be able to pick up new tasks
    // as they're spawned. Track it as chunk id -> its run promise instead.
    const active = new Map<number, Promise<number>>()
    for (const chunk of chunks) {
      active.set(
        chunk.id,
        this.runChunk(runtime, chunk).then(() => chunk.id)
      )
    }

    // Each run promise catches its own errors below, so this never rejects.
    while (active.size > 0) {
      const finishedId = await Promise.race(active.values())
      active.delete(finishedId)

      if (runtime.state.status === 'downloading') {
        const finishedChunk = runtime.state.chunks.find((entry) => entry.id === finishedId)
        const stolenChunk =
          finishedChunk?.status === 'completed'
            ? this.stealWorkForIdleConnection(runtime, finishedChunk)
            : null
        if (stolenChunk) {
          active.set(
            stolenChunk.id,
            this.runChunk(runtime, stolenChunk).then(() => stolenChunk.id)
          )
        }
      }
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

  /**
   * Called when `freedChunk` finishes while others are still running. Finds
   * whichever active chunk has the most bytes left, shrinks it in place, and
   * returns a new chunk covering the back half for the now-idle connection
   * to pick up — or null if nothing is worth splitting yet.
   */
  private stealWorkForIdleConnection(
    runtime: DownloadRuntime,
    freedChunk: ChunkState
  ): ChunkState | null {
    if (!runtime.requestPayload.supportsRanges) return null

    let victim: ChunkState | null = null
    let victimRemaining = 0
    for (const candidate of runtime.state.chunks) {
      if (candidate.status !== 'downloading' || candidate.rangeEnd === null) continue
      const remaining = candidate.rangeEnd - (candidate.rangeStart + candidate.bytesDownloaded) + 1
      if (remaining > victimRemaining) {
        victim = candidate
        victimRemaining = remaining
      }
    }

    // Only worth splitting if both halves clear the minimum — otherwise the
    // new connection would spend more time on setup than on actual transfer.
    if (!victim || victimRemaining < MIN_STEAL_BYTES * 2) return null

    const freedInterface = runtime.activeInterfaces[freedChunk.id]
    const victimRuntime = runtime.chunkRuntimes.get(victim.id)
    if (!freedInterface || !victimRuntime) return null

    const victimPosition = victim.rangeStart + victim.bytesDownloaded
    const splitPoint = victimPosition + Math.floor(victimRemaining / 2)
    const originalRangeEnd = victim.rangeEnd

    // Swap in a fresh controller before aborting the old one — runChunk reads
    // the controller fresh on every loop iteration, so once its in-flight
    // request rejects it picks the new one back up instead of stopping.
    runtime.resizingChunkIds.add(victim.id)
    runtime.chunkRuntimes.set(victim.id, {
      controller: new AbortController(),
      partPath: victimRuntime.partPath
    })
    victimRuntime.controller.abort()
    victim.rangeEnd = splitPoint - 1

    // Reuse the same activeInterfaces[chunk.id] lookup runChunk already does
    // for every other chunk, rather than introducing a second lookup path.
    runtime.activeInterfaces.push(freedInterface)
    const newChunk: ChunkState = {
      id: runtime.activeInterfaces.length - 1,
      interfaceId: freedInterface.id,
      interfaceLabel: freedInterface.displayName,
      interfaceKind: freedInterface.kind,
      rangeStart: splitPoint,
      rangeEnd: originalRangeEnd,
      bytesDownloaded: 0,
      speedBytesPerSec: 0,
      status: 'pending',
      retryCount: 0
    }
    runtime.state.chunks.push(newChunk)
    this.scheduleUpdate(runtime)
    return newChunk
  }

  private async runChunk(runtime: DownloadRuntime, chunk: ChunkState): Promise<void> {
    const iface = runtime.activeInterfaces[chunk.id]
    const controller = new AbortController()
    const existing = runtime.chunkRuntimes.get(chunk.id)
    const partPath = existing?.partPath ?? join(runtime.tempDir, `part-${chunk.id}`)
    runtime.chunkRuntimes.set(chunk.id, { controller, partPath })
    chunk.status = 'downloading'
    this.scheduleUpdate(runtime)

    // A dropped connection shouldn't fail the whole download outright — most
    // network blips are transient, so give the chunk a few tries with
    // backoff before giving up on it (and, by extension, the download).
    let attempt = 0
    for (;;) {
      // Read fresh each pass — a sibling connection stealing half of this
      // chunk's range swaps in a new controller and a smaller rangeEnd.
      const activeController = runtime.chunkRuntimes.get(chunk.id)?.controller ?? controller

      const resumeOffset = await reconcilePartFileSize(partPath, chunk.bytesDownloaded)
      if (resumeOffset !== chunk.bytesDownloaded) {
        chunk.bytesDownloaded = resumeOffset
        runtime.speedSamplesByChunk.delete(chunk.id)
        this.recomputeAggregates(runtime)
      }

      try {
        await downloadChunk({
          url: runtime.requestPayload.url,
          rangeStart: chunk.rangeStart + resumeOffset,
          rangeEnd: chunk.rangeEnd,
          localAddress: iface.address,
          destinationPath: partPath,
          append: resumeOffset > 0,
          signal: activeController.signal,
          onProgress: (bytesThisRun) =>
            this.onChunkProgress(runtime, chunk.id, resumeOffset + bytesThisRun)
        })
        chunk.status = 'completed'
        break
      } catch (error) {
        if (activeController.signal.aborted) {
          if (runtime.resizingChunkIds.delete(chunk.id)) {
            // Not a pause/cancel — a sibling just stole the back half of our
            // range. The fresh controller is already in place; keep going.
            continue
          }
          chunk.status = runtime.state.status === 'paused' ? 'paused' : 'cancelled'
          chunk.speedBytesPerSec = 0
          break
        }

        const message = error instanceof Error ? error.message : String(error)
        chunk.error = message
        attempt += 1
        chunk.retryCount += 1

        if (attempt > MAX_CHUNK_RETRIES) {
          chunk.status = 'error'
          // Fail fast: one broken connection shouldn't leave the others
          // downloading a file we're about to discard anyway.
          if (runtime.state.status === 'downloading') {
            runtime.state.status = 'error'
            runtime.state.error = message
            for (const chunkRuntime of runtime.chunkRuntimes.values()) {
              chunkRuntime.controller.abort()
            }
          }
          break
        }

        chunk.status = 'retrying'
        this.scheduleUpdate(runtime)
        await delay(retryDelayMs(attempt), activeController.signal)
        if (activeController.signal.aborted) {
          chunk.status = runtime.state.status === 'paused' ? 'paused' : 'cancelled'
          chunk.speedBytesPerSec = 0
          break
        }
        chunk.status = 'downloading'
      }
    }

    this.scheduleUpdate(runtime)
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

    this.recomputeAggregates(runtime)
    this.scheduleUpdate(runtime)
  }

  private recomputeAggregates(runtime: DownloadRuntime): void {
    runtime.state.bytesDownloaded = runtime.state.chunks.reduce(
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
    // Chunks created by splitting a sibling's range mid-download are appended to
    // the array, not inserted in byte order — sort by rangeStart or the file
    // comes out scrambled whenever a split happened anywhere but at the end.
    const orderedChunks = [...runtime.state.chunks].sort((a, b) => a.rangeStart - b.rangeStart)

    try {
      for (const chunk of orderedChunks) {
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
