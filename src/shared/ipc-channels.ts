export const IpcChannels = {
  listInterfaces: 'network:list-interfaces',
  pingInterfaces: 'network:ping-interfaces',
  openNetworkSettings: 'network:open-settings',
  getNetworkPreferences: 'network:get-preferences',
  setNetworkPreference: 'network:set-preference',
  probeUrl: 'download:probe',
  getInitialPaths: 'paths:get-initial',
  chooseDestinationFolder: 'dialog:choose-destination-folder',
  readClipboardText: 'clipboard:read-text',
  revealInFolder: 'shell:reveal-in-folder',
  startDownload: 'download:start',
  pauseDownload: 'download:pause',
  resumeDownload: 'download:resume',
  cancelDownload: 'download:cancel',
  removeDownload: 'download:remove',
  downloadUpdated: 'download:updated'
} as const
