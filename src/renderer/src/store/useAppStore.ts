import type { DownloadState, NetworkInterfaceInfo } from '@shared/types'
import { create } from 'zustand'

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

const SPEED_HISTORY_LENGTH = 24

interface AppStore {
  interfaces: NetworkInterfaceInfo[]
  interfacesStatus: LoadStatus
  interfacesError: string | null
  latencies: Record<string, number | null>

  homeDir: string
  downloadsDir: string
  pathsStatus: LoadStatus

  /** Plexo focuses on one download at a time — this is it. */
  currentDownload: DownloadState | null
  speedHistory: number[]

  /** Lifted out of the Idle screen so it survives a swap to/from the No-connections screen. */
  draftUrl: string
  draftDestinationDir: string

  loadInterfaces: () => Promise<void>
  refreshLatencies: () => Promise<void>
  loadInitialPaths: () => Promise<void>
  setCurrentDownload: (state: DownloadState) => void
  clearCurrentDownload: () => void
  setDraftUrl: (url: string) => void
  setDraftDestinationDir: (dir: string) => void
}

export const useAppStore = create<AppStore>((set, get) => ({
  interfaces: [],
  interfacesStatus: 'idle',
  interfacesError: null,
  latencies: {},

  homeDir: '',
  downloadsDir: '',
  pathsStatus: 'idle',

  currentDownload: null,
  speedHistory: [],

  draftUrl: '',
  draftDestinationDir: '',

  loadInterfaces: async () => {
    set({ interfacesStatus: 'loading', interfacesError: null })
    try {
      const interfaces = await window.plexo.listInterfaces()
      set({ interfaces, interfacesStatus: 'ready' })
    } catch (error) {
      set({
        interfacesStatus: 'error',
        interfacesError: error instanceof Error ? error.message : String(error)
      })
    }
  },

  refreshLatencies: async () => {
    try {
      const latencies = await window.plexo.pingInterfaces()
      set({ latencies })
    } catch {
      // Latency is a nice-to-have readout — a failed probe just leaves stale values.
    }
  },

  loadInitialPaths: async () => {
    set({ pathsStatus: 'loading' })
    try {
      const { homeDir, downloadsDir } = await window.plexo.getInitialPaths()
      set({ homeDir, downloadsDir, pathsStatus: 'ready' })
    } catch {
      set({ pathsStatus: 'error' })
    }
  },

  setCurrentDownload: (download) => {
    const previous = get().currentDownload
    const isNewDownload = !previous || previous.id !== download.id
    set({
      currentDownload: download,
      speedHistory:
        download.status === 'downloading'
          ? [...(isNewDownload ? [] : get().speedHistory), download.speedBytesPerSec].slice(
              -SPEED_HISTORY_LENGTH
            )
          : isNewDownload
            ? []
            : get().speedHistory
    })
  },

  clearCurrentDownload: () => set({ currentDownload: null, speedHistory: [] }),

  setDraftUrl: (draftUrl) => set({ draftUrl }),
  setDraftDestinationDir: (draftDestinationDir) => set({ draftDestinationDir })
}))
