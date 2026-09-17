import type { DownloadState } from '@shared/types'
import { useEffect, useState } from 'react'
import { BlockGrid } from '../components/BlockGrid'
import { CombineDiagram } from '../components/CombineDiagram'
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
  networkTableGridStyle,
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
// literal values keeps its own children (labels, the combine diagram, the chart) legible no
// matter which OS appearance the rest of the window is following.
const heroScopeStyle: React.CSSProperties = {
  padding: '18px 20px',
  background: 'var(--hero-bg)',
  borderBottom: '1px solid var(--hero-border)'
}

// Build list of toggleable comparison metrics for active networks (only "X× [NETWORK] ALONE").
interface SpeedChipOption {
  label: string
  tooltip: string
  color: string
  bg: string
  border: string
}

/** Inline "·" separator between adjacent stats. `shrink` pins it at its natural width inside a
 * flex row that might otherwise squeeze it (footer rows), matching each call site's prior style. */
function Dot({ shrink }: { shrink?: boolean }): React.JSX.Element {
  return <span style={{ opacity: 0.35, flexShrink: shrink ? 0 : undefined }}>·</span>
}

function InlineStat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <span>
      {label} <span className="font-semibold text-foreground">{value}</span>
    </span>
  )
}

/** The small "PAUSED"/"ASSEMBLING" tag next to the file name — shape is fixed, only the label
 * and its network-kind color tokens vary between the two call sites. */
function StatusPill({
  label,
  color,
  bg,
  border
}: {
  label: string
  color: string
  bg: string
  border: string
}): React.JSX.Element {
  return (
    <span
      style={{
        font: `600 9.5px/1 ${FONT_MONO}`,
        letterSpacing: '0.08em',
        color,
        background: bg,
        border: `0.5px solid ${border}`,
        padding: '2px 7px',
        borderRadius: 3.5
      }}
    >
      {label}
    </span>
  )
}

export function DownloadingScreen({ download }: { download: DownloadState }): React.JSX.Element {
  useNetworkPolling(true)

  const homeDir = useAppStore((store) => store.homeDir)
  const speedHistory = useAppStore((store) => store.speedHistory)
  const speedHistoryByInterface = useAppStore((store) => store.speedHistoryByInterface)
  const peakSpeedBytesPerSec = useAppStore((store) => store.peakSpeedBytesPerSec)
  const networkPreferences = useAppStore((store) => store.networkPreferences)
  const isPaused = download.status === 'paused'
  const isAssembling = download.status === 'assembling'
  const percent = formatPercent(download.bytesDownloaded, download.totalBytes)
  const assembledBytes = download.assembledBytes ?? 0
  const assemblePercent = formatPercent(assembledBytes, download.totalBytes)
  const knownSize = download.totalBytes > 0
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (isPaused) return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [isPaused])

  // Resuming round-trips through the main process to re-verify the download before flipping
  // status away from 'paused' (an ETag re-check over the network for a real download) — with no
  // feedback in between, a slow check reads as the button not having registered the click.
  const [resuming, setResuming] = useState(false)
  useEffect(() => {
    if (!isPaused || download.error) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResuming(false)
    }
  }, [isPaused, download.error])

  useEffect(() => {
    if (isAssembling) {
      document.title = `Plexo — Assembling (${assemblePercent}%)`
    } else if (isPaused) {
      document.title = knownSize ? `Plexo — Paused (${percent}%)` : 'Plexo — Paused'
    } else {
      document.title = knownSize ? `Plexo — ${percent}%` : 'Plexo — downloading'
    }
    return () => {
      document.title = 'Plexo'
    }
  }, [percent, assemblePercent, knownSize, isPaused, isAssembling])

  const totalPausedMs =
    (download.totalPausedMs || 0) +
    (isPaused && download.pausedAt ? Math.max(0, now - download.pausedAt) : 0)
  const elapsedSeconds = Math.max(0, (now - download.startedAt - totalPausedMs) / 1000)

  const handlePauseResume = (): void => {
    if (isPaused) {
      setResuming(true)
      void window.plexo.resumeDownload(download.id)
    } else {
      void window.plexo.pauseDownload(download.id)
    }
  }
  const handleCancel = (): void => void window.plexo.cancelDownload(download.id)

  const effectiveSpeed = isPaused ? 0 : download.speedBytesPerSec
  const speed = splitFormattedBytes(effectiveSpeed)
  const groups = groupChunksByInterface(download.chunks)
  const totalDownloadedByNetworks = groups.reduce((sum, g) => sum + g.bytesDownloaded, 0)
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

  const [chipModeIndex, setChipModeIndex] = useState(0)

  const totalRetries = download.chunks.reduce((sum, chunk) => sum + chunk.retryCount, 0)
  const remainingBytes = knownSize ? Math.max(0, download.totalBytes - download.bytesDownloaded) : 0

  const avgSpeedBytesPerSec = elapsedSeconds > 0 ? download.bytesDownloaded / elapsedSeconds : 0

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

  const throughputStatusLabel = isAssembling
    ? 'ASSEMBLING'
    : isPaused
      ? 'PAUSED'
      : `LAST ${speedHistory.length}S`
  const networksStatusLabel = isAssembling
    ? 'assembling'
    : isPaused
      ? 'paused'
      : `${activeGroups.length} active`
  const pauseResumeLabel = resuming ? 'Resuming…' : isPaused ? 'Resume' : 'Pause'

  return (
    <div className="flex h-full flex-col bg-background">
      <div style={heroScopeStyle} className="text-foreground">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <CombineDiagram
            networks={groups.map((group, index) => ({
              solid: visuals[index].solid,
              label: visuals[index].name,
              speedBytesPerSec: isPaused || isAssembling ? 0 : group.speedBytesPerSec
            }))}
            paused={isPaused}
            assembling={isAssembling}
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
            {isAssembling ? (
              <>
                <div
                  className="text-muted-foreground"
                  style={{ font: `500 10px/1 ${FONT_MONO}`, letterSpacing: '0.2em' }}
                >
                  ASSEMBLING
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                  <div
                    style={{
                      font: `600 38px/0.88 ${FONT_MONO}`,
                      letterSpacing: '-0.03em',
                      color: 'var(--color-ethernet)',
                      fontVariantNumeric: 'tabular-nums'
                    }}
                  >
                    {assemblePercent}
                  </div>
                  <div
                    className="text-muted-foreground"
                    style={{ font: `500 12px/1 ${FONT_MONO}` }}
                  >
                    %
                  </div>
                </div>
              </>
            ) : (
              <>
                <div
                  className="text-muted-foreground"
                  style={{
                    font: `500 10px/1 ${FONT_MONO}`,
                    letterSpacing: '0.2em',
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
                    className={isPaused ? 'text-muted-foreground' : 'text-foreground'}
                    style={{
                      font: `600 38px/0.88 ${FONT_MONO}`,
                      letterSpacing: '-0.03em',
                      fontVariantNumeric: 'tabular-nums'
                    }}
                  >
                    {isPaused ? '—' : speed.value}
                  </div>
                  {!isPaused && (
                    <div
                      className="text-muted-foreground"
                      style={{ font: `500 12px/1 ${FONT_MONO}` }}
                    >
                      {speed.unit}/s
                    </div>
                  )}
                </div>
                <div
                  className="text-muted-foreground"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    font: `500 10px/1 ${FONT_MONO}`,
                    fontVariantNumeric: 'tabular-nums'
                  }}
                >
                  <InlineStat label="AVG" value={formatSpeed(avgSpeedBytesPerSec)} />
                  <Dot />
                  <InlineStat label="PEAK" value={formatSpeed(peakSpeedBytesPerSec)} />
                </div>
                {isPaused ? (
                  <div
                    className={download.error ? 'text-destructive' : 'text-muted-foreground'}
                    style={{ font: `500 11px/1.2 ${FONT_UI}`, marginTop: 2 }}
                  >
                    {download.error ?? 'Download paused'}
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
              </>
            )}
          </div>

          <div
            style={{
              flex: 1,
              minWidth: 0,
              opacity: isPaused || isAssembling ? 0.45 : 1,
              transition: 'opacity 0.2s'
            }}
          >
            <div
              className="text-muted-foreground"
              style={{ font: `500 9.5px/1 ${FONT_MONO}`, letterSpacing: '0.12em' }}
            >
              THROUGHPUT · {throughputStatusLabel}
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
          padding: '16px 20px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            className="bg-card"
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              border: '0.5px solid var(--border-strong)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              font: `700 10.5px/1 ${FONT_MONO}`,
              color: 'var(--text-secondary)',
              letterSpacing: '0.04em',
              flexShrink: 0
            }}
          >
            {fileExtensionBadge(download.fileName)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              className="truncate text-foreground"
              style={{ font: `600 15px/1.3 ${FONT_UI}`, letterSpacing: '-0.01em' }}
              title={download.fileName}
            >
              {download.fileName}
            </div>
            <div
              style={{
                marginTop: 4,
                font: `12.5px/1.2 ${FONT_MONO}`,
                color: 'var(--text-secondary)',
                fontVariantNumeric: 'tabular-nums',
                display: 'flex',
                alignItems: 'center',
                gap: 7
              }}
            >
              <span>
                {formatBytes(isAssembling ? assembledBytes : download.bytesDownloaded)}
                {knownSize ? ` of ${formatBytes(download.totalBytes)}` : ''}
              </span>
              {knownSize && (
                <>
                  <Dot />
                  <span className="font-semibold text-foreground">
                    {isAssembling ? assemblePercent : percent}%
                  </span>
                </>
              )}
              {!isPaused && !isAssembling && knownSize && effectiveSpeed > 0 && (
                <>
                  <Dot />
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {formatEta(remainingBytes, effectiveSpeed)} left
                  </span>
                </>
              )}
              {isPaused && (
                <StatusPill
                  label="PAUSED"
                  color="var(--color-usb)"
                  bg="var(--color-usb-bg)"
                  border="var(--color-usb-border)"
                />
              )}
              {isAssembling && (
                <StatusPill
                  label="ASSEMBLING"
                  color="var(--color-ethernet-text)"
                  bg="var(--color-ethernet-bg)"
                  border="var(--color-ethernet-border)"
                />
              )}
            </div>
          </div>
        </div>

        <BlockGrid
          blocks={download.blocks}
          groups={groups}
          visuals={visuals}
          knownSize={knownSize}
          remainingBytes={remainingBytes}
          isPaused={isPaused}
          assembling={isAssembling}
          assembledBytes={assembledBytes}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
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
            {groups.length} combined · {download.chunks.length} streams · {networksStatusLabel}
          </div>
        </div>
        <div style={networkTableGridStyle}>
          <div style={networkTableHeaderStyle}>
            <div />
            <div>Network</div>
            <div>Progress</div>
            <div style={{ textAlign: 'right' }}>Share</div>
            <div style={{ textAlign: 'right' }}>Speed</div>
            <div style={{ textAlign: 'right' }}>Downloaded</div>
          </div>
          {groups.map((group) => {
            const sharePercent =
              totalDownloadedByNetworks > 0
                ? (group.bytesDownloaded / totalDownloadedByNetworks) * 100
                : 0
            return (
              <NetworkRow
                key={group.interfaceId}
                group={group}
                sharePercent={sharePercent}
                totalBytes={download.totalBytes}
                totalDownloaded={totalDownloadedByNetworks}
                blocks={download.blocks}
              />
            )
          })}
        </div>
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
          <span className="truncate" title={`Saving to: ${download.destinationPath}`}>
            Saving to {toDisplayPath(dirnameOf(download.destinationPath), homeDir)}
          </span>
          <Dot shrink />
          <span style={{ flexShrink: 0 }}>Resumable</span>
          {totalRetries > 0 && (
            <>
              <Dot shrink />
              <span style={{ color: 'var(--color-usb)', flexShrink: 0 }}>
                {totalRetries} {totalRetries === 1 ? 'retry' : 'retries'}
              </span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={handlePauseResume}
          disabled={isAssembling || resuming}
          title={isAssembling ? "Can't pause while assembling the file" : undefined}
          style={{
            ...(isPaused ? primaryButtonStyle : secondaryButtonStyle),
            ...((isAssembling || resuming) && { opacity: 0.5, cursor: 'not-allowed' })
          }}
        >
          {pauseResumeLabel}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={isAssembling}
          title={isAssembling ? "Can't cancel while assembling the file" : undefined}
          style={{
            ...dangerButtonStyle,
            ...(isAssembling && { opacity: 0.5, cursor: 'not-allowed' })
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
