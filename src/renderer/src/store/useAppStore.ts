import type {
  DownloadState,
  NetworkInterfaceInfo,
  NetworkPreference,
  NetworkPreferences,
  ThemeSource
} from '@shared/types'
import { create } from 'zustand'
import { groupChunksByInterface } from '../utils/format'

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

const SPEED_HISTORY_LENGTH = 60
const SPEED_SAMPLE_INTERVAL_MS = 1000

// Throttling cadence lives outside the store's own state — it's bookkeeping for how often to
// sample, not something a component should ever read or re-render on.
let lastSpeedSampleAt = 0

interface AppStore {
  interfaces: NetworkInterfaceInfo[]
  interfacesStatus: LoadStatus
  interfacesError: string | null
  latencies: Record<string, number | null>
  /** User customizations (name/color) per network interface id — persisted in the main process. */
  networkPreferences: NetworkPreferences

  /** 'system' by default — persisted in the main process alongside nativeTheme.themeSource. */
  themeSource: ThemeSource

  homeDir: string
  downloadsDir: string
  pathsStatus: LoadStatus

  /** Plexo focuses on one download at a time — this is it. */
  currentDownload: DownloadState | null
  speedHistory: number[]
  /** Same rolling window as speedHistory, split by physical network — for the stacked
   * per-network throughput chart, keyed by interface id. */
  speedHistoryByInterface: Record<string, number[]>
  /** Highest combined speed seen so far this download — a rolling history window would lose it
   * once it ages out, so this is tracked as a running max instead. */
  peakSpeedBytesPerSec: number

  /** Lifted out of the Idle screen so it survives a swap to/from the No-connections screen. */
  draftUrl: string
  draftDestinationDir: string

  loadInterfaces: () => Promise<void>
  refreshLatencies: () => Promise<void>
  loadInitialPaths: () => Promise<void>
  loadNetworkPreferences: () => Promise<void>
  setNetworkPreference: (id: string, patch: NetworkPreference) => Promise<void>
  loadThemeSource: () => Promise<void>
  setThemeSource: (source: ThemeSource) => Promise<void>
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
  networkPreferences: {},
  themeSource: 'system',

  homeDir: '',
  downloadsDir: '',
  pathsStatus: 'idle',

  currentDownload: null,
  speedHistory: [],
  speedHistoryByInterface: {},
  peakSpeedBytesPerSec: 0,

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

  loadNetworkPreferences: async () => {
    try {
      const networkPreferences = await window.plexo.getNetworkPreferences()
      set({ networkPreferences })
    } catch {
      // Best-effort — a failed read just leaves networks under their OS names/default colors.
    }
  },

  setNetworkPreference: async (id, patch) => {
    // Optimistic update so the rename/recolor feels instant — the IPC round trip resolves
    // (or, on failure, quietly leaves the optimistic value as the source of truth for now).
    set((state) => ({
      networkPreferences: {
        ...state.networkPreferences,
        [id]: { ...state.networkPreferences[id], ...patch }
      }
    }))
    try {
      const networkPreferences = await window.plexo.setNetworkPreference(id, patch)
      set({ networkPreferences })
    } catch {
      // Leave the optimistic value in place — not persisted to disk, but still usable this session.
    }
  },

  loadThemeSource: async () => {
    try {
      const themeSource = await window.plexo.getThemeSource()
      set({ themeSource })
    } catch {
      // Best-effort — a failed read just leaves the toggle showing the 'system' default.
    }
  },

  setThemeSource: async (themeSource) => {
    // Optimistic update, same as setNetworkPreference — the toggle should feel instant.
    set({ themeSource })
    try {
      await window.plexo.setThemeSource(themeSource)
    } catch {
      // Leave the optimistic value in place — not persisted to disk, but still usable this session.
    }
  },

  setCurrentDownload: (download) => {
    const previous = get().currentDownload
    const isNewDownload = !previous || previous.id !== download.id

    let speedHistory = isNewDownload ? [] : get().speedHistory
    let speedHistoryByInterface = isNewDownload ? {} : get().speedHistoryByInterface
    let peakSpeedBytesPerSec = isNewDownload ? 0 : get().peakSpeedBytesPerSec
    if (isNewDownload) lastSpeedSampleAt = 0

    if (download.status === 'downloading') {
      peakSpeedBytesPerSec = Math.max(peakSpeedBytesPerSec, download.speedBytesPerSec)

      const now = Date.now()
      if (now - lastSpeedSampleAt >= SPEED_SAMPLE_INTERVAL_MS) {
        lastSpeedSampleAt = now
        speedHistory = [...speedHistory, download.speedBytesPerSec].slice(-SPEED_HISTORY_LENGTH)

        const nextByInterface: Record<string, number[]> = {}
        for (const group of groupChunksByInterface(download.chunks)) {
          const previousSeries = speedHistoryByInterface[group.interfaceId] ?? []
          nextByInterface[group.interfaceId] = [...previousSeries, group.speedBytesPerSec].slice(
            -SPEED_HISTORY_LENGTH
          )
        }
        speedHistoryByInterface = nextByInterface
      }
    }

    set({ currentDownload: download, speedHistory, speedHistoryByInterface, peakSpeedBytesPerSec })
  },

  clearCurrentDownload: () =>
    set({
      currentDownload: null,
      speedHistory: [],
      speedHistoryByInterface: {},
      peakSpeedBytesPerSec: 0
    }),

  setDraftUrl: (draftUrl) => set({ draftUrl }),
  setDraftDestinationDir: (draftDestinationDir) => set({ draftDestinationDir })
}))
