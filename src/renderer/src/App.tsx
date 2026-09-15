import { useEffect } from 'react'
import { TitleBar, type TitleBarStatus } from './components/TitleBar'
import { useDownloadEvents } from './hooks/useDownloadEvents'
import { CompleteScreen } from './screens/CompleteScreen'
import { DownloadingScreen } from './screens/DownloadingScreen'
import { ErrorScreen } from './screens/ErrorScreen'
import { IdleScreen } from './screens/IdleScreen'
import { NoConnectionsScreen } from './screens/NoConnectionsScreen'
import { useAppStore } from './store/useAppStore'
import { groupChunksByInterface } from './utils/format'

function App(): React.JSX.Element {
  useDownloadEvents()

  const interfaces = useAppStore((store) => store.interfaces)
  const interfacesStatus = useAppStore((store) => store.interfacesStatus)
  const currentDownload = useAppStore((store) => store.currentDownload)
  const clearCurrentDownload = useAppStore((store) => store.clearCurrentDownload)
  const loadNetworkPreferences = useAppStore((store) => store.loadNetworkPreferences)
  const loadThemeSource = useAppStore((store) => store.loadThemeSource)

  useEffect(() => {
    loadNetworkPreferences()
    loadThemeSource()
  }, [loadNetworkPreferences, loadThemeSource])

  const handleNewDownload = (): void => {
    if (currentDownload) void window.plexo.removeDownload(currentDownload.id)
    clearCurrentDownload()
  }

  const handleDownloadAgain = (): void => {
    if (currentDownload) {
      const url = currentDownload.url
      void window.plexo.removeDownload(currentDownload.id)
      clearCurrentDownload()
      useAppStore.getState().setDraftUrl(url)
    }
  }

  const noConnections = interfacesStatus === 'ready' && interfaces.length === 0

  let screen: React.JSX.Element
  let titleBarStatus: TitleBarStatus = { kind: 'none' }

  if (currentDownload) {
    if (currentDownload.status === 'downloading') {
      screen = <DownloadingScreen download={currentDownload} />
      titleBarStatus = {
        kind: 'merged',
        networkCount: groupChunksByInterface(currentDownload.chunks).length
      }
    } else if (currentDownload.status === 'paused') {
      screen = <DownloadingScreen download={currentDownload} />
      titleBarStatus = {
        kind: 'paused',
        networkCount: groupChunksByInterface(currentDownload.chunks).length
      }
    } else if (currentDownload.status === 'completed') {
      screen = <CompleteScreen download={currentDownload} onNewDownload={handleNewDownload} />
    } else {
      screen = (
        <ErrorScreen
          download={currentDownload}
          onNewDownload={handleNewDownload}
          onDownloadAgain={handleDownloadAgain}
        />
      )
    }
  } else if (noConnections) {
    screen = <NoConnectionsScreen />
    titleBarStatus = { kind: 'offline' }
  } else {
    screen = <IdleScreen />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TitleBar status={titleBarStatus} />
      <div style={{ flex: 1, minHeight: 0 }}>{screen}</div>
    </div>
  )
}

export default App
