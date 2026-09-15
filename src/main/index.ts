import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, nativeImage, nativeTheme, shell } from 'electron'
import { join } from 'path'
import iconDark from '../../resources/icon-dark.png?asset'
import iconLight from '../../resources/icon-light.png?asset'
import { registerIpcHandlers } from './ipc/handlers'
import { loadThemeSource } from './settings'
import type { DownloadManager } from './download/downloadManager'

// In dev mode the app runs as the raw `electron` binary, which otherwise shows "Electron" in
// the Dock tooltip/menu bar — must be set before the app is ready. Packaged builds already get
// this from electron-builder's productName, but setting it here keeps dev and packaged in sync.
app.setName('Plexo')

let mainWindow: BrowserWindow | null = null
let downloadManager: DownloadManager | null = null
let quitAfterSuspending = false

// The bundled app icon (build/icon.*) is fixed at build time, but the dock/taskbar icon
// can still be swapped at runtime so it matches the OS's light/dark appearance live.
function currentIconPath(): string {
  return nativeTheme.shouldUseDarkColors ? iconDark : iconLight
}

function applyThemedIcon(): void {
  const image = nativeImage.createFromPath(currentIconPath())
  if (process.platform === 'darwin') {
    app.dock?.setIcon(image)
  } else {
    mainWindow?.setIcon(image)
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 760,
    height: 560,
    minWidth: 620,
    minHeight: 420,
    show: false,
    autoHideMenuBar: true,
    title: 'Plexo',
    // Matches the renderer's dark-mode background so a live window resize
    // (which briefly exposes the raw window background) doesn't flash white.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ffffff',
    ...(process.platform !== 'darwin' ? { icon: currentIconPath() } : {}),
    // Design v2 draws its own logo + status readout where the title normally sits — on macOS,
    // keep the real traffic lights (still native, still draggable) but let the renderer's own
    // title bar occupy the rest of the strip instead of an OS-drawn title.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.plexo.app')

  // Applied before the window is created so the initial background/icon already match —
  // the saved preference otherwise only takes effect on the next 'updated' event.
  nativeTheme.themeSource = await loadThemeSource()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  downloadManager = registerIpcHandlers(() => mainWindow)

  nativeTheme.on('updated', () => {
    mainWindow?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ffffff')
    applyThemedIcon()
  })

  createWindow()
  applyThemedIcon()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', (event) => {
  if (quitAfterSuspending || !downloadManager) return

  event.preventDefault()
  void downloadManager.suspendAll().finally(() => {
    quitAfterSuspending = true
    app.quit()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
