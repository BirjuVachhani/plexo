import { clipboard, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { IpcChannels } from '../../shared/ipc-channels'
import type {
  NetworkInterfaceInfo,
  NetworkPreference,
  StartDownloadRequest
} from '../../shared/types'
import { DownloadManager } from '../download/downloadManager'
import { getDefaultDownloadsDir, getHomeDir } from '../download/paths'
import { probeUrl } from '../download/probe'
import { measureLatencies } from '../network/latency'
import { listActiveInterfaces } from '../network/interfaces'
import { loadNetworkPreferences, saveNetworkPreference } from '../network/preferences'

const NETWORK_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.network'

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): DownloadManager {
  let cachedInterfaces: NetworkInterfaceInfo[] = []

  const manager = new DownloadManager(getWindow, (id) =>
    cachedInterfaces.find((iface) => iface.id === id)
  )

  ipcMain.handle(IpcChannels.listInterfaces, async () => {
    cachedInterfaces = await listActiveInterfaces()
    return cachedInterfaces
  })

  ipcMain.handle(IpcChannels.pingInterfaces, async () => measureLatencies(cachedInterfaces))

  ipcMain.handle(IpcChannels.getNetworkPreferences, async () => loadNetworkPreferences())

  ipcMain.handle(
    IpcChannels.setNetworkPreference,
    async (_event, id: string, patch: NetworkPreference) => saveNetworkPreference(id, patch)
  )

  ipcMain.handle(IpcChannels.openNetworkSettings, async () => {
    await shell.openExternal(NETWORK_SETTINGS_URL)
  })

  ipcMain.handle(IpcChannels.probeUrl, async (_event, url: string) => probeUrl(url))

  ipcMain.handle(IpcChannels.getInitialPaths, async () => ({
    homeDir: getHomeDir(),
    downloadsDir: getDefaultDownloadsDir()
  }))

  ipcMain.handle(IpcChannels.chooseDestinationFolder, async (_event, defaultPath: string) => {
    const window = getWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      defaultPath,
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IpcChannels.readClipboardText, async () => clipboard.readText())

  ipcMain.handle(IpcChannels.revealInFolder, async (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle(IpcChannels.startDownload, async (_event, request: StartDownloadRequest) =>
    manager.start(request)
  )

  ipcMain.handle(IpcChannels.pauseDownload, async (_event, id: string) => {
    manager.pause(id)
  })

  ipcMain.handle(IpcChannels.resumeDownload, async (_event, id: string) => {
    manager.resume(id)
  })

  ipcMain.handle(IpcChannels.cancelDownload, async (_event, id: string) => {
    manager.cancel(id)
  })

  ipcMain.handle(IpcChannels.removeDownload, async (_event, id: string) => {
    manager.remove(id)
  })

  return manager
}
