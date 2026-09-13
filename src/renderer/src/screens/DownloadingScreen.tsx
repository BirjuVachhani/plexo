import type { DownloadState } from '@shared/types'
import { useEffect, useState } from 'react'
import { MergeDiagram } from '../components/MergeDiagram'
import { NetworkRow } from '../components/NetworkRow'
import { ThroughputChart } from '../components/ThroughputChart'
import { useNetworkPolling } from '../hooks/useNetworkPolling'
import { useAppStore } from '../store/useAppStore'
import {
  FONT_MONO,
  FONT_UI,
  accentChipStyle,
  dangerButtonStyle,
  footerStyle,
  footerTextStyle,
  networkTableHeaderStyle,
  primaryButtonStyle,
  resolveNetworkVisual,
  secondaryButtonStyle,
  sectionHeaderLabelStyle,
  sectionHeaderMetaStyle
} from '../theme'
import {
  dirnameOf,
  fileExtensionBadge,
  formatBytes,
  formatEta,
  formatPercent,
  formatSpeed,
  groupChunksByInterface,
  splitFormattedBytes,
  toDisplayPath
} from '../utils/format'

// The hero band is always this exact dark panel from the design, regardless of the app's own
// light/dark theme — scoping the theme variables it reads (--text, --border, ...) to these
// literal values keeps its own children (labels, the merge diagram, the chart) legible no
// matter which OS appearance the rest of the window is following.
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

export function DownloadingScreen({ download }: { download: DownloadState }): React.JSX.Element {
  useNetworkPolling(true)

  const homeDir = useAppStore((store) => store.homeDir)
  const speedHistory = useAppStore((store) => store.speedHistory)
  const speedHistoryByInterface = useAppStore((store) => store.speedHistoryByInterface)
  const peakSpeedBytesPerSec = useAppStore((store) => store.peakSpeedBytesPerSec)
  const networkPreferences = useAppStore((store) => store.networkPreferences)
  const isPaused = download.status === 'paused'
  const percent = formatPercent(download.bytesDownloaded, download.totalBytes)
  const knownSize = download.totalBytes > 0
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (isPaused) return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [isPaused])

  useEffect(() => {
    if (isPaused) {
      document.title = knownSize ? `Plexo — Paused (${percent}%)` : 'Plexo — Paused'
    } else {
      document.title = knownSize ? `Plexo — ${percent}%` : 'Plexo — downloading'
    }
    return () => {
      document.title = 'Plexo'
    }
  }, [percent, knownSize, isPaused])

  const totalPausedMs =
    (download.totalPausedMs || 0) +
    (isPaused && download.pausedAt ? Math.max(0, now - download.pausedAt) : 0)
  const elapsedSeconds = Math.max(0, (now - download.startedAt - totalPausedMs) / 1000)

  const handlePauseResume = (): void => {
    if (isPaused) void window.plexo.resumeDownload(download.id)
    else void window.plexo.pauseDownload(download.id)
  }
  const handleCancel = (): void => void window.plexo.cancelDownload(download.id)

  const effectiveSpeed = isPaused ? 0 : download.speedBytesPerSec
  const speed = splitFormattedBytes(effectiveSpeed)
  const groups = groupChunksByInterface(download.chunks)
  const visuals = groups.map((group) =>
    resolveNetworkVisual(
      group.interfaceKind,
      group.interfaceLabel,
      networkPreferences[group.interfaceId]
    )
  )
  const activeGroups = groups.filter((group) =>
    group.chunks.some((chunk) => chunk.status === 'downloading')
  )
  const weights = groups.map((group) =>
    effectiveSpeed > 0 ? group.speedBytesPerSec : group.bytesDownloaded
  )
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1

  const [chipModeIndex, setChipModeIndex] = useState(0)

  const totalRetries = download.chunks.reduce((sum, chunk) => sum + chunk.retryCount, 0)
  const remainingBytes = knownSize ? Math.max(0, download.totalBytes - download.bytesDownloaded) : 0

  const avgSpeedBytesPerSec = elapsedSeconds > 0 ? download.bytesDownloaded / elapsedSeconds : 0

  // Build list of toggleable comparison metrics for active networks (only "X× [NETWORK] ALONE")
  interface SpeedChipOption {
    label: string
    tooltip: string
    color: string
    bg: string
    border: string
  }
  const chipOptions: SpeedChipOption[] = []
  if (groups.length > 1 && !isPaused) {
    const sortedIndices = groups
      .map((_, i) => i)
      .filter((i) =>
        download.speedBytesPerSec > 0
          ? groups[i].speedBytesPerSec > 0
          : groups[i].bytesDownloaded > 0
      )
      .sort((a, b) => {
        const valA =
          download.speedBytesPerSec > 0 ? groups[a].speedBytesPerSec : groups[a].bytesDownloaded
        const valB =
          download.speedBytesPerSec > 0 ? groups[b].speedBytesPerSec : groups[b].bytesDownloaded
        return valB - valA
      })

    for (const idx of sortedIndices) {
      const g = groups[idx]
      const visual = visuals[idx]
      const name = visual.name.toUpperCase()
      if (download.speedBytesPerSec > 0 && g.speedBytesPerSec > 0) {
        const ratio = download.speedBytesPerSec / g.speedBytesPerSec
        if (ratio >= 1.05) {
          chipOptions.push({
            label: `${ratio.toFixed(1)}× ${name} ALONE`,
            tooltip: `Total speed is ${ratio.toFixed(1)}× faster than ${visual.name} alone`,
            color: visual.text,
            bg: visual.bg,
            border: visual.border
          })
        }
      } else if (download.bytesDownloaded > 0 && g.bytesDownloaded > 0) {
        const ratio = download.bytesDownloaded / g.bytesDownloaded
        if (ratio >= 1.05) {
          chipOptions.push({
            label: `${ratio.toFixed(1)}× ${name} ALONE`,
            tooltip: `Total downloaded is ${ratio.toFixed(1)}× compared to ${visual.name} alone`,
            color: visual.text,
            bg: visual.bg,
            border: visual.border
          })
        }
      }
    }
  }

  const activeChipOption =
    chipOptions.length > 0 ? chipOptions[chipModeIndex % chipOptions.length] : null

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}
    >
      <div style={heroScopeStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <MergeDiagram
            networks={groups.map((group, index) => ({
              solid: visuals[index].solid,
              label: visuals[index].name,
              speedBytesPerSec: isPaused ? 0 : group.speedBytesPerSec
            }))}
            paused={isPaused}
          />

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 7,
              minWidth: 130,
              flexShrink: 0
            }}
          >
            <div
              style={{
                font: `500 10px/1 ${FONT_MONO}`,
                letterSpacing: '0.2em',
                color: '#8d9196',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <span>TOTAL SPEED</span>
              {isPaused && (
                <span
                  style={{
                    font: `600 9px/1 ${FONT_MONO}`,
                    letterSpacing: '0.08em',
                    color: 'var(--color-usb)',
                    background: 'var(--color-usb-bg)',
                    border: '0.5px solid var(--color-usb-border)',
                    padding: '2px 5px',
                    borderRadius: 3
                  }}
                >
                  PAUSED
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
              <div
                style={{
                  font: `600 38px/0.88 ${FONT_MONO}`,
                  letterSpacing: '-0.03em',
                  color: isPaused ? 'var(--text-tertiary)' : '#f5f2ed',
                  fontVariantNumeric: 'tabular-nums'
                }}
              >
                {isPaused ? '—' : speed.value}
              </div>
              {!isPaused && (
                <div style={{ font: `500 12px/1 ${FONT_MONO}`, color: '#8d9196' }}>
                  {speed.unit}/s
                </div>
              )}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                font: `500 10px/1 ${FONT_MONO}`,
                color: '#8d9196',
                fontVariantNumeric: 'tabular-nums'
              }}
            >
              <span>
                AVG{' '}
                <span style={{ color: '#f5f2ed', fontWeight: 600 }}>
                  {formatSpeed(avgSpeedBytesPerSec)}
                </span>
              </span>
              <span style={{ opacity: 0.35 }}>·</span>
              <span>
                PEAK{' '}
                <span style={{ color: '#f5f2ed', fontWeight: 600 }}>
                  {formatSpeed(peakSpeedBytesPerSec)}
                </span>
              </span>
            </div>
            {isPaused ? (
              <div
                style={{
                  font: `500 11px/1.2 ${FONT_UI}`,
                  color: 'var(--text-tertiary)',
                  marginTop: 2
                }}
              >
                Download paused · Click Resume to continue
              </div>
            ) : (
              activeChipOption && (
                <button
                  type="button"
                  onClick={() => setChipModeIndex((i) => (i + 1) % chipOptions.length)}
                  title={`${activeChipOption.tooltip}${chipOptions.length > 1 ? ' (click to toggle)' : ''}`}
                  style={{
                    ...accentChipStyle,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    cursor: chipOptions.length > 1 ? 'pointer' : 'default',
                    userSelect: 'none',
                    border: `0.5px solid ${activeChipOption.border}`,
                    background: activeChipOption.bg,
                    color: activeChipOption.color,
                    width: 'fit-content'
                  }}
                >
                  <span>{activeChipOption.label}</span>
                  {chipOptions.length > 1 && (
                    <span style={{ opacity: 0.55, fontSize: 8.5 }}>⇄</span>
                  )}
                </button>
              )
            )}
          </div>

          <div
            style={{
              flex: 1,
              minWidth: 0,
              opacity: isPaused ? 0.45 : 1,
              transition: 'opacity 0.2s'
            }}
          >
            <div
              style={{
                font: `500 9.5px/1 ${FONT_MONO}`,
                letterSpacing: '0.12em',
                color: '#8d9196'
              }}
            >
              THROUGHPUT · {isPaused ? 'PAUSED' : `LAST ${speedHistory.length}S`}
            </div>
            <ThroughputChart
              order={groups.map((g, i) => ({
                interfaceId: g.interfaceId,
                solid: visuals[i].solid
              }))}
              historyByInterface={speedHistoryByInterface}
            />
          </div>
        </div>
      </div>

      <div
        style={{
          padding: '14px 20px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 11
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 9,
              background: 'var(--bg-secondary)',
              border: '0.5px solid var(--border-strong)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              font: `600 8.5px/1 ${FONT_MONO}`,
              color: 'var(--text-secondary)',
              flexShrink: 0
            }}
          >
            {fileExtensionBadge(download.fileName)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                font: `600 13px/1.3 ${FONT_UI}`,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
              title={download.fileName}
            >
              {download.fileName}
            </div>
            <div
              style={{
                marginTop: 2,
                font: `11.5px/1 ${FONT_MONO}`,
                color: 'var(--text-secondary)',
                fontVariantNumeric: 'tabular-nums',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <span>
                {formatBytes(download.bytesDownloaded)}
                {knownSize ? ` of ${formatBytes(download.totalBytes)} (${percent}%)` : ''}
              </span>
              {knownSize && remainingBytes > 0 && (
                <>
                  <span style={{ opacity: 0.35 }}>·</span>
                  <span>{formatBytes(remainingBytes)} remaining</span>
                </>
              )}
              {!isPaused && knownSize && effectiveSpeed > 0 && (
                <>
                  <span style={{ opacity: 0.35 }}>·</span>
                  <span style={{ color: 'var(--text)', fontWeight: 500 }}>
                    {formatEta(remainingBytes, effectiveSpeed)} left
                  </span>
                </>
              )}
              {isPaused && (
                <span
                  style={{
                    font: `600 9px/1 ${FONT_MONO}`,
                    letterSpacing: '0.08em',
                    color: 'var(--color-usb)',
                    background: 'var(--color-usb-bg)',
                    border: '0.5px solid var(--color-usb-border)',
                    padding: '2px 6px',
                    borderRadius: 3
                  }}
                >
                  PAUSED
                </span>
              )}
            </div>
          </div>
        </div>
        <div
          style={{
            height: 8,
            borderRadius: 999,
            background: 'var(--track-bg)',
            overflow: 'hidden',
            display: 'flex',
            gap: 2
          }}
        >
          {knownSize ? (
            <>
              {groups.map((group, index) => (
                <div
                  key={group.interfaceId}
                  style={{
                    flex: group.bytesDownloaded || 0.0001,
                    background: visuals[index].solid
                  }}
                />
              ))}
              <div style={{ flex: remainingBytes || 0.0001 }} />
            </>
          ) : (
            <div style={{ width: '100%', background: 'var(--color-accent)' }} />
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            padding: '0 20px 8px'
          }}
        >
          <div style={sectionHeaderLabelStyle}>Networks</div>
          <div style={sectionHeaderMetaStyle}>
            {groups.length} merged · {download.chunks.length} chunks ·{' '}
            {isPaused ? 'paused' : `${activeGroups.length} active`}
          </div>
        </div>
        <div style={networkTableHeaderStyle}>
          <div />
          <div>Network</div>
          <div>Chunks</div>
          <div style={{ textAlign: 'right' }}>Share</div>
          <div style={{ textAlign: 'right' }}>Speed</div>
          <div style={{ textAlign: 'right' }}>Downloaded</div>
        </div>
        {groups.map((group, index) => (
          <NetworkRow
            key={group.interfaceId}
            group={group}
            totalBytes={download.totalBytes}
            sharePercent={(weights[index] / totalWeight) * 100}
          />
        ))}
      </div>

      <div style={footerStyle}>
        <div
          style={{
            ...footerTextStyle,
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            gap: 7
          }}
        >
          <span
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={`Saving to: ${download.destinationPath}`}
          >
            Saving to {toDisplayPath(dirnameOf(download.destinationPath), homeDir)}
          </span>
          <span style={{ opacity: 0.35, flexShrink: 0 }}>·</span>
          <span style={{ flexShrink: 0 }}>Resumable</span>
          {totalRetries > 0 && (
            <>
              <span style={{ opacity: 0.35, flexShrink: 0 }}>·</span>
              <span style={{ color: 'var(--color-usb)', flexShrink: 0 }}>
                {totalRetries} {totalRetries === 1 ? 'retry' : 'retries'}
              </span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={handlePauseResume}
          style={isPaused ? primaryButtonStyle : secondaryButtonStyle}
        >
          {isPaused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" onClick={handleCancel} style={dangerButtonStyle}>
          Cancel
        </button>
      </div>
    </div>
  )
}
