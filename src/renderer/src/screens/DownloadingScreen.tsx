import type { DownloadState } from '@shared/types'
import { useEffect, useState } from 'react'
import { BlockGrid } from '../components/BlockGrid'
import { ColorBadge } from '../components/ColorBadge'
import { CombineDiagram } from '../components/CombineDiagram'
import { CyclableChip } from '../components/CyclableChip'
import { NetworkRow } from '../components/NetworkRow'
import { ThroughputChart } from '../components/ThroughputChart'
import { TruncatedText } from '../components/TruncatedText'
import { Button } from '../components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { useNetworkPolling } from '../hooks/useNetworkPolling'
import { useNetworkVisuals } from '../hooks/useNetworkVisuals'
import { useAppStore } from '../store/useAppStore'
import { NETWORK_ROW_GRID_COLUMNS } from '../theme'
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
const heroClass = 'border-b border-b-[var(--hero-border)] bg-[image:var(--hero-bg)] px-5 py-[18px]'
const sectionHeaderClass =
  'font-mono text-[10px] leading-none tracking-[0.16em] text-muted-foreground uppercase'

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
  return <span className={`opacity-35 ${shrink ? 'shrink-0' : ''}`}>·</span>
}

function InlineStat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <span>
      {label} <span className="font-semibold text-foreground">{value}</span>
    </span>
  )
}

export function DownloadingScreen({ download }: { download: DownloadState }): React.JSX.Element {
  useNetworkPolling(true)

  const homeDir = useAppStore((store) => store.homeDir)
  const speedHistory = useAppStore((store) => store.speedHistory)
  const speedHistoryByInterface = useAppStore((store) => store.speedHistoryByInterface)
  const peakSpeedBytesPerSec = useAppStore((store) => store.peakSpeedBytesPerSec)
  const networkVisual = useNetworkVisuals()
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
  const handleCancel = (): void => {
    if (window.confirm('Cancel this download? Progress will be lost.')) {
      void window.plexo.cancelDownload(download.id)
    }
  }

  const effectiveSpeed = isPaused ? 0 : download.speedBytesPerSec
  const speed = splitFormattedBytes(effectiveSpeed)
  const groups = groupChunksByInterface(download.chunks)
  const totalDownloadedByNetworks = groups.reduce((sum, g) => sum + g.bytesDownloaded, 0)
  const visuals = groups.map((group) =>
    networkVisual(group.interfaceId, group.interfaceKind, group.interfaceLabel)
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
      ? null
      : `LAST ${speedHistory.length}S`
  const networksStatusLabel = isAssembling
    ? 'assembling'
    : isPaused
      ? null
      : `${activeGroups.length} active`
  const pauseResumeLabel = resuming ? 'Resuming…' : isPaused ? 'Resume' : 'Pause'

  return (
    <div className="flex h-full flex-col bg-background">
      <div className={`${heroClass} text-foreground`}>
        <div className="flex items-center gap-[14px]">
          <CombineDiagram
            networks={groups.map((group, index) => ({
              solid: visuals[index].solid,
              label: visuals[index].name,
              speedBytesPerSec: isPaused || isAssembling ? 0 : group.speedBytesPerSec
            }))}
            paused={isPaused}
            assembling={isAssembling}
          />

          <div className="flex min-w-[130px] shrink-0 flex-col gap-[7px]">
            {isAssembling ? (
              <>
                <div className="font-mono text-[10px] leading-none font-medium tracking-[0.2em] text-muted-foreground">
                  ASSEMBLING
                </div>
                <div className="flex items-baseline gap-[7px]">
                  <div className="font-mono text-[38px] leading-[0.88] font-semibold tracking-[-0.03em] tabular-nums text-[var(--color-ethernet)]">
                    {assemblePercent}
                  </div>
                  <div className="font-mono text-[12px] leading-none font-medium text-muted-foreground">
                    %
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5 font-mono text-[10px] leading-none font-medium tracking-[0.2em] text-muted-foreground">
                  <span>TOTAL SPEED</span>
                </div>
                <div className="flex items-baseline gap-[7px]">
                  <div
                    className={`font-mono text-[38px] leading-[0.88] font-semibold tracking-[-0.03em] tabular-nums ${
                      isPaused ? 'text-muted-foreground' : 'text-foreground'
                    }`}
                  >
                    {isPaused ? '—' : speed.value}
                  </div>
                  {!isPaused && (
                    <div className="font-mono text-[12px] leading-none font-medium text-muted-foreground">
                      {speed.unit}/s
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 font-mono text-[10px] leading-none font-medium tabular-nums text-muted-foreground">
                  <InlineStat label="AVG" value={formatSpeed(avgSpeedBytesPerSec)} />
                  <Dot />
                  <InlineStat label="PEAK" value={formatSpeed(peakSpeedBytesPerSec)} />
                </div>
                {isPaused
                  ? download.error && (
                      <div className="mt-0.5 font-sans text-[11px] leading-[1.2] font-medium text-destructive">
                        {download.error}
                      </div>
                    )
                  : activeChipOption && (
                      <CyclableChip
                        label={activeChipOption.label}
                        tooltip={`${activeChipOption.tooltip}${chipOptions.length > 1 ? ' (click to toggle)' : ''}`}
                        bg={activeChipOption.bg}
                        border={activeChipOption.border}
                        color={activeChipOption.color}
                        cyclable={chipOptions.length > 1}
                        onClick={() => setChipModeIndex((i) => (i + 1) % chipOptions.length)}
                      />
                    )}
              </>
            )}
          </div>

          <div
            className={`min-w-0 flex-1 transition-opacity duration-200 ${
              isPaused || isAssembling ? 'opacity-45' : 'opacity-100'
            }`}
          >
            <div className="font-mono text-[9.5px] leading-none font-medium tracking-[0.12em] text-muted-foreground">
              THROUGHPUT{throughputStatusLabel ? ` · ${throughputStatusLabel}` : ''}
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

      <div className="flex flex-col gap-3 p-[16px_20px_18px]">
        <div className="flex items-center gap-[14px]">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] border-[var(--border-strong)] bg-card font-mono text-[10.5px] leading-none font-bold tracking-[0.04em] text-[var(--text-secondary)]">
            {fileExtensionBadge(download.fileName)}
          </div>
          <div className="min-w-0 flex-1">
            <TruncatedText
              text={download.fileName}
              className="font-sans text-[15px] leading-[1.3] font-semibold tracking-[-0.01em] text-foreground"
            />
            <div className="mt-1 flex items-center gap-[7px] font-mono text-[12.5px] leading-[1.2] tabular-nums text-[var(--text-secondary)]">
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
                  <span className="text-[var(--text-secondary)]">
                    {formatEta(remainingBytes, effectiveSpeed)} left
                  </span>
                </>
              )}
              {isPaused && (
                <ColorBadge
                  bg="var(--color-usb-bg)"
                  border="var(--color-usb-border)"
                  text="var(--color-usb)"
                  className="h-auto rounded-[3.5px] px-[7px] py-0.5 text-[9.5px] font-semibold tracking-[0.08em]"
                >
                  PAUSED
                </ColorBadge>
              )}
              {isAssembling && (
                <ColorBadge
                  bg="var(--color-ethernet-bg)"
                  border="var(--color-ethernet-border)"
                  text="var(--color-ethernet-text)"
                  className="h-auto rounded-[3.5px] px-[7px] py-0.5 text-[9.5px] font-semibold tracking-[0.08em]"
                >
                  ASSEMBLING
                </ColorBadge>
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

      <div className="flex-1 overflow-x-hidden overflow-y-auto">
        <div className="flex items-baseline justify-between p-[0_20px_8px]">
          <div className={sectionHeaderClass}>Networks</div>
          <div className="shrink-0 font-mono text-[10.5px] leading-none text-muted-foreground">
            {groups.length} combined · {download.chunks.length} streams
            {networksStatusLabel ? ` · ${networksStatusLabel}` : ''}
          </div>
        </div>
        <div
          className="grid gap-x-3 px-5"
          style={{ gridTemplateColumns: NETWORK_ROW_GRID_COLUMNS }}
        >
          <div className="col-span-full grid grid-cols-subgrid gap-x-3 border-b border-border pt-2.5 pb-[7px] font-mono text-[9.5px] leading-none tracking-[0.12em] text-muted-foreground uppercase">
            <div />
            <div>Network</div>
            <div>Progress</div>
            <div className="text-right">Share</div>
            <div className="text-right">Speed</div>
            <div className="text-right">Downloaded</div>
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

      <div className="flex items-center gap-3 border-t-[0.5px] border-t-[var(--footer-border)] bg-secondary px-5 py-[11px]">
        <div className="flex min-w-0 flex-1 items-center gap-[7px] overflow-hidden font-mono text-[11px] leading-[1.4] text-muted-foreground">
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="shrink-0 whitespace-nowrap">
                  Saving to {toDisplayPath(dirnameOf(download.destinationPath), homeDir)}
                </span>
              }
            />
            <TooltipContent>Saving to: {download.destinationPath}</TooltipContent>
          </Tooltip>
          <Dot shrink />
          <span className="shrink-0">Resumable</span>
          {totalRetries > 0 && (
            <>
              <Dot shrink />
              <span className="shrink-0 text-[var(--color-usb)]">
                {totalRetries} {totalRetries === 1 ? 'retry' : 'retries'}
              </span>
            </>
          )}
        </div>
        <Tooltip open={isAssembling ? undefined : false}>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant={isPaused ? 'default' : 'secondary'}
                onClick={handlePauseResume}
                disabled={isAssembling || resuming}
              >
                {pauseResumeLabel}
              </Button>
            }
          />
          <TooltipContent>Can&apos;t pause while assembling the file</TooltipContent>
        </Tooltip>
        <Tooltip open={isAssembling ? undefined : false}>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="destructive"
                onClick={handleCancel}
                disabled={isAssembling}
              >
                Cancel
              </Button>
            }
          />
          <TooltipContent>Can&apos;t cancel while assembling the file</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
