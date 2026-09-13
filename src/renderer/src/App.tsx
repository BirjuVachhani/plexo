import { useDownloadEvents } from './hooks/useDownloadEvents'
import { CompleteScreen } from './screens/CompleteScreen'
import { DownloadingScreen } from './screens/DownloadingScreen'
import { ErrorScreen } from './screens/ErrorScreen'
import { IdleScreen } from './screens/IdleScreen'
import { NoConnectionsScreen } from './screens/NoConnectionsScreen'
import { useAppStore } from './store/useAppStore'

function App(): React.JSX.Element {
  useDownloadEvents()

  const interfaces = useAppStore((store) => store.interfaces)
  const interfacesStatus = useAppStore((store) => store.interfacesStatus)
  const currentDownload = useAppStore((store) => store.currentDownload)
  const clearCurrentDownload = useAppStore((store) => store.clearCurrentDownload)

  const handleNewDownload = (): void => {
    if (currentDownload) void window.plexo.removeDownload(currentDownload.id)
    clearCurrentDownload()
  }

  if (currentDownload) {
    if (currentDownload.status === 'downloading' || currentDownload.status === 'paused') {
      return <DownloadingScreen download={currentDownload} />
    }
    if (currentDownload.status === 'completed') {
      return <CompleteScreen download={currentDownload} onNewDownload={handleNewDownload} />
    }
    return <ErrorScreen download={currentDownload} onNewDownload={handleNewDownload} />
  }

  if (interfacesStatus === 'ready' && interfaces.length === 0) {
    return <NoConnectionsScreen />
  }

  return <IdleScreen />
}

export default App
