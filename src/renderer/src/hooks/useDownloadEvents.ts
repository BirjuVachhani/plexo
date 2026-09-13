import { useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'

/** Subscribes once to main-process download progress pushes for the lifetime of the app. */
export function useDownloadEvents(): void {
  const setCurrentDownload = useAppStore((store) => store.setCurrentDownload)

  useEffect(() => {
    return window.plexo.onDownloadUpdated(setCurrentDownload)
  }, [setCurrentDownload])
}
