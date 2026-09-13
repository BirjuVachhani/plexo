import type { DownloadState } from '@shared/types'
import { useAppStore } from '../store/useAppStore'
import {
  FONT_MONO,
  FONT_UI,
  KIND_PALETTE,
  SUCCESS,
  footerStyle,
  footerTextStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  sectionHeaderLabelStyle
} from '../theme'
import { dirnameOf, formatBytes, formatDuration, formatSpeed, toDisplayPath } from '../utils/format'

const statLabelStyle: React.CSSProperties = {
  font: `600 9.5px/1 ${FONT_UI}`,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#8a8a8e'
}

const statValueStyle: React.CSSProperties = {
  font: `15px/1 ${FONT_MONO}`,
  fontVariantNumeric: 'tabular-nums'
}

export function CompleteScreen({
  download,
  onNewDownload
}: {
  download: DownloadState
  onNewDownload: () => void
}): React.JSX.Element {
  const homeDir = useAppStore((store) => store.homeDir)

  const finalSize = download.totalBytes || download.bytesDownloaded
  // completedAt is always set by the time a download reaches 'completed' — the
  // fallback here is just to keep this pure (no Date.now() during render).
  const elapsedSeconds = ((download.completedAt ?? download.startedAt) - download.startedAt) / 1000
  const avgSpeed = elapsedSeconds > 0 ? finalSize / elapsedSeconds : 0

  const totalWeight = download.chunks.reduce((sum, chunk) => sum + chunk.bytesDownloaded, 0) || 1

  const handleReveal = (): void => void window.plexo.revealInFolder(download.destinationPath)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff' }}>
      <div style={{ padding: '22px 20px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            background: SUCCESS,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            font: `700 15px/1 ${FONT_UI}`,
            flexShrink: 0
          }}
        >
          ✓
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <div style={{ font: `600 15px/1.2 ${FONT_UI}` }}>Download complete</div>
          <div
            style={{
              font: `12px/1.3 ${FONT_MONO}`,
              color: '#6e6e73',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {download.fileName} — {toDisplayPath(dirnameOf(download.destinationPath), homeDir)}
          </div>
        </div>
      </div>

      <div
        style={{
          margin: '0 20px 18px',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          border: '0.5px solid #e0e0e2',
          borderRadius: 8,
          overflow: 'hidden',
          background: '#fafafa'
        }}
      >
        {[
          { label: 'Size', value: formatBytes(finalSize) },
          { label: 'Time', value: formatDuration(elapsedSeconds) },
          { label: 'Avg speed', value: formatSpeed(avgSpeed) },
          { label: 'Streams', value: String(download.chunks.length) }
        ].map((stat, index) => (
          <div
            key={stat.label}
            style={{
              padding: '11px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
              borderLeft: index > 0 ? '0.5px solid #e0e0e2' : undefined
            }}
          >
            <div style={statLabelStyle}>{stat.label}</div>
            <div style={statValueStyle}>{stat.value}</div>
          </div>
        ))}
      </div>

      <div
        style={{ margin: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 9, flex: 1 }}
      >
        <div style={sectionHeaderLabelStyle}>Contribution</div>
        <div
          style={{
            display: 'flex',
            height: 8,
            borderRadius: 4,
            overflow: 'hidden',
            background: '#e4e4e6'
          }}
        >
          {download.chunks.map((chunk) => (
            <div
              key={chunk.id}
              style={{
                flex: chunk.bytesDownloaded,
                background: KIND_PALETTE[chunk.interfaceKind].solid
              }}
            />
          ))}
        </div>
        <div
          style={{
            display: 'flex',
            gap: 18,
            font: `11px/1 ${FONT_MONO}`,
            color: '#6e6e73',
            flexWrap: 'wrap'
          }}
        >
          {download.chunks.map((chunk) => (
            <div key={chunk.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: KIND_PALETTE[chunk.interfaceKind].solid
                }}
              />
              {KIND_PALETTE[chunk.interfaceKind].label} {formatBytes(chunk.bytesDownloaded)} ·{' '}
              {Math.round((chunk.bytesDownloaded / totalWeight) * 100)}%
            </div>
          ))}
        </div>
      </div>

      <div style={footerStyle}>
        <div style={footerTextStyle}>Reassembled from {download.chunks.length} chunks</div>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onNewDownload} style={secondaryButtonStyle}>
          New Download
        </button>
        <button
          type="button"
          onClick={handleReveal}
          style={{ ...primaryButtonStyle, padding: '6px 16px' }}
        >
          Reveal in Finder
        </button>
      </div>
    </div>
  )
}
