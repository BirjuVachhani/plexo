import type { DownloadState } from '@shared/types'
import {
  DANGER,
  FONT_MONO,
  FONT_UI,
  footerStyle,
  footerTextStyle,
  primaryButtonStyle
} from '../theme'

export function ErrorScreen({
  download,
  onNewDownload
}: {
  download: DownloadState
  onNewDownload: () => void
}): React.JSX.Element {
  const cancelled = download.status === 'cancelled'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff' }}>
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 24
        }}
      >
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            background: cancelled ? '#c2c2c6' : DANGER,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            font: `700 15px/1 ${FONT_UI}`
          }}
        >
          {cancelled ? '–' : '!'}
        </div>
        <div style={{ font: `600 15px/1.2 ${FONT_UI}` }}>
          {cancelled ? 'Download cancelled' : 'Download failed'}
        </div>
        <div
          style={{
            maxWidth: 420,
            textAlign: 'center',
            font: `12px/1.5 ${FONT_MONO}`,
            color: '#6e6e73'
          }}
        >
          {download.fileName}
          {download.error ? ` — ${download.error}` : ''}
        </div>
      </div>

      <div style={footerStyle}>
        <div style={footerTextStyle}>{download.url}</div>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onNewDownload} style={primaryButtonStyle}>
          New Download
        </button>
      </div>
    </div>
  )
}
