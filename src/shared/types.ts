export type NetworkInterfaceKind = 'wifi' | 'usb' | 'ethernet' | 'bridge' | 'other'

export interface NetworkInterfaceInfo {
  /** Stable identifier for this interface (currently the OS device name, e.g. "en0"). */
  id: string
  device: string
  displayName: string
  address: string
  kind: NetworkInterfaceKind
  mac?: string
}

export interface ProbeResult {
  requestedUrl: string
  /** URL after following redirects — this is what the download should actually fetch. */
  finalUrl: string
  supportsRanges: boolean
  /** null when the server did not report a size. */
  totalBytes: number | null
  suggestedFileName: string
  contentType: string | null
  /** Strong validators, used to detect if the remote content changes between pause and resume. */
  etag: string | null
  lastModified: string | null
}

export type DownloadStatus = 'downloading' | 'paused' | 'completed' | 'error' | 'cancelled'

export type ChunkStatus =
  'pending' | 'downloading' | 'retrying' | 'paused' | 'completed' | 'error' | 'cancelled'

export interface ChunkState {
  id: number
  interfaceId: string
  interfaceLabel: string
  interfaceKind: NetworkInterfaceKind
  rangeStart: number
  /** null means an open-ended range (download to end of file). */
  rangeEnd: number | null
  bytesDownloaded: number
  speedBytesPerSec: number
  status: ChunkStatus
  error?: string
  /** Number of times this chunk's connection has been retried after a dropped/failed attempt. */
  retryCount: number
  /** Index of the block currently being downloaded by this worker chunk. */
  currentBlockIndex?: number
}

export type BlockStatus = 'pending' | 'downloading' | 'completed' | 'error'

export interface BlockState {
  index: number
  rangeStart: number
  rangeEnd: number | null
  status: BlockStatus
  /** The network currently leasing this block (or the last one to touch it). Only meaningful
   * as "who is working on it now" — for who actually *delivered* the bytes, read
   * `bytesByInterface`, since a block can be started on one network and finished on another
   * after a retry or a pause/resume. */
  interfaceId?: string
  bytesDownloaded: number
  /** Bytes of this block delivered by each network, keyed by interface id. Summing to
   * `bytesDownloaded`, this is what the block grid colors by, so a block split across
   * networks is attributed to all of them instead of only the one that happened to finish it. */
  bytesByInterface: Record<string, number>
}

export interface DownloadState {
  id: string
  url: string
  fileName: string
  destinationPath: string
  /** 0 means the size could not be determined ahead of time. */
  totalBytes: number
  bytesDownloaded: number
  speedBytesPerSec: number
  status: DownloadStatus
  chunks: ChunkState[]
  blocks?: BlockState[]
  totalBlocks?: number
  blockSizeBytes?: number
  error?: string
  startedAt: number
  pausedAt?: number
  totalPausedMs?: number
  completedAt?: number
}

/** User customization for one physical network, keyed by NetworkInterfaceInfo.id — lets a
 * cryptic OS device name (e.g. "feth0") get a real label, and a color distinct from its
 * kind's default. Persisted in the main process, independent of any single download. */
export interface NetworkPreference {
  customName?: string
  /** One of the app's curated swatch ids (see NETWORK_COLOR_SWATCHES) — not a raw hex, so every
   * swatch is guaranteed to have a legible on-solid text color already picked out for it. */
  colorId?: string
}

export type NetworkPreferences = Record<string, NetworkPreference>

export interface StartDownloadRequest {
  url: string
  destinationDir: string
  suggestedFileName: string
  /** 0 means unknown. */
  totalBytes: number
  supportsRanges: boolean
  interfaceIds: string[]
  /** Total chunks to split the download into across interfaceIds. */
  chunkCount: number
  /** Number of parallel connections allocated per physical network. */
  connectionsPerNetwork?: number
  etag: string | null
  lastModified: string | null
}
