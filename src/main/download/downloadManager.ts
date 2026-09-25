import { randomUUID } from 'node:crypto'
import { readFile, readdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { app, Notification } from 'electron'
import { IpcChannels } from '../../shared/ipc-channels'
import type {
  BlockState,
  ChunkState,
  DownloadState,
  DownloadStatus,
  NetworkInterfaceInfo,
  StartDownloadRequest,
  StartSimulatedDownloadRequest
} from '../../shared/types'
import { interleave, planDownload } from '../../shared/plan'
import { testKnobs } from '../testKnobs'
import { advanceBlock, retractBlock } from './blockProgress'
import { downloadChunk, fetchRange, RemoteChangedError } from './chunkDownloader'
import { DownloadFile } from './downloadFile'
import { compareVersion, type FileVersion } from './fileVersion'
import { ensureDirectory, reserveDestinationPath } from './paths'
import { pickWork, type SchedulerPolicy, type Work } from './scheduler'
import {
  compatibleInterfaces,
  NoCompatibleRouteError,
  resolveTargetWithin,
  StreamConnection,
  targetHost
} from '../network/routes'
import {
  createSimSession,
  downloadChunkSimulated,
  isSimulatedUrl,
  unregisterSimSession
} from './simDownload'

/** Why an attempt was called off by the manager rather than by a pause or a failure. */
type AbortReason = 'refresh' | 'lost'

/**
 * One request for one block, by one stream. A block normally has a single (primary) attempt.
 * Near the end of a download a second (hedge) one may race it — see scheduler.ts — and then the
 * block is finished by whichever gets there first.
 *
 * Both write straight into the staging file at the block's own offsets. Every response is checked
 * to be the download's version before any of it is written, so racing attempts write identical
 * bytes and it doesn't matter which lands last: whatever either has written stays secured.
 */
interface Attempt {
  kind: 'primary' | 'hedge'
  block: BlockState
  streamId: number
  networkId: string
  /** Where the request begins, as an offset into the block. Null until it is known. */
  startOffset: number | null
  /** Bytes the destination writer has accepted; safe to resume from this prefix. */
  received: number
  /** Bytes the network has delivered, independently of disk backpressure. */
  networkReceived: number
  lastNetworkAt: number
  /** When the request was sent. */
  startedAt: number
  /** The network previously credited for this block's prefix. */
  previousWriter: string | undefined
  /** Aborts this request alone; ChunkRuntime.controller aborts the whole stream. */
  abort: AbortController
  abortReason: AbortReason | null
  /** What the server's answer cost, for diagnosing slow connections (see PLEXO_DEBUG). */
  response: { ttfbMs: number; reusedSocket: boolean } | null
}

/** What became of an attempt's request. */
type AttemptOutcome =
  | { type: 'completed' }
  /** The download was paused or cancelled underneath it. */
  | { type: 'stopped' }
  /** Called off by the manager (see AbortReason). */
  | { type: 'aborted'; reason: AbortReason }
  | { type: 'failed'; error: unknown }

interface ChunkRuntime {
  /** Aborts the whole stream: pause and cancel. */
  controller: AbortController
  /** Its one connection to the server, reused from block to block. */
  connection: StreamConnection
  /** What the stream is fetching right now, if anything. */
  attempt: Attempt | null
  /** When this connection last (re)connected; it isn't judged until SLOW_WARMUP_MS after. */
  warmSince: number
  slowSince: number | null
  /** Speed of its last finished block, start to end — 0 until it finishes one. */
  lastBlockSpeed: number
  /** Everything it has received, bytes another attempt already had included: what its speed is
   * measured from. (`ChunkState.bytesDownloaded` counts only bytes that were new.) */
  receivedBytes: number
  /** Failed attempts in a row, for backoff. */
  failures: number
}

interface SpeedSample {
  bytes: number
  time: number
}

interface DownloadRuntime {
  state: DownloadState
  publicationPath?: string
  publicationIdentity?: { dev: number; ino: number }
  requestPayload: StartDownloadRequest
  activeInterfaces: NetworkInterfaceInfo[]
  chunkRuntimes: Map<number, ChunkRuntime>
  file: DownloadFile
  runPromise?: Promise<void>
  publishing: boolean
  speedSamplesByChunk: Map<number, SpeedSample[]>
  pushScheduled: boolean
  blocks: BlockState[]
  totalBlocks: number
  persistenceTimer?: NodeJS.Timeout
  persistenceChain: Promise<void>
  removed: boolean
  /** The version this download started on, plus any since confirmed to serve identical bytes
   * (see confirmSameBytes). Not persisted: after a restart, a confirmation is simply redone. */
  acceptedVersions: FileVersion[]
  /** Slow-connection refreshes per block index, capped at MAX_REFRESHES_PER_BLOCK. */
  refreshesByBlock: Map<number, number>
  /** For a block whose last attempt delivered nothing, the network that made it. That network
   * leaves the block to another one while another is free to take it (see scheduler.ts). Not
   * persisted: it only steers the next hand-out. */
  avoidNetworkByBlock: Map<number, string>
  /** Attempts in flight, by block index. */
  attempts: Map<number, Attempt[]>
  /** Hedges started per block index, capped at SCHEDULER_POLICY.maxHedgesPerBlock. */
  hedgesByBlock: Map<number, number>
}

interface PersistedDownload {
  version: 4
  savedAt: number
  state: DownloadState
  partialPath: string
  publicationPath?: string
  publicationIdentity?: { dev: number; ino: number }
  requestPayload: StartDownloadRequest
  activeInterfaces: NetworkInterfaceInfo[]
}

// Set PLEXO_DEBUG=1 to log every request's outcome, how long the server took to answer and
// whether it reused a warm connection — what it takes to tell one slow connection from a slow path.
const debug: (...args: unknown[]) => void = process.env['PLEXO_DEBUG']
  ? (...args) => console.debug('[plexo]', ...args)
  : () => {}

const UI_UPDATE_MS = 200
// Syncing a growing file can briefly monopolize a slow destination drive. Keep recovery
// checkpoints independent of UI updates; pause and publication still force an immediate sync.
const CHECKPOINT_INTERVAL_MS = 15_000

// Raw per-event deltas are too noisy to display (socket buffers flush in
// irregular bursts a few ms apart). Averaging over a few seconds instead
// gives a speed/ETA reading that tracks reality without jumping around.
const SPEED_WINDOW_MS = 3000

// Appends a sample and returns the average byte rate over SPEED_WINDOW_MS.
function pushSpeedSample(samples: SpeedSample[], bytes: number, time: number): number {
  if (samples.length > 0 && time - samples[samples.length - 1].time > SPEED_WINDOW_MS) {
    samples.length = 0
  }
  samples.push({ bytes, time })

  return calculateCurrentSpeed(samples, time)
}

function calculateCurrentSpeed(samples: SpeedSample[] | undefined, time: number): number {
  if (!samples || samples.length === 0) return 0

  const latest = samples[samples.length - 1]
  if (time - latest.time > SPEED_WINDOW_MS) {
    return 0
  }

  const cutoff = time - SPEED_WINDOW_MS
  while (samples.length > 2 && samples[1].time <= cutoff) {
    samples.shift()
  }

  // At least a second: a fresh window can hold two samples ms apart, and one socket burst over a
  // few ms reads as a speed the connection never had (and sticks as the UI's peak).
  const oldest = samples[0]
  const deltaSeconds = Math.max((time - oldest.time) / 1000, 1)
  return (latest.bytes - oldest.bytes) / deltaSeconds
}

const MAX_CHUNK_RETRIES = 5
const RETRY_BASE_DELAY_MS = testKnobs.retryBaseDelayMs
const RETRY_MAX_DELAY_MS = 15_000

function retryDelayMs(attempt: number): number {
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS)
}

// A single TCP stream can get stuck at a crawl (loss-collapsed congestion window, a bad CDN node
// or route) while its siblings on the same network run fine. It never goes silent, so the stall
// watchdog can't catch it; a fresh connection usually lands somewhere healthy. Only relative
// thresholds — nothing here knows how fast the network ought to be.
const SLOW_RATIO = 0.1
const SLOW_WARMUP_MS = testKnobs.slowWarmupMs
const SLOW_FOR_MS = testKnobs.slowForMs
// A connection that has received nothing this long, while the file is being served to others, is
// dead rather than slow (a network that isn't answering, a stuck handshake).
const SILENT_AFTER_MS = testKnobs.silentAfterMs
// Bounds every case where refreshing can't help (the whole network got slower, a stale
// reference): at worst a block pays for a couple of cheap reconnects, then is left alone.
const MAX_REFRESHES_PER_BLOCK = 2
const SCHEDULER_POLICY: SchedulerPolicy = {
  hedgeAfterMs: testKnobs.hedgeAfterMs,
  maxHedgesPerBlock: 2
}
// Idle connections look for work every 250 ms, so waiting a bit longer hands a refreshed block
// to a connection that is already proven fast, if there is one.
const REFRESH_HANDOFF_MS = 300

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Total live speed across a download's worker connections (bounded by MAX_CHUNKS, unlike blocks). */
function sumChunkSpeeds(runtime: DownloadRuntime, now = Date.now()): number {
  let total = 0
  for (const chunk of runtime.state.chunks) {
    if (chunk.status === 'downloading') {
      const samples = runtime.speedSamplesByChunk.get(chunk.id)
      chunk.speedBytesPerSec = calculateCurrentSpeed(samples, now)
    }
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

function requestedVersion(request: StartDownloadRequest): FileVersion {
  return { etag: request.etag, lastModified: request.lastModified, totalBytes: request.totalBytes }
}

// How much of the already-downloaded file to re-fetch and compare when a server labels a
// response with an ETag or Last-Modified this download hasn't seen before.
const SAMPLE_BYTES = 16 * 1024
const MAX_SAMPLES = 8
/** A sample must come from a server presenting the new label; behind a load balancer the next
 * request may land on another one, so take a few tries at reaching it. */
const SAMPLE_TRIES = 4

function formatGigabytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

/** The staging file is on the destination volume and becomes the final file by rename. */
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

export class DownloadManager {
  private runtimes = new Map<string, DownloadRuntime>()
  private readonly initialization: Promise<void>
  private suspending = false

  constructor(
    private getWindow: () => BrowserWindow | null,
    private getInterfaceById: (id: string) => NetworkInterfaceInfo | undefined,
    private refreshInterfaces: () => Promise<NetworkInterfaceInfo[]>
  ) {
    this.initialization = this.restorePersistedDownloads()
  }

  private downloadsRoot(): string {
    return join(app.getPath('userData'), 'downloads')
  }

  private downloadDir(id: string): string {
    return join(this.downloadsRoot(), id)
  }

  private manifestPath(id: string): string {
    return join(this.downloadDir(id), 'manifest.json')
  }

  private async restorePersistedDownloads(): Promise<void> {
    let entries: string[]
    try {
      entries = await readdir(this.downloadsRoot())
    } catch {
      return
    }

    const restored: DownloadRuntime[] = []
    await Promise.all(
      entries.map(async (id) => {
        try {
          await rm(`${this.manifestPath(id)}.tmp`, { force: true })
          const persisted = JSON.parse(
            await readFile(this.manifestPath(id), 'utf-8')
          ) as PersistedDownload
          if (persisted.version !== 4 || persisted.state.id !== id || !persisted.state.blocks)
            return

          const state = persisted.state
          const blocks = state.blocks
          if (!blocks) return
          if (state.status === 'downloading') {
            state.status = 'paused'
            state.pausedAt = persisted.savedAt || Date.now()
          }
          state.speedBytesPerSec = 0
          for (const chunk of state.chunks) {
            chunk.speedBytesPerSec = 0
            chunk.currentBlockIndex = undefined
            chunk.hedge = undefined
            if (
              chunk.status === 'downloading' ||
              chunk.status === 'retrying' ||
              chunk.status === 'pending'
            ) {
              chunk.status = 'paused'
            }
          }
          for (const block of blocks) {
            if (block.status === 'downloading') block.status = 'pending'
          }

          const file = new DownloadFile(persisted.partialPath)
          if (state.status === 'paused') {
            const size = await file.size().catch(() => -1)
            const publishedPath = persisted.publicationPath ?? state.destinationPath
            const published = await stat(publishedPath).catch(() => null)
            const publishedSize = published?.size ?? -1
            const expected = state.totalBytes || state.bytesDownloaded
            const sameFile =
              !!published &&
              (size >= 0
                ? await stat(file.path)
                    .then(
                      (partial) => partial.dev === published.dev && partial.ino === published.ino
                    )
                    .catch(() => false)
                : persisted.publicationIdentity?.dev === published.dev &&
                  persisted.publicationIdentity?.ino === published.ino)
            if (
              blocks.every((block) => block.status === 'completed') &&
              publishedSize === expected &&
              sameFile
            ) {
              state.status = 'completed'
              state.destinationPath = publishedPath
              state.fileName = basename(publishedPath)
              state.error = undefined
              state.completedAt ??= persisted.savedAt
              if (size >= 0) await file.discard()
            } else if (size < 0) {
              state.status = 'error'
              state.error =
                'The partial download file is missing. Remove this download and start again.'
            } else {
              for (const block of blocks) {
                const length = block.rangeEnd === null ? 0 : block.rangeEnd - block.rangeStart + 1
                if (
                  block.rangeStart + block.bytesDownloaded > size ||
                  (block.status === 'completed' && block.bytesDownloaded !== length)
                ) {
                  block.status = 'pending'
                  block.bytesDownloaded = 0
                  block.bytesByInterface = {}
                }
              }
              state.bytesDownloaded = blocks.reduce((sum, block) => sum + block.bytesDownloaded, 0)
            }
          }

          restored.push({
            state,
            publicationPath: persisted.publicationPath,
            publicationIdentity: persisted.publicationIdentity,
            requestPayload: persisted.requestPayload,
            activeInterfaces: persisted.activeInterfaces,
            chunkRuntimes: new Map(),
            file,
            publishing: false,
            speedSamplesByChunk: new Map(),
            pushScheduled: false,
            blocks,
            totalBlocks: state.totalBlocks ?? blocks.length,
            persistenceChain: Promise.resolve(),
            removed: false,
            acceptedVersions: [requestedVersion(persisted.requestPayload)],
            refreshesByBlock: new Map(),
            avoidNetworkByBlock: new Map(),
            attempts: new Map(),
            hedgesByBlock: new Map()
          })
        } catch {
          // Ignore incomplete or corrupt manifests; other downloads can still be restored.
        }
      })
    )

    // Plexo only ever tracks one current download — getCurrentDownload() always returns
    // whichever restored runtime started most recently. Any other one restored alongside it is
    // an orphan (most likely left over from before concurrent starts were blocked): nothing
    // would ever look at it again, so left in `runtimes` it would sit there forever, invisibly
    // failing every future start() with "a download is already in progress".
    restored.sort((a, b) => b.state.startedAt - a.state.startedAt)
    const [current, ...orphans] = restored

    await Promise.all(
      orphans.map((runtime) =>
        this.removePersistedDownload(runtime, runtime.file.path !== current?.file.path)
      )
    )

    if (current) {
      if (current.state.status === 'completed' && current.publicationIdentity) {
        const published = await stat(current.state.destinationPath).catch(() => null)
        if (
          published?.dev === current.publicationIdentity.dev &&
          published.ino === current.publicationIdentity.ino
        ) {
          await current.file.discard().catch(() => {})
        }
      }
      this.runtimes.set(current.state.id, current)
      await this.persistNow(current)
    }
  }

  async getCurrentDownload(): Promise<DownloadState | null> {
    await this.initialization
    const latest = [...this.runtimes.values()].sort(
      (a, b) => b.state.startedAt - a.state.startedAt
    )[0]
    return latest ? structuredClone(latest.state) : null
  }

  /** Plexo shows one download at a time (see useAppStore's currentDownload) — starting a second
   * one while one is already running or paused would silently race it for disk I/O and
   * scramble the renderer's single-download view as updates from both interleave. */
  private hasActiveDownload(): boolean {
    for (const runtime of this.runtimes.values()) {
      if (runtime.state.status === 'downloading' || runtime.state.status === 'paused') {
        return true
      }
    }
    return false
  }

  async start(requestPayload: StartDownloadRequest): Promise<string> {
    await this.initialization
    if (this.hasActiveDownload()) {
      throw new Error('A download is already in progress — finish or remove it first.')
    }

    const selected = requestPayload.interfaceIds
      .map((interfaceId) => this.getInterfaceById(interfaceId))
      .filter((iface): iface is NetworkInterfaceInfo => Boolean(iface))

    if (selected.length === 0) {
      throw new Error('Select at least one network interface')
    }
    const target = new URL(requestPayload.url)
    const interfaces = compatibleInterfaces(
      selected,
      await resolveTargetWithin(targetHost(target), testKnobs.stallTimeoutMs)
    )
    if (interfaces.length === 0) throw new NoCompatibleRouteError(targetHost(target))

    return this.startWithInterfaces(requestPayload, interfaces)
  }

  /**
   * Dev-tool entry point: "downloads" a file that's already on disk through the exact same
   * pipeline a real download uses — chunking, the block grid, pause/resume and retries — so
   * every feature can be exercised on demand instead of needing
   * a real multi-network setup and a slow, flaky remote server to provoke retries and errors.
   * Only `chunkDownloader`'s HTTP transfer is swapped out (see simDownload.ts); everything else
   * in DownloadManager is unaware this isn't a real network transfer.
   */
  async startSimulated(payload: StartSimulatedDownloadRequest): Promise<string> {
    await this.initialization
    if (this.hasActiveDownload()) {
      throw new Error('A download is already in progress — finish or remove it first.')
    }
    if (payload.networks.length === 0) {
      throw new Error('Select at least one simulated network')
    }

    const { url, interfaces, totalBytes } = await createSimSession(
      payload.sourceFilePath,
      payload.networks
    )

    const requestPayload: StartDownloadRequest = {
      url,
      destinationDir: payload.destinationDir,
      suggestedFileName: basename(payload.sourceFilePath),
      totalBytes,
      supportsRanges: true,
      interfaceIds: interfaces.map((iface) => iface.id),
      chunkCount: payload.chunkCount,
      connectionsPerNetwork: payload.connectionsPerNetwork,
      etag: null,
      lastModified: null
    }

    try {
      return await this.startWithInterfaces(requestPayload, interfaces)
    } catch (error) {
      unregisterSimSession(url)
      throw error
    }
  }

  private async startWithInterfaces(
    requestPayload: StartDownloadRequest,
    interfaces: NetworkInterfaceInfo[]
  ): Promise<string> {
    await ensureDirectory(requestPayload.destinationDir)
    await ensureDiskSpace(requestPayload.destinationDir, requestPayload.totalBytes)

    const plan = planDownload({
      totalBytes: requestPayload.totalBytes,
      splittable: requestPayload.supportsRanges,
      networkCount: interfaces.length,
      streamsPerNetwork:
        requestPayload.connectionsPerNetwork ??
        Math.round(requestPayload.chunkCount / interfaces.length),
      maxBlockBytes: testKnobs.blockBytes // 8 MB outside tests
    })

    // Claimed on disk, not just picked, so a second download of the same file
    // name can't pick it too and overwrite this one at publish time. Done
    // before anything else is created, so a destination we can't write to
    // leaves nothing behind.
    const destinationPath = await reserveDestinationPath(
      requestPayload.destinationDir,
      requestPayload.suggestedFileName
    )

    const id = randomUUID()
    const file = new DownloadFile(`${destinationPath}.plexo`)

    // The UI caps how many cells it renders separately (see BlockGrid), by bucketing these
    // blocks rather than by shrinking their count here.
    const blocks: BlockState[] = []
    if (requestPayload.totalBytes > 0) {
      const { blockSizeBytes } = plan
      for (
        let rangeStart = 0;
        rangeStart < requestPayload.totalBytes;
        rangeStart += blockSizeBytes
      ) {
        blocks.push({
          index: blocks.length,
          rangeStart,
          rangeEnd: Math.min(rangeStart + blockSizeBytes, requestPayload.totalBytes) - 1,
          status: 'pending',
          bytesDownloaded: 0,
          bytesByInterface: {}
        })
      }
    } else {
      // Size unknown: one open-ended block, to end of file.
      blocks.push({
        index: 0,
        rangeStart: 0,
        rangeEnd: null,
        status: 'pending',
        bytesDownloaded: 0,
        bytesByInterface: {}
      })
    }

    const chunks: ChunkState[] = plan.streamNetworks.map((networkIndex, id) => {
      const iface = interfaces[networkIndex]
      return {
        id,
        interfaceId: iface.id,
        interfaceLabel: iface.displayName,
        interfaceKind: iface.kind,
        rangeStart: 0,
        rangeEnd: null,
        bytesDownloaded: 0,
        speedBytesPerSec: 0,
        status: 'pending',
        retryCount: 0
      }
    })
    const activeInterfaces = [...new Set(plan.streamNetworks)].map((index) => interfaces[index])

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
      blockSizeBytes: plan.blockSizeBytes,
      startedAt: Date.now()
    }

    const runtime: DownloadRuntime = {
      state,
      requestPayload,
      activeInterfaces,
      chunkRuntimes: new Map(),
      file,
      publishing: false,
      speedSamplesByChunk: new Map(),
      pushScheduled: false,
      blocks,
      totalBlocks: blocks.length,
      persistenceChain: Promise.resolve(),
      removed: false,
      acceptedVersions: [requestedVersion(requestPayload)],
      refreshesByBlock: new Map(),
      avoidNetworkByBlock: new Map(),
      attempts: new Map(),
      hedgesByBlock: new Map()
    }
    this.runtimes.set(id, runtime)
    await this.persistNow(runtime)
    this.pushUpdate(runtime)

    runtime.runPromise = this.runChunksToCompletion(runtime, runtime.state.chunks)

    return id
  }

  async pause(id: string): Promise<void> {
    const runtime = this.runtimes.get(id)
    if (!runtime || runtime.state.status !== 'downloading' || runtime.publishing) return

    runtime.state.status = 'paused'
    runtime.state.speedBytesPerSec = 0
    runtime.state.pausedAt = Date.now()
    for (const chunk of runtime.state.chunks) {
      if (chunk.status !== 'completed') {
        chunk.status = 'paused'
      }
      chunk.speedBytesPerSec = 0
      chunk.currentBlockIndex = undefined
    }
    for (const block of runtime.blocks) {
      if (block.status === 'downloading') {
        block.status = 'pending'
      }
    }
    runtime.avoidNetworkByBlock.clear()
    for (const chunk of runtime.state.chunks) chunk.hedge = undefined
    for (const chunkRuntime of runtime.chunkRuntimes.values()) {
      chunkRuntime.controller.abort()
    }
    this.pushUpdate(runtime)
    await runtime.runPromise
    await this.persistNow(runtime)
  }

  resume(id: string): void {
    const runtime = this.runtimes.get(id)
    if (!runtime || (runtime.state.status !== 'paused' && runtime.state.status !== 'error')) return

    void this.resumeAfterVerifying(runtime)
  }

  // A file that changed on the server while this download was paused is caught by the first
  // chunk request after resuming: its response is checked against the version the download
  // started on (see runWorker), which can tell a real change from a relabelled server.
  private async resumeAfterVerifying(runtime: DownloadRuntime): Promise<void> {
    const { url } = runtime.requestPayload

    let availableInterfaces: NetworkInterfaceInfo[]
    if (isSimulatedUrl(url)) {
      // Synthetic sim interfaces aren't real NICs the OS enumerates — they never "disconnect",
      // so the ones already on the runtime are still exactly right.
      availableInterfaces = runtime.activeInterfaces
    } else {
      try {
        availableInterfaces = await this.refreshInterfaces()
      } catch {
        runtime.state.error = 'Could not refresh network interfaces. Try resuming again.'
        this.pushUpdate(runtime)
        return
      }
    }
    if (runtime.state.status !== 'paused' && runtime.state.status !== 'error') return

    const selectedIds = new Set(runtime.requestPayload.interfaceIds)
    runtime.activeInterfaces = availableInterfaces.filter((iface) => selectedIds.has(iface.id))
    const selectedAvailable = runtime.activeInterfaces.length > 0
    if (!isSimulatedUrl(url)) {
      try {
        runtime.activeInterfaces = compatibleInterfaces(
          runtime.activeInterfaces,
          await resolveTargetWithin(targetHost(new URL(url)), testKnobs.stallTimeoutMs)
        )
      } catch {
        runtime.state.error = 'Could not resolve the download host. Try resuming again.'
        this.pushUpdate(runtime)
        return
      }
    }
    if (runtime.activeInterfaces.length === 0) {
      runtime.state.error = selectedAvailable
        ? `No selected network has an address compatible with ${targetHost(new URL(url))}.`
        : 'None of the networks selected for this download are currently available. Reconnect one and try again.'
      this.pushUpdate(runtime)
      return
    }

    if ((await runtime.file.size().catch(() => -1)) < 0) {
      runtime.state.error =
        'The partial download file is unavailable. Reconnect the destination drive and try again.'
      this.pushUpdate(runtime)
      return
    }
    if (runtime.state.status !== 'paused' && runtime.state.status !== 'error') return

    for (let index = 0; index < runtime.state.chunks.length; index++) {
      const chunk = runtime.state.chunks[index]
      const iface =
        runtime.activeInterfaces.find((entry) => entry.id === chunk.interfaceId) ??
        runtime.activeInterfaces[index % runtime.activeInterfaces.length]
      chunk.interfaceId = iface.id
      chunk.interfaceLabel = iface.displayName
      chunk.interfaceKind = iface.kind
    }

    runtime.state.status = 'downloading'
    runtime.state.error = undefined
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
    runtime.avoidNetworkByBlock.clear()
    this.pushUpdate(runtime)

    // Streams start in the order given, and each claims a block on the spot: interleaved, so a
    // paused download saved before that was the rule can't hand every block to one network.
    const pending = runtime.state.chunks.filter((chunk) => chunk.status !== 'completed')
    const toRun = pending.length > 0 ? pending : runtime.state.chunks
    runtime.runPromise = this.runChunksToCompletion(
      runtime,
      interleave(toRun, (chunk) => chunk.interfaceId)
    )
  }

  async cancel(id: string): Promise<void> {
    const runtime = this.runtimes.get(id)
    if (
      !runtime ||
      runtime.publishing ||
      (runtime.state.status !== 'downloading' &&
        runtime.state.status !== 'paused' &&
        runtime.state.status !== 'error')
    )
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
    this.pushUpdate(runtime, false)
    await runtime.runPromise
    await runtime.file.discard()
    unregisterSimSession(runtime.requestPayload.url)
    await this.removePersistedDownload(runtime)
  }

  async remove(id: string): Promise<void> {
    const runtime = this.runtimes.get(id)
    if (
      runtime &&
      (runtime.state.status === 'downloading' ||
        runtime.state.status === 'paused' ||
        runtime.state.status === 'error')
    ) {
      await this.cancel(id)
    }
    this.runtimes.delete(id)
    if (runtime) await this.removePersistedDownload(runtime)
  }

  async suspendAll(): Promise<void> {
    await this.initialization
    this.suspending = true
    await Promise.all(
      [...this.runtimes.values()].map(async (runtime) => {
        if (runtime.state.status === 'downloading') await this.pause(runtime.state.id)
        else await this.persistNow(runtime)
      })
    )
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

    const speedTicker = setInterval(() => {
      // Only the `finally` below stops this ticker — self-clearing on status here would let a
      // fast pause/resume start a second runChunksToCompletion (and ticker) while this one is
      // still winding down, and it would never see 'downloading' flip back on its own.
      if (runtime.state.status !== 'downloading') return
      const now = Date.now()
      const prevSpeed = runtime.state.speedBytesPerSec
      const newSpeed = sumChunkSpeeds(runtime, now)
      if (newSpeed !== prevSpeed) {
        runtime.state.speedBytesPerSec = newSpeed
        this.scheduleUpdate(runtime)
      }
      this.refreshStuckConnections(runtime, now)
    }, 500)
    speedTicker.unref()

    try {
      while (active.size > 0) {
        const finishedId = await Promise.race(active.values())
        active.delete(finishedId)
      }
    } finally {
      clearInterval(speedTicker)
    }

    if (
      runtime.state.status === 'downloading' &&
      runtime.blocks.some((b) => b.status !== 'completed')
    ) {
      runtime.state.status = 'error'
      runtime.state.error =
        runtime.state.chunks.find((chunk) => chunk.error)?.error ??
        'No network could finish the remaining blocks'
    }

    if (runtime.state.status !== 'downloading') {
      // Paused, errored, or cancelled — nothing left to do right now.
      if (runtime.state.status === 'error' || runtime.state.status === 'cancelled') {
        this.pushUpdate(runtime)
        await runtime.file.discard()
        unregisterSimSession(runtime.requestPayload.url)
      }
      return
    }

    runtime.publishing = true
    try {
      if (runtime.blocks.some((block) => block.status !== 'completed')) {
        throw new Error('Download is incomplete — refusing to publish the file')
      }
      await this.persistNow(runtime)
      const publishedPath = await runtime.file.publish(
        runtime.state.destinationPath,
        runtime.state.totalBytes,
        async (candidate) => {
          runtime.publicationPath = candidate
          const partial = await stat(runtime.file.path)
          runtime.publicationIdentity = { dev: partial.dev, ino: partial.ino }
          await this.persistNow(runtime, true)
        }
      )
      runtime.state.destinationPath = publishedPath
      runtime.state.fileName = basename(publishedPath)
      runtime.state.status = 'completed'
      runtime.state.completedAt = Date.now()
      runtime.state.bytesDownloaded = runtime.state.totalBytes || runtime.state.bytesDownloaded
      await this.persistNow(runtime)
      await runtime.file.discard().catch(() => {})
      this.notify('Download Complete', `${runtime.state.fileName} has finished downloading.`)
    } catch (error) {
      runtime.state.status = 'error'
      runtime.state.error = error instanceof Error ? error.message : String(error)
      this.notify('Download Failed', `${runtime.state.fileName}: ${runtime.state.error}`)
    }
    runtime.publishing = false

    this.pushUpdate(runtime)
    // Publication failures keep the complete partial file so Resume can try again.
    if (runtime.state.status === 'completed') unregisterSimSession(runtime.requestPayload.url)
  }

  /**
   * Reconnects a connection that isn't carrying its weight. Reconnecting is cheap — the block
   * resumes from the staging file — and a fresh connection usually lands somewhere healthy.
   *
   * - Silent: nothing received for SILENT_AFTER_MS while the file is demonstrably being served
   *   to others. Judged by the clock alone, so it also catches a network that has yet to
   *   deliver a byte and therefore has no speed to be compared with.
   * - Crawling: under SLOW_RATIO of its network's reference speed for SLOW_FOR_MS. The reference
   *   is the median of what connections on the same network are doing now and did on their last
   *   finished block — its own included, which covers the tail (everyone else is done) and a
   *   network with a single connection. Networks are never compared with each other: cellular
   *   is expected to be slower than Wi-Fi.
   *
   * Reconnecting only swaps one connection for another, and stops after a couple of tries; what
   * can finish a block whose connections all crawl is a hedge (see scheduler.ts).
   */
  private refreshStuckConnections(runtime: DownloadRuntime, now: number): void {
    // Without ranges a reconnect restarts the whole file from byte 0.
    if (!runtime.requestPayload.supportsRanges) return

    for (const chunk of runtime.state.chunks) {
      const self = runtime.chunkRuntimes.get(chunk.id)
      const attempt = self?.attempt
      if (!self || !attempt || attempt.abortReason) continue

      const index = attempt.block.index
      const refreshes = runtime.refreshesByBlock.get(index) ?? 0
      // A hedge is optional work: it is only ever dropped, never counted against its block.
      const isPrimary = attempt.kind === 'primary'
      if (isPrimary && refreshes >= MAX_REFRESHES_PER_BLOCK) continue

      if (
        this.isSilent(runtime, attempt, now) ||
        (isPrimary && this.isCrawling(runtime, chunk, self, now))
      ) {
        if (isPrimary) runtime.refreshesByBlock.set(index, refreshes + 1)
        this.abortAttempt(attempt, 'refresh')
      }
    }
  }

  private isSilent(runtime: DownloadRuntime, attempt: Attempt, now: number): boolean {
    if (attempt.networkReceived > 0 || now - attempt.startedAt < SILENT_AFTER_MS) return false
    // Until something has arrived, a quiet origin is just a slow one — nothing to blame this
    // connection for.
    return runtime.blocks.some(
      (block) => block.index !== attempt.block.index && block.bytesDownloaded > 0
    )
  }

  private isCrawling(
    runtime: DownloadRuntime,
    chunk: ChunkState,
    self: ChunkRuntime,
    now: number
  ): boolean {
    const warm = (connection: ChunkRuntime): boolean => now - connection.warmSince >= SLOW_WARMUP_MS
    if (!warm(self)) return false

    const reference: number[] = []
    for (const other of runtime.state.chunks) {
      if (other.interfaceId !== chunk.interfaceId) continue
      const peer = runtime.chunkRuntimes.get(other.id)
      if (!peer) continue
      if (peer.lastBlockSpeed > 0) reference.push(peer.lastBlockSpeed)
      if (other !== chunk && peer.attempt && warm(peer)) reference.push(other.speedBytesPerSec)
    }

    if (reference.length === 0 || chunk.speedBytesPerSec >= median(reference) * SLOW_RATIO) {
      self.slowSince = null
      return false
    }
    self.slowSince ??= now
    return now - self.slowSince >= SLOW_FOR_MS
  }

  private abortAttempt(attempt: Attempt, reason: AbortReason): void {
    if (attempt.abortReason) return
    attempt.abortReason = reason
    attempt.abort.abort()
  }

  private notify(title: string, body: string): void {
    if (testKnobs.userDataDir || !Notification.isSupported()) return
    try {
      const notification = new Notification({ title, body })
      notification.on('click', () => {
        const window = this.getWindow()
        if (window && !window.isDestroyed()) {
          if (window.isMinimized()) window.restore()
          window.show()
          window.focus()
        }
      })
      notification.show()
    } catch {
      // Best-effort notification
    }
  }

  // --- attempts ---------------------------------------------------------------------------------
  //
  // A stream's life is a loop: ask the scheduler for work, run it as an attempt, then apply what
  // became of it. Everything that changes the download's state happens in the synchronous stretches
  // between awaits, so a stream never sees another's half-finished change.

  /** Where an attempt has got to in its block. */
  private attemptPosition(attempt: Attempt): number {
    return (attempt.startOffset ?? 0) + attempt.received
  }

  /** How far the block's other attempts have got: what is safe to keep counted when one lets go. */
  private otherAttemptsPosition(runtime: DownloadRuntime, attempt: Attempt): number {
    let furthest = 0
    for (const other of runtime.attempts.get(attempt.block.index) ?? []) {
      if (other !== attempt) furthest = Math.max(furthest, this.attemptPosition(other))
    }
    return furthest
  }

  /** The stream holds no block: it says so, rather than keeping the last one's numbers on show. */
  private goIdle(chunk: ChunkState): void {
    chunk.status = 'pending'
    chunk.currentBlockIndex = undefined
    chunk.hedge = undefined
    chunk.speedBytesPerSec = 0
  }

  private beginAttempt(
    runtime: DownloadRuntime,
    chunk: ChunkState,
    self: ChunkRuntime,
    iface: NetworkInterfaceInfo,
    work: Work
  ): Attempt {
    const { block } = work
    const attempt: Attempt = {
      kind: work.kind,
      block,
      streamId: chunk.id,
      networkId: iface.id,
      startOffset: null,
      received: 0,
      networkReceived: 0,
      lastNetworkAt: 0,
      startedAt: Date.now(),
      // Whoever held this block before now is the one whose tail bytes a truncation would
      // discard — captured before the lease overwrites the field.
      previousWriter: block.interfaceId,
      abort: new AbortController(),
      abortReason: null,
      response: null
    }

    if (work.kind === 'primary') {
      block.status = 'downloading'
      block.interfaceId = iface.id
      runtime.avoidNetworkByBlock.delete(block.index)
    } else {
      runtime.hedgesByBlock.set(block.index, (runtime.hedgesByBlock.get(block.index) ?? 0) + 1)
    }
    const inFlight = runtime.attempts.get(block.index)
    if (inFlight) inFlight.push(attempt)
    else runtime.attempts.set(block.index, [attempt])
    self.attempt = attempt

    chunk.status = 'downloading'
    chunk.hedge = work.kind === 'hedge' ? true : undefined
    chunk.rangeStart = block.rangeStart
    chunk.rangeEnd = block.rangeEnd
    chunk.currentBlockIndex = block.index
    return attempt
  }

  /** Takes the attempt off the books. Safe to repeat. */
  private endAttempt(runtime: DownloadRuntime, self: ChunkRuntime, attempt: Attempt): void {
    const inFlight = runtime.attempts.get(attempt.block.index)
    if (inFlight) {
      const position = inFlight.indexOf(attempt)
      if (position >= 0) inFlight.splice(position, 1)
      if (inFlight.length === 0) runtime.attempts.delete(attempt.block.index)
    }
    if (self.attempt === attempt) self.attempt = null
  }

  /** Sends the request and reports how it ended. Never throws. */
  private async executeAttempt(
    runtime: DownloadRuntime,
    chunk: ChunkState,
    self: ChunkRuntime,
    attempt: Attempt
  ): Promise<AttemptOutcome> {
    const { block } = attempt
    try {
      if (attempt.kind === 'primary') {
        // A failed range leaves its written prefix in the staging file. Without range support,
        // the server can only restart from byte zero.
        attempt.startOffset = runtime.requestPayload.supportsRanges ? block.bytesDownloaded : 0
        // What another attempt has already secured stays counted.
        const keep = Math.max(attempt.startOffset, this.otherAttemptsPosition(runtime, attempt))
        if (retractBlock(block, keep, attempt.previousWriter) > 0) this.recomputeAggregates(runtime)
      } else {
        attempt.startOffset = block.bytesDownloaded
      }

      const length = block.rangeEnd === null ? null : block.rangeEnd - block.rangeStart + 1
      if (length !== null && attempt.startOffset >= length) {
        // The staging file already holds the whole block.
        return attempt.kind === 'primary'
          ? { type: 'completed' }
          : { type: 'aborted', reason: 'lost' }
      }

      attempt.startedAt = Date.now()
      const runDownload = isSimulatedUrl(runtime.requestPayload.url)
        ? downloadChunkSimulated
        : downloadChunk
      await runDownload({
        url: runtime.requestPayload.url,
        rangeStart: block.rangeStart + attempt.startOffset,
        rangeEnd: block.rangeEnd,
        connection: self.connection,
        createDestination: () => runtime.file.writer(block.rangeStart + (attempt.startOffset ?? 0)),
        signal: AbortSignal.any([self.controller.signal, attempt.abort.signal]),
        acceptedVersions: runtime.acceptedVersions,
        onResponse: (info) => (attempt.response = info),
        onNetworkProgress: (bytesThisRun) => {
          const delta = bytesThisRun - attempt.networkReceived
          if (delta > 0) {
            attempt.networkReceived = bytesThisRun
            attempt.lastNetworkAt = Date.now()
            this.onNetworkProgress(runtime, chunk, self, delta)
          }
        },
        onProgress: (bytesThisRun) => {
          const delta = bytesThisRun - attempt.received
          if (delta > 0) {
            attempt.received = bytesThisRun
            this.onAttemptProgress(runtime, chunk, attempt)
          }
        }
      })
      return { type: 'completed' }
    } catch (error) {
      const status = runtime.state.status as DownloadStatus
      if (self.controller.signal.aborted || status !== 'downloading') return { type: 'stopped' }
      if (attempt.abortReason) return { type: 'aborted', reason: attempt.abortReason }
      return { type: 'failed', error }
    }
  }

  private onNetworkProgress(
    runtime: DownloadRuntime,
    chunk: ChunkState,
    self: ChunkRuntime,
    deltaBytes: number
  ): void {
    const now = Date.now()
    self.receivedBytes += deltaBytes
    let samples = runtime.speedSamplesByChunk.get(chunk.id)
    if (!samples) {
      samples = []
      runtime.speedSamplesByChunk.set(chunk.id, samples)
    }
    chunk.speedBytesPerSec = pushSpeedSample(samples, self.receivedBytes, now)
    runtime.state.speedBytesPerSec = sumChunkSpeeds(runtime)
    this.scheduleUpdate(runtime)
  }

  private onAttemptProgress(runtime: DownloadRuntime, chunk: ChunkState, attempt: Attempt): void {
    // Only what gets the block further than it already was counts as progress: a racing attempt
    // re-fetches bytes the other already has.
    const gained = advanceBlock(attempt.block, attempt.networkId, this.attemptPosition(attempt))
    chunk.bytesDownloaded += gained

    // This runs on every completed writer callback, so it folds the delta in rather than re-summing
    // every block — that sum is O(blocks), and a large file has thousands of them. The other
    // callers of recomputeAggregates are rare enough to afford the full pass, and each one
    // re-derives the true total, so any drift here cannot accumulate.
    runtime.state.bytesDownloaded += gained
    this.scheduleUpdate(runtime)
  }

  /** Applies what became of an attempt to the download. 'stop' ends the stream. */
  private async finishAttempt(
    runtime: DownloadRuntime,
    chunk: ChunkState,
    self: ChunkRuntime,
    iface: NetworkInterfaceInfo,
    attempt: Attempt,
    outcome: AttemptOutcome
  ): Promise<'continue' | 'stop'> {
    debug('attempt', {
      block: attempt.block.index,
      stream: chunk.id,
      network: iface.displayName,
      kind: attempt.kind,
      outcome: outcome.type === 'aborted' ? `aborted:${outcome.reason}` : outcome.type,
      networkBytes: attempt.networkReceived,
      writtenBytes: attempt.received,
      ms: Date.now() - attempt.startedAt,
      ...attempt.response
    })

    switch (outcome.type) {
      case 'completed':
        return this.finishCompleted(runtime, chunk, self, attempt)
      case 'stopped':
        return this.finishStopped(runtime, chunk, self, attempt)
      case 'aborted':
        return this.finishAborted(runtime, chunk, self, attempt, outcome.reason)
      case 'failed':
        return this.finishFailed(runtime, chunk, self, attempt, outcome.error)
    }
  }

  private finishCompleted(
    runtime: DownloadRuntime,
    chunk: ChunkState,
    self: ChunkRuntime,
    attempt: Attempt
  ): 'continue' {
    const { block } = attempt

    // Another attempt already finished this block: these bytes are surplus.
    if (block.status === 'completed') {
      this.letGo(runtime, chunk, self, attempt, false)
      return 'continue'
    }

    this.endAttempt(runtime, self, attempt)
    block.status = 'completed'
    block.interfaceId = attempt.networkId
    if (block.rangeEnd !== null) {
      // Progress events can lag the final write, so square the block up to its exact size and
      // credit the shortfall to the network that finished it.
      const blockBytes = block.rangeEnd - block.rangeStart + 1
      chunk.bytesDownloaded += advanceBlock(block, attempt.networkId, blockBytes)
      self.lastBlockSpeed =
        (attempt.networkReceived /
          Math.max(1, (attempt.lastNetworkAt || Date.now()) - attempt.startedAt)) *
        1000
    }
    self.failures = 0
    // Whoever is still racing for the block has lost.
    for (const rival of runtime.attempts.get(block.index) ?? []) this.abortAttempt(rival, 'lost')
    this.recomputeAggregates(runtime)
    this.scheduleUpdate(runtime)
    return 'continue'
  }

  /** The download was paused or cancelled while the request was in flight. */
  private finishStopped(
    runtime: DownloadRuntime,
    chunk: ChunkState,
    self: ChunkRuntime,
    attempt: Attempt
  ): 'stop' {
    const status = runtime.state.status as DownloadStatus
    if (attempt.kind === 'primary') {
      this.endAttempt(runtime, self, attempt)
      if (status === 'paused') attempt.block.status = 'pending'
    } else {
      this.letGo(runtime, chunk, self, attempt, false)
    }
    chunk.status = status === 'paused' ? 'paused' : 'cancelled'
    chunk.currentBlockIndex = undefined
    chunk.hedge = undefined
    chunk.speedBytesPerSec = 0
    return 'stop'
  }

  private async finishAborted(
    runtime: DownloadRuntime,
    chunk: ChunkState,
    self: ChunkRuntime,
    attempt: Attempt,
    reason: AbortReason
  ): Promise<'continue'> {
    // 'lost': another attempt decided the block, so its state is no longer this one's to touch.
    // 'refresh': not a failure — no retry counted, no backoff. Whoever takes the block next
    // resumes it from the staging file on a new connection.
    this.letGo(runtime, chunk, self, attempt, reason === 'refresh' && attempt.networkReceived === 0)
    if (reason === 'refresh' && attempt.kind === 'primary') {
      // A moment before this stream asks again, so that a connection already proven fast, if
      // there is one, gets to the block before this one does.
      this.scheduleUpdate(runtime)
      await delay(REFRESH_HANDOFF_MS, self.controller.signal)
      self.warmSince = Date.now()
      self.slowSince = null
    }
    return 'continue'
  }

  private async finishFailed(
    runtime: DownloadRuntime,
    chunk: ChunkState,
    self: ChunkRuntime,
    attempt: Attempt,
    error: unknown
  ): Promise<'continue' | 'stop'> {
    const message = error instanceof Error ? error.message : String(error)
    chunk.error = message
    const deliveredNothing = attempt.networkReceived === 0

    if (error instanceof RemoteChangedError) {
      const verdict =
        error.check.kind === 'size'
          ? 'different'
          : await this.confirmSameBytes(runtime, self.connection, error.seen)
      // The check takes a moment; the download may have been paused or stopped meanwhile.
      if ((runtime.state.status as DownloadStatus) !== 'downloading') {
        return this.finishStopped(runtime, chunk, self, attempt)
      }
      if (verdict === 'same') {
        // Same bytes under another label — accept it and fetch again straight away; nothing from
        // the rejected response was written.
        if (compareVersion(runtime.acceptedVersions, error.seen).kind !== 'same') {
          runtime.acceptedVersions.push(error.seen)
        }
        chunk.error = undefined
        this.letGo(runtime, chunk, self, attempt, false)
        return 'continue'
      }
      if (verdict === 'different') {
        // Every other worker would hit the same new version, so stop them all now rather than
        // let each burn through its retries first.
        this.letGo(runtime, chunk, self, attempt, false)
        chunk.status = 'error'
        runtime.state.status = 'error'
        runtime.state.error = message
        for (const other of runtime.chunkRuntimes.values()) other.controller.abort()
        return 'stop'
      }
      // 'unknown' — nothing to compare yet, or the check itself failed: retry like any other
      // failed request. Nothing wrong was written either way.
    }

    if (error instanceof NoCompatibleRouteError) {
      // A redirect can move this worker to a host its network cannot reach. Return its block
      // to the shared queue so another compatible worker can finish it.
      this.letGo(runtime, chunk, self, attempt, deliveredNothing)
      chunk.status = 'error'
      if (runtime.state.chunks.every((entry) => entry.status === 'error')) {
        runtime.state.status = 'error'
        runtime.state.error = message
      }
      this.scheduleUpdate(runtime)
      return 'stop'
    }

    // A hedge is optional work: its failure isn't retried, and what it did write stays.
    if (attempt.kind === 'hedge') {
      this.letGo(runtime, chunk, self, attempt, deliveredNothing)
      return 'continue'
    }

    self.failures += 1
    chunk.retryCount += 1
    // Back to the queue, so any available worker can pick it up.
    this.letGo(runtime, chunk, self, attempt, deliveredNothing)

    if (self.failures > MAX_CHUNK_RETRIES) {
      chunk.status = 'error'
      const allErrored = runtime.state.chunks.every((c) => c.status === 'error')
      if (allErrored && (runtime.state.status as DownloadStatus) === 'downloading') {
        runtime.state.status = 'error'
        runtime.state.error = message
        this.notify('Download Failed', `${runtime.state.fileName}: ${message}`)
        for (const other of runtime.chunkRuntimes.values()) other.controller.abort()
      }
      return 'stop'
    }

    chunk.status = 'retrying'
    this.scheduleUpdate(runtime)
    await delay(retryDelayMs(self.failures), self.controller.signal)
    const statusAfterDelay = runtime.state.status as DownloadStatus
    if (self.controller.signal.aborted || statusAfterDelay !== 'downloading') {
      chunk.status = statusAfterDelay === 'paused' ? 'paused' : 'cancelled'
      chunk.speedBytesPerSec = 0
      return 'stop'
    }
    this.goIdle(chunk)
    self.warmSince = Date.now()
    self.slowSince = null
    return 'continue'
  }

  /**
   * The stream stops working on the attempt's block without having finished it. A primary hands
   * the block back to the queue; a hedge just drops out. Either way what it wrote stays counted.
   * When the attempt delivered nothing, its network is remembered (see scheduler.ts).
   */
  private letGo(
    runtime: DownloadRuntime,
    chunk: ChunkState,
    self: ChunkRuntime,
    attempt: Attempt,
    deliveredNothing: boolean
  ): void {
    this.endAttempt(runtime, self, attempt)
    const { block } = attempt
    // A block another attempt has finished stays finished.
    if (attempt.kind === 'primary' && block.status === 'downloading') block.status = 'pending'
    if (deliveredNothing) runtime.avoidNetworkByBlock.set(block.index, attempt.networkId)
    this.goIdle(chunk)
  }

  private async runWorker(runtime: DownloadRuntime, chunk: ChunkState): Promise<void> {
    const iface =
      runtime.activeInterfaces.find((i) => i.id === chunk.interfaceId) ??
      runtime.activeInterfaces[chunk.id % runtime.activeInterfaces.length] ??
      runtime.activeInterfaces[0]

    if (!iface) {
      chunk.status = 'error'
      chunk.error = 'No active network interface available'
      this.scheduleUpdate(runtime)
      return
    }

    const controller = new AbortController()
    const self: ChunkRuntime = {
      controller,
      connection: new StreamConnection(iface, testKnobs.stallTimeoutMs),
      attempt: null,
      warmSince: Date.now(),
      slowSince: null,
      lastBlockSpeed: 0,
      receivedBytes: 0,
      failures: 0
    }
    runtime.chunkRuntimes.set(chunk.id, self)

    try {
      while (runtime.state.status === 'downloading') {
        if (controller.signal.aborted) break

        // Taken atomically: nothing between choosing the work and registering it can yield.
        const work = pickWork(
          {
            blocks: runtime.blocks,
            streams: runtime.state.chunks,
            attempts: runtime.attempts,
            avoid: runtime.avoidNetworkByBlock,
            hedgesUsed: runtime.hedgesByBlock
          },
          { id: chunk.id, networkId: iface.id },
          Date.now(),
          SCHEDULER_POLICY
        )
        if (!work) {
          this.goIdle(chunk)
          // While blocks are still in flight, stay available in case one fails and is handed back,
          // or turns out to be slow enough to be worth racing.
          if (runtime.blocks.some((b) => b.status === 'pending' || b.status === 'downloading')) {
            this.scheduleUpdate(runtime)
            await delay(250, controller.signal)
            continue
          }
          chunk.status = 'completed'
          this.scheduleUpdate(runtime)
          break
        }

        const attempt = this.beginAttempt(runtime, chunk, self, iface, work)
        this.scheduleUpdate(runtime)
        const outcome = await this.executeAttempt(runtime, chunk, self, attempt)
        let next: 'continue' | 'stop'
        try {
          next = await this.finishAttempt(runtime, chunk, self, iface, attempt, outcome)
        } finally {
          this.endAttempt(runtime, self, attempt)
        }
        if (next === 'stop') break
      }
    } finally {
      // Its sockets would otherwise stay open, kept alive for requests that will never come.
      self.connection.close()
    }

    this.scheduleUpdate(runtime)
  }

  /**
   * Settles whether a server labelling the file differently (new ETag or Last-Modified, same
   * size) is serving the same bytes — load-balanced servers often disagree on labels for
   * identical files — or a new version. Re-fetches a spread of bytes this download already has
   * on disk, from a server presenting the new label, and compares them.
   *
   * 'unknown' when there's nothing on disk to compare yet or the samples couldn't be fetched;
   * the caller then treats the response as an ordinary failed request and retries.
   */
  private async confirmSameBytes(
    runtime: DownloadRuntime,
    connection: StreamConnection,
    seen: FileVersion
  ): Promise<'same' | 'different' | 'unknown'> {
    if (compareVersion(runtime.acceptedVersions, seen).kind === 'same') return 'same'

    // Every byte on disk came from an accepted version: mismatched responses are rejected
    // before anything is written.
    const withData = runtime.blocks.filter((block) => block.bytesDownloaded > 0)
    const step = Math.max(1, withData.length / MAX_SAMPLES)
    const picks = Array.from(
      { length: Math.min(MAX_SAMPLES, withData.length) },
      (_, i) => withData[Math.floor(i * step)]
    )

    let compared = 0
    for (const block of picks) {
      let local: Buffer
      try {
        local = await runtime.file.read(
          block.rangeStart,
          Math.min(SAMPLE_BYTES, block.bytesDownloaded)
        )
      } catch {
        continue
      }
      if (local.length === 0) continue

      for (let tries = 0; tries < SAMPLE_TRIES; tries++) {
        try {
          const remote = await fetchRange(
            runtime.requestPayload.url,
            block.rangeStart,
            block.rangeStart + local.length - 1,
            connection
          )
          // A reply from a server still presenting an accepted label proves nothing here.
          if (compareVersion([seen], remote.version).kind !== 'same') continue
          if (!remote.body.equals(local)) return 'different'
          compared += 1
          break
        } catch {
          return 'unknown'
        }
      }
    }
    return compared > 0 ? 'same' : 'unknown'
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
    }, UI_UPDATE_MS)
  }

  private pushUpdate(runtime: DownloadRuntime, persist = true): void {
    // A removed download can still be winding down (workers finishing, cleanup). Its updates
    // would put it back on screen after the renderer has already moved on.
    if (this.runtimes.get(runtime.state.id) !== runtime) return
    if (persist) this.schedulePersistence(runtime)
    const window = this.getWindow()
    if (!window || window.isDestroyed()) return
    if (runtime.state.status === 'paused' || runtime.state.status === 'cancelled') {
      runtime.state.speedBytesPerSec = 0
    }
    window.webContents.send(IpcChannels.downloadUpdated, structuredClone(runtime.state))
  }

  private schedulePersistence(runtime: DownloadRuntime): void {
    if (this.suspending || runtime.removed || runtime.persistenceTimer) return
    runtime.persistenceTimer = setTimeout(() => {
      runtime.persistenceTimer = undefined
      void this.persistNow(runtime)
    }, CHECKPOINT_INTERVAL_MS)
  }

  private persistNow(runtime: DownloadRuntime, required = false): Promise<void> {
    if (runtime.removed) return runtime.persistenceChain
    if (runtime.persistenceTimer) {
      clearTimeout(runtime.persistenceTimer)
      runtime.persistenceTimer = undefined
    }

    const operation = runtime.persistenceChain
      .catch(() => {})
      .then(async () => {
        if (runtime.removed) return
        const dir = this.downloadDir(runtime.state.id)
        const path = this.manifestPath(runtime.state.id)
        const temporaryPath = `${path}.tmp`
        const persisted: PersistedDownload = {
          version: 4,
          savedAt: Date.now(),
          state: structuredClone(runtime.state),
          partialPath: runtime.file.path,
          publicationPath: runtime.publicationPath,
          publicationIdentity: runtime.publicationIdentity,
          requestPayload: runtime.requestPayload,
          activeInterfaces: runtime.activeInterfaces
        }
        if (runtime.state.status === 'downloading' || runtime.state.status === 'paused') {
          await runtime.file.sync()
        }
        await ensureDirectory(dir)
        await writeFile(temporaryPath, JSON.stringify(persisted), 'utf-8')
        await rename(temporaryPath, path)
      })
    runtime.persistenceChain = operation.catch(() => {
      // Routine progress checkpoints are best-effort. Publication intent is required.
    })
    return required ? operation : runtime.persistenceChain
  }

  private async removePersistedDownload(
    runtime: DownloadRuntime,
    discardPartial = true
  ): Promise<void> {
    runtime.removed = true
    if (runtime.persistenceTimer) clearTimeout(runtime.persistenceTimer)
    await runtime.persistenceChain.catch(() => {})
    if (discardPartial) await runtime.file.discard().catch(() => {})
    await rm(this.downloadDir(runtime.state.id), { recursive: true, force: true })
  }
}
