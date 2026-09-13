import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IpcChannels } from '../shared/ipc-channels'
import type {
  DownloadState,
  NetworkInterfaceInfo,
  NetworkPreference,
  NetworkPreferences,
  ProbeResult,
  StartDownloadRequest
} from '../shared/types'

export interface InitialPaths {
  homeDir: string
  downloadsDir: string
}

const plexoApi = {
  platform: process.platform,

  listInterfaces: (): Promise<NetworkInterfaceInfo[]> =>
    ipcRenderer.invoke(IpcChannels.listInterfaces),

  pingInterfaces: (): Promise<Record<string, number | null>> =>
    ipcRenderer.invoke(IpcChannels.pingInterfaces),

  openNetworkSettings: (): Promise<void> => ipcRenderer.invoke(IpcChannels.openNetworkSettings),

  getNetworkPreferences: (): Promise<NetworkPreferences> =>
    ipcRenderer.invoke(IpcChannels.getNetworkPreferences),

  setNetworkPreference: (id: string, patch: NetworkPreference): Promise<NetworkPreferences> =>
    ipcRenderer.invoke(IpcChannels.setNetworkPreference, id, patch),

  probeUrl: (url: string): Promise<ProbeResult> => ipcRenderer.invoke(IpcChannels.probeUrl, url),

  getInitialPaths: (): Promise<InitialPaths> => ipcRenderer.invoke(IpcChannels.getInitialPaths),

  chooseDestinationFolder: (defaultPath: string): Promise<string | null> =>
    ipcRenderer.invoke(IpcChannels.chooseDestinationFolder, defaultPath),

  readClipboardText: (): Promise<string> => ipcRenderer.invoke(IpcChannels.readClipboardText),

  revealInFolder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.revealInFolder, filePath),

  startDownload: (request: StartDownloadRequest): Promise<string> =>
    ipcRenderer.invoke(IpcChannels.startDownload, request),

  pauseDownload: (downloadId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.pauseDownload, downloadId),

  resumeDownload: (downloadId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.resumeDownload, downloadId),

  cancelDownload: (downloadId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.cancelDownload, downloadId),

  removeDownload: (downloadId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.removeDownload, downloadId),

  onDownloadUpdated: (callback: (state: DownloadState) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, state: DownloadState): void => callback(state)
    ipcRenderer.on(IpcChannels.downloadUpdated, listener)
    return () => ipcRenderer.removeListener(IpcChannels.downloadUpdated, listener)
  }
}

export type PlexoApi = typeof plexoApi

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('plexo', plexoApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.plexo = plexoApi
}
