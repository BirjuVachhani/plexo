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
}

export type DownloadStatus = 'downloading' | 'paused' | 'completed' | 'error' | 'cancelled'

export type ChunkStatus = 'pending' | 'downloading' | 'paused' | 'completed' | 'error' | 'cancelled'

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
  error?: string
  startedAt: number
  completedAt?: number
}

export interface StartDownloadRequest {
  url: string
  destinationDir: string
  suggestedFileName: string
  /** 0 means unknown. */
  totalBytes: number
  supportsRanges: boolean
  interfaceIds: string[]
}
