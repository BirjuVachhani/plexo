import { useState } from 'react'
import type { DownloadState } from '@shared/types'
import { ThroughputChart } from '../components/ThroughputChart'
import { useAppStore } from '../store/useAppStore'
import {
  FONT_MONO,
  FONT_UI,
  accentChipStyle,
  footerStyle,
  footerTextStyle,
  primaryButtonStyle,
  resolveNetworkVisual,
  secondaryButtonStyle,
  sectionHeaderLabelStyle,
  statGridStyle,
  statLabelStyle,
  statValueStyle
} from '../theme'
import {
  dirnameOf,
  formatBytes,
  formatDuration,
  formatSpeed,
  groupChunksByInterface,
  toDisplayPath
} from '../utils/format'

const heroScopeStyle: React.CSSProperties = {
  padding: '18px 20px',
  background: 'linear-gradient(#1f2224, #1b1e20)',
  borderBottom: '1px solid #2b2f33',
  color: '#f5f2ed',
  ...({
    '--text': '#f5f2ed',
    '--text-secondary': '#a9adb2',
    '--text-tertiary': '#8d9196',
    '--border': '#2b2f33'
  } as React.CSSProperties)
}

export function CompleteScreen({
  download,
  onNewDownload
}: {
  download: DownloadState
  onNewDownload: () => void
}): React.JSX.Element {
  const [chipModeIndex, setChipModeIndex] = useState(0)
  const homeDir = useAppStore((store) => store.homeDir)
  const peakSpeedBytesPerSec = useAppStore((store) => store.peakSpeedBytesPerSec)
  const speedHistoryByInterface = useAppStore((store) => store.speedHistoryByInterface)
  const networkPreferences = useAppStore((store) => store.networkPreferences)

  const finalSize = download.totalBytes || download.bytesDownloaded
  // completedAt is always set by the time a download reaches 'completed' — the
  // fallback here is just to keep this pure (no Date.now() during render).
  const elapsedSeconds = ((download.completedAt ?? download.startedAt) - download.startedAt) / 1000
  const avgSpeed = elapsedSeconds > 0 ? finalSize / elapsedSeconds : 0

  const groups = groupChunksByInterface(download.chunks)
  const visuals = groups.map((group) =>
    resolveNetworkVisual(
      group.interfaceKind,
      group.interfaceLabel,
      networkPreferences[group.interfaceId]
    )
  )
  const totalWeight = groups.reduce((sum, group) => sum + group.bytesDownloaded, 0) || 1
  const totalRetries = download.chunks.reduce((sum, chunk) => sum + chunk.retryCount, 0)

  // "Time saved" vs. what the download would have taken over its single best-performing
  // network alone, using that network's own realized average rate as the baseline.
  const fastestIndex = groups.reduce<number>(
    (fastest, group, idx) =>
      fastest === -1 || group.bytesDownloaded > groups[fastest].bytesDownloaded ? idx : fastest,
    -1
  )
  const fastestGroup = fastestIndex === -1 ? null : groups[fastestIndex]
  const fastestAvgSpeed =
    fastestGroup && elapsedSeconds > 0 ? fastestGroup.bytesDownloaded / elapsedSeconds : 0
  const soloBaselineSeconds = fastestAvgSpeed > 0 ? finalSize / fastestAvgSpeed : 0
  const secondsSaved = soloBaselineSeconds - elapsedSeconds

  const chipOptions: { label: string; tooltip: string }[] = []
  if (groups.length > 1) {
    if (secondsSaved > 1) {
      chipOptions.push({
        label: `SAVED ${formatDuration(secondsSaved)}`,
        tooltip: `Saved ~${formatDuration(secondsSaved)} vs fastest network alone`
      })
    }
    if (fastestIndex !== -1 && fastestAvgSpeed > 0 && avgSpeed > fastestAvgSpeed) {
      const ratio = avgSpeed / fastestAvgSpeed
      const name = visuals[fastestIndex].name.toUpperCase()
      chipOptions.push({
        label: `${ratio.toFixed(1)}× ${name} ALONE`,
        tooltip: `${ratio.toFixed(1)}× faster than ${visuals[fastestIndex].name} alone`
      })
      const pct = Math.round(((avgSpeed - fastestAvgSpeed) / fastestAvgSpeed) * 100)
      chipOptions.push({
        label: `+${pct}% VS ${name}`,
        tooltip: `+${pct}% throughput gain vs ${visuals[fastestIndex].name} alone`
      })
    }
  }

  const activeChipOption =
    chipOptions.length > 0 ? chipOptions[chipModeIndex % chipOptions.length] : null

  const handleReveal = (): void => void window.plexo.revealInFolder(download.destinationPath)

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}
    >
      <div style={heroScopeStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: '#22312e',
              border: '1px solid #3a5450',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <svg viewBox="0 0 24 24" style={{ width: 21, height: 21 }}>
              <path
                d="M5,13 L10,18 L19,7"
                fill="none"
                stroke="#4ea89a"
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                font: `700 16px/1.2 ${FONT_UI}`,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {download.fileName}
            </div>
            <div
              style={{
                marginTop: 5,
                font: `11.5px/1.3 ${FONT_MONO}`,
                color: '#8d9196',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {formatBytes(finalSize)} ·{' '}
              {toDisplayPath(dirnameOf(download.destinationPath), homeDir)}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
            <div
              style={{ font: `500 9px/1 ${FONT_MONO}`, letterSpacing: '0.16em', color: '#8d9196' }}
            >
              AVERAGE
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <div
                style={{
                  font: `600 26px/0.9 ${FONT_MONO}`,
                  letterSpacing: '-0.02em',
                  color: '#f5f2ed',
                  fontVariantNumeric: 'tabular-nums'
                }}
              >
                {formatSpeed(avgSpeed).split(' ')[0]}
              </div>
              <div style={{ font: `500 11px/1 ${FONT_MONO}`, color: '#8d9196' }}>MB/s</div>
            </div>
            {activeChipOption && (
              <button
                type="button"
                onClick={() => setChipModeIndex((i) => (i + 1) % chipOptions.length)}
                title={`${activeChipOption.tooltip} (click to toggle)`}
                style={{
                  ...accentChipStyle,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  cursor: 'pointer',
                  userSelect: 'none',
                  border: '0.5px solid var(--color-usb-border)',
                  background: 'var(--color-usb-bg)',
                  color: 'var(--color-usb-text)'
                }}
              >
                <span>{activeChipOption.label}</span>
                <span style={{ opacity: 0.55, fontSize: 8.5 }}>⇄</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div
        style={{
          margin: '18px 20px',
          ...statGridStyle,
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))'
        }}
      >
        {[
          { label: 'Size', value: formatBytes(finalSize) },
          { label: 'Time', value: formatDuration(elapsedSeconds) },
          { label: 'Peak', value: formatSpeed(peakSpeedBytesPerSec) },
          { label: 'Networks', value: String(groups.length) },
          { label: 'Chunks', value: String(download.chunks.length) }
        ].map((stat, index) => (
          <div
            key={stat.label}
            style={{
              padding: '11px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
              borderLeft: index > 0 ? '0.5px solid var(--border)' : undefined
            }}
          >
            <div style={statLabelStyle}>{stat.label}</div>
            <div style={statValueStyle}>{stat.value}</div>
          </div>
        ))}
      </div>

      <div style={{ margin: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={sectionHeaderLabelStyle}>Speed over the download</div>
        <ThroughputChart
          order={groups.map((g, i) => ({ interfaceId: g.interfaceId, solid: visuals[i].solid }))}
          historyByInterface={speedHistoryByInterface}
        />
      </div>

      <div
        style={{ margin: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 9, flex: 1 }}
      >
        <div style={sectionHeaderLabelStyle}>Contribution by network</div>
        <div
          style={{
            display: 'flex',
            height: 10,
            borderRadius: 999,
            overflow: 'hidden',
            background: 'var(--track-bg)',
            gap: 2
          }}
        >
          {groups.map((group, index) => (
            <div
              key={group.interfaceId}
              style={{ flex: group.bytesDownloaded || 0.0001, background: visuals[index].solid }}
            />
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {groups.map((group, index) => (
            <div key={group.interfaceId} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: visuals[index].solid
                }}
              />
              <div style={{ font: `500 12px/1 ${FONT_UI}` }}>{visuals[index].name}</div>
              <div style={{ flex: 1 }} />
              <div style={{ font: `11.5px/1 ${FONT_MONO}`, color: 'var(--text-secondary)' }}>
                {formatBytes(group.bytesDownloaded)} ·{' '}
                {Math.round((group.bytesDownloaded / totalWeight) * 100)}%
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={footerStyle}>
        <div style={footerTextStyle}>
          reassembled from {download.chunks.length} chunks
          {totalRetries > 0
            ? ` · ${totalRetries} ${totalRetries === 1 ? 'retry' : 'retries'}`
            : ' · 0 retries'}
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onNewDownload} style={secondaryButtonStyle}>
          New Download
        </button>
        <button type="button" onClick={handleReveal} style={primaryButtonStyle}>
          Reveal in Finder
        </button>
      </div>
    </div>
  )
}
