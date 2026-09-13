import type { DownloadState } from '@shared/types'
import { useEffect, useState } from 'react'
import { StreamRow } from '../components/StreamRow'
import { useAppStore } from '../store/useAppStore'
import {
  FONT_MONO,
  FONT_UI,
  KIND_PALETTE,
  PROGRESS_GRADIENT,
  footerStyle,
  footerTextStyle,
  secondaryButtonStyle,
  sectionHeaderLabelStyle,
  sectionHeaderMetaStyle
} from '../theme'
import {
  connectionSuffixes,
  dirnameOf,
  formatBytes,
  formatDuration,
  formatEta,
  formatPercent,
  splitFormattedBytes,
  toDisplayPath
} from '../utils/format'

export function DownloadingScreen({ download }: { download: DownloadState }): React.JSX.Element {
  const homeDir = useAppStore((store) => store.homeDir)
  const speedHistory = useAppStore((store) => store.speedHistory)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const percent = formatPercent(download.bytesDownloaded, download.totalBytes)
  const knownSize = download.totalBytes > 0
  const isPaused = download.status === 'paused'

  useEffect(() => {
    document.title = knownSize ? `Plexo — ${percent}%` : 'Plexo — downloading'
    return () => {
      document.title = 'Plexo'
    }
  }, [percent, knownSize])

  const elapsedSeconds = (now - download.startedAt) / 1000
  const activeCount = download.chunks.filter((chunk) => chunk.status === 'downloading').length

  const handlePauseResume = (): void => {
    if (isPaused) void window.plexo.resumeDownload(download.id)
    else void window.plexo.pauseDownload(download.id)
  }
  const handleCancel = (): void => void window.plexo.cancelDownload(download.id)

  const speed = splitFormattedBytes(download.speedBytesPerSec)
  const totalSpeed = download.chunks.reduce((sum, chunk) => sum + chunk.speedBytesPerSec, 0)
  const weights = download.chunks.map((chunk) =>
    totalSpeed > 0 ? chunk.speedBytesPerSec : chunk.bytesDownloaded
  )
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1
  const maxSpeedSample = Math.max(1, ...speedHistory)
  const suffixes = connectionSuffixes(download.chunks)

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}
    >
      <div
        style={{
          padding: '18px 20px 16px',
          background: 'linear-gradient(180deg, #13161c, #0d0f14)',
          color: '#fff'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div
              style={{
                font: `600 10px/1 ${FONT_UI}`,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.55)'
              }}
            >
              Combined throughput
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
              <div
                style={{
                  font: `500 38px/1 ${FONT_MONO}`,
                  letterSpacing: '-0.02em',
                  fontVariantNumeric: 'tabular-nums'
                }}
              >
                {speed.value}
              </div>
              <div style={{ font: `13px/1 ${FONT_MONO}`, color: 'rgba(255,255,255,0.6)' }}>
                {speed.unit}/s
              </div>
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div
              style={{
                display: 'flex',
                height: 10,
                borderRadius: 5,
                overflow: 'hidden',
                background: 'rgba(255,255,255,0.1)'
              }}
            >
              {download.chunks.map((chunk, index) => (
                <div
                  key={chunk.id}
                  style={{
                    flex: weights[index],
                    background: KIND_PALETTE[chunk.interfaceKind].solid
                  }}
                />
              ))}
            </div>
            <div
              style={{
                display: 'flex',
                gap: 16,
                font: `10.5px/1 ${FONT_MONO}`,
                color: 'rgba(255,255,255,0.65)',
                flexWrap: 'wrap'
              }}
            >
              {download.chunks.map((chunk, index) => (
                <div key={chunk.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: KIND_PALETTE[chunk.interfaceKind].solid
                    }}
                  />
                  {KIND_PALETTE[chunk.interfaceKind].label}
                  {suffixes.get(chunk.id)} {Math.round((weights[index] / totalWeight) * 100)}%
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 44 }}>
            {speedHistory.map((value, index) => (
              <div
                key={index}
                style={{
                  width: 3,
                  borderRadius: 1.5,
                  background: 'rgba(255,255,255,0.34)',
                  height: `${Math.max(4, (value / maxSpeedSample) * 44)}px`
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: '14px 20px 12px', display: 'flex', flexDirection: 'column', gap: 9 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <div style={{ font: `500 13px/1 ${FONT_UI}` }}>{download.fileName}</div>
          <div style={{ flex: 1 }} />
          <div
            style={{
              font: `11.5px/1 ${FONT_MONO}`,
              color: 'var(--text-secondary)',
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {formatBytes(download.bytesDownloaded)}
            {knownSize ? ` of ${formatBytes(download.totalBytes)} · ${percent}%` : ''}
            {!isPaused && knownSize
              ? ` · ${formatEta(download.totalBytes - download.bytesDownloaded, download.speedBytesPerSec)} left`
              : ''}
            {isPaused ? ' · paused' : ''}
          </div>
        </div>
        <div
          style={{ height: 6, borderRadius: 3, background: 'var(--track-bg)', overflow: 'hidden' }}
        >
          <div
            style={{
              width: knownSize ? `${percent}%` : '100%',
              height: '100%',
              borderRadius: 3,
              background: PROGRESS_GRADIENT
            }}
          />
        </div>
      </div>

      <div
        style={{
          borderTop: '0.5px solid var(--border)',
          background: 'var(--bg-secondary)',
          flex: 1,
          overflowY: 'auto'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            padding: '11px 20px 7px'
          }}
        >
          <div style={sectionHeaderLabelStyle}>Streams</div>
          <div style={sectionHeaderMetaStyle}>
            {download.chunks.length} chunks · {activeCount} active
          </div>
        </div>
        {download.chunks.map((chunk) => (
          <StreamRow
            key={chunk.id}
            chunk={chunk}
            totalBytes={download.totalBytes}
            connectionSuffix={suffixes.get(chunk.id)}
          />
        ))}
      </div>

      <div style={footerStyle}>
        <div style={footerTextStyle}>
          elapsed {formatDuration(elapsedSeconds)} ·{' '}
          {toDisplayPath(dirnameOf(download.destinationPath), homeDir)}
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={handlePauseResume} style={secondaryButtonStyle}>
          {isPaused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          style={{ ...secondaryButtonStyle, padding: '6px 18px' }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
