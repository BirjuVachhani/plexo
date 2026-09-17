import { useState } from 'react'
import type { DownloadState } from '@shared/types'
import { CyclableChip } from '../components/CyclableChip'
import { ThroughputChart } from '../components/ThroughputChart'
import { Button } from '../components/ui/button'
import { useAppStore } from '../store/useAppStore'
import { resolveNetworkVisual } from '../theme'
import {
  dirnameOf,
  formatBytes,
  formatDuration,
  formatSpeed,
  groupChunksByInterface,
  toDisplayPath
} from '../utils/format'

const heroClass = 'border-b border-b-[var(--hero-border)] bg-[image:var(--hero-bg)] px-5 py-[18px]'
const sectionHeaderClass =
  'font-mono text-[10px] leading-none tracking-[0.16em] text-muted-foreground uppercase'

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
  // What actually got stitched together at reassembly time is the block count, not the number of
  // parallel connections — "chunks" in this app's own vocabulary (see BlockGrid) means the byte
  // range unit, so this footer's number needs to match that, not `download.chunks.length`.
  const totalChunkCount = download.totalBlocks ?? download.blocks?.length ?? 1

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
    <div className="flex h-full flex-col bg-background">
      <div className={`${heroClass} text-foreground`}>
        <div className="flex items-center gap-[18px]">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full border border-[var(--color-wifi-border)] bg-[var(--color-wifi-bg)]">
            <svg viewBox="0 0 24 24" className="size-[21px]" aria-hidden="true">
              <path
                d="M5,13 L10,18 L19,7"
                fill="none"
                stroke="var(--color-wifi)"
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-sans text-[16px] leading-[1.2] font-bold">
              {download.fileName}
            </div>
            <div className="mt-[5px] truncate font-mono text-[11.5px] leading-[1.3] text-muted-foreground">
              {formatBytes(finalSize)} ·{' '}
              {toDisplayPath(dirnameOf(download.destinationPath), homeDir)}
            </div>
          </div>
          <div className="flex flex-col items-end gap-[5px]">
            <div className="font-mono text-[9px] leading-none font-medium tracking-[0.16em] text-muted-foreground">
              AVERAGE
            </div>
            <div className="flex items-baseline gap-1.5">
              <div className="font-mono text-[26px] leading-[0.9] font-semibold tracking-[-0.02em] tabular-nums text-foreground">
                {formatSpeed(avgSpeed).split(' ')[0]}
              </div>
              <div className="font-mono text-[11px] leading-none font-medium text-muted-foreground">
                MB/s
              </div>
            </div>
            {activeChipOption && (
              <CyclableChip
                label={activeChipOption.label}
                tooltip={`${activeChipOption.tooltip} (click to toggle)`}
                bg="var(--color-usb-bg)"
                border="var(--color-usb-border)"
                color="var(--color-usb-text)"
                cyclable
                onClick={() => setChipModeIndex((i) => (i + 1) % chipOptions.length)}
              />
            )}
          </div>
        </div>
      </div>

      <div className="mx-5 my-[18px] grid grid-cols-5 overflow-hidden rounded-[10px] border-[0.5px] border-border bg-card">
        {[
          { label: 'Size', value: formatBytes(finalSize) },
          { label: 'Time', value: formatDuration(elapsedSeconds) },
          { label: 'Peak', value: formatSpeed(peakSpeedBytesPerSec) },
          { label: 'Networks', value: String(groups.length) },
          { label: 'Streams', value: String(download.chunks.length) }
        ].map((stat, index) => (
          <div
            key={stat.label}
            className={`flex flex-col gap-[5px] p-[11px_14px] ${
              index > 0 ? 'border-l-[0.5px] border-border' : ''
            }`}
          >
            <div className="font-mono text-[9px] leading-none font-medium tracking-[0.14em] text-muted-foreground uppercase">
              {stat.label}
            </div>
            <div className="font-mono text-[14px] leading-none font-medium tabular-nums">
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      <div className="mx-5 mb-4 flex flex-col gap-2">
        <div className={sectionHeaderClass}>Speed over the download</div>
        <ThroughputChart
          order={groups.map((g, i) => ({ interfaceId: g.interfaceId, solid: visuals[i].solid }))}
          historyByInterface={speedHistoryByInterface}
        />
      </div>

      <div className="mx-5 mb-5 flex flex-1 flex-col gap-[9px]">
        <div className={sectionHeaderClass}>Contribution by network</div>
        <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted">
          {groups.map((group, index) => (
            <div
              key={group.interfaceId}
              style={{ flex: group.bytesDownloaded || 0.0001, background: visuals[index].solid }}
            />
          ))}
        </div>
        <div className="flex flex-col gap-[9px]">
          {groups.map((group, index) => (
            <div key={group.interfaceId} className="flex items-center gap-[9px]">
              <div
                className="size-[7px] shrink-0 rounded-full"
                style={{ background: visuals[index].solid }}
              />
              <div className="font-sans text-[12px] leading-none font-medium">
                {visuals[index].name}
              </div>
              <div className="flex-1" />
              <div className="font-mono text-[11.5px] leading-none text-[var(--text-secondary)]">
                {formatBytes(group.bytesDownloaded)} ·{' '}
                {Math.round((group.bytesDownloaded / totalWeight) * 100)}%
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 border-t-[0.5px] border-t-[var(--footer-border)] bg-secondary px-5 py-[11px]">
        <div className="shrink-0 font-mono text-[11px] leading-[1.4] whitespace-nowrap text-muted-foreground">
          {`reassembled from ${totalChunkCount} chunks · ${totalRetries} ${
            totalRetries === 1 ? 'retry' : 'retries'
          }`}
        </div>
        <div className="flex-1" />
        <Button type="button" variant="secondary" onClick={onNewDownload}>
          New Download
        </Button>
        <Button type="button" onClick={handleReveal}>
          {window.plexo.platform === 'darwin' ? 'Reveal in Finder' : 'Show in folder'}
        </Button>
      </div>
    </div>
  )
}
