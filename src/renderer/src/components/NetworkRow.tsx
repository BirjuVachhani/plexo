import type { BlockState, ChunkState } from '@shared/types'
import { useState } from 'react'
import { useNetworkVisuals } from '../hooks/useNetworkVisuals'
import { DANGER } from '../theme'
import type { NetworkGroup } from '../utils/format'
import { formatBytes, formatSpeed } from '../utils/format'
import { ColorBadge } from './ColorBadge'
import { NetworkEditPopover } from './NetworkEditPopover'
import { TruncatedText } from './TruncatedText'
import { Button } from './ui/button'

interface NetworkRowProps {
  group: NetworkGroup
  sharePercent: number
  totalBytes?: number | null
  blocks?: BlockState[]
}

// Every row — this one and each expanded stream row — is a direct col-span-full subgrid child of
// DownloadingScreen's networks grid, so all rows share one set of column tracks instead of each
// re-deriving its own and hoping they line up. The grid's side gutters live *inside* its first and
// last tracks (see NETWORK_ROW_GRID_COLUMNS), which is what lets a row's divider and fill be a
// plain border/background on the row itself: its box already reaches both window edges.
const rowClass = 'col-span-full grid grid-cols-subgrid items-center gap-3'

function ProgressBar({
  percent,
  color,
  label,
  className
}: {
  percent: number
  color: string
  label: string
  className: string
}): React.JSX.Element {
  return (
    <div
      role="cell"
      className={`w-full overflow-hidden rounded-full border-[0.5px] border-[var(--border-strong)] bg-[var(--track-bg)] ${className}`}
    >
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(percent)}
        className="h-full rounded-full transition-[width] duration-200 ease-out"
        style={{ width: `${percent}%`, background: color }}
      />
    </div>
  )
}

/** What an expanded stream row shows: the block that stream is working on right now (falling back
 * to the one starting at its range, for a stream that hasn't claimed a block yet) and how far
 * along that block is. A completed stream reads as full even when no block backs it. */
function describeStream(
  chunk: ChunkState,
  blocks: BlockState[] | undefined,
  totalBytes: number | null | undefined
): {
  block: BlockState | undefined
  size: number
  downloaded: number
  percent: number
  done: boolean
} {
  const block =
    (chunk.currentBlockIndex != null ? blocks?.[chunk.currentBlockIndex] : undefined) ??
    blocks?.find((b) => b.rangeStart === chunk.rangeStart)

  const isDone = chunk.status === 'completed'
  const range = block ?? chunk
  const size =
    range.rangeEnd !== null
      ? range.rangeEnd - range.rangeStart + 1
      : block
        ? 0
        : totalBytes
          ? totalBytes - chunk.rangeStart
          : 0
  const downloaded = block
    ? block.bytesDownloaded
    : isDone && size > 0
      ? size
      : chunk.bytesDownloaded
  const percent = size > 0 ? Math.min(100, Math.max(0, (downloaded / size) * 100)) : 0

  return {
    block,
    size,
    downloaded,
    percent,
    done: block?.status === 'completed' || isDone || percent >= 100
  }
}

export function NetworkRow({
  group,
  sharePercent,
  totalBytes,
  blocks
}: NetworkRowProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const visual = useNetworkVisuals()(group.interfaceId, group.interfaceKind, group.interfaceLabel)
  const hasError = group.chunks.some((chunk) => chunk.status === 'error')
  const isActive = group.chunks.some((chunk) => chunk.status === 'downloading')

  const rounded = Math.round(sharePercent)
  const shareLabel = group.bytesDownloaded === 0 ? '0%' : rounded === 0 ? '<1%' : `${rounded}%`

  return (
    <>
      <div
        role="row"
        className={`${rowClass} border-t-[0.5px] border-[var(--border-subtle)] py-[11px]`}
      >
        <div
          role="cell"
          className="ml-5 size-2 rounded-full"
          style={{
            background: hasError ? DANGER : visual.solid,
            animation: isActive ? 'plexo-glow 1.8s infinite' : undefined,
            opacity: isActive || hasError ? 1 : 0.65
          }}
        />
        <div role="cell" className="flex min-w-0 items-center gap-[6px]">
          <TruncatedText
            text={visual.name}
            className="font-sans text-[12.5px] leading-[1.2] font-semibold text-foreground"
          />
          <NetworkEditPopover
            interfaceId={group.interfaceId}
            interfaceKind={group.interfaceKind}
            osName={group.interfaceLabel}
          />
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="h-auto cursor-pointer rounded-[4px] border-[0.5px] bg-card px-[7px] py-[3px] font-mono text-[10.5px] leading-none font-medium text-[var(--text-secondary)] aria-expanded:bg-secondary dark:bg-card"
          >
            {group.chunks.length} streams
            <span aria-hidden className="text-[7.5px] opacity-75">
              {expanded ? '▲' : '▼'}
            </span>
          </Button>
        </div>
        <ProgressBar
          className="h-1.5"
          label={`${visual.name} progress`}
          percent={
            totalBytes && totalBytes > 0
              ? Math.min(100, (group.bytesDownloaded / totalBytes) * 100)
              : 0
          }
          color={visual.solid}
        />
        <div
          role="cell"
          className="text-right font-mono text-[11.5px] leading-none font-medium tabular-nums"
          style={{ color: sharePercent > 0 ? 'var(--text)' : 'var(--text-tertiary)' }}
        >
          {shareLabel}
        </div>
        <div
          role="cell"
          className="text-right font-mono text-[12.5px] leading-none font-semibold tabular-nums"
          style={{ color: isActive ? visual.text : 'var(--text-tertiary)' }}
        >
          {isActive ? formatSpeed(group.speedBytesPerSec) : '—'}
        </div>
        <div
          role="cell"
          className="pr-5 text-right font-mono text-[11.5px] leading-none text-[var(--text-secondary)] tabular-nums"
        >
          {formatBytes(group.bytesDownloaded)}
        </div>
      </div>

      {expanded &&
        group.chunks.map((chunk, index) => {
          const isFirst = index === 0
          const isLast = index === group.chunks.length - 1
          const isChunkActive = chunk.status === 'downloading'
          const isChunkError = chunk.status === 'error'
          const stream = describeStream(chunk, blocks, totalBytes)
          const statusText = stream.done
            ? 'Done'
            : chunk.status === 'paused'
              ? 'Paused'
              : chunk.status === 'retrying'
                ? 'Retrying…'
                : 'Waiting'

          return (
            <div
              role="row"
              key={chunk.id}
              className={`${rowClass} border-[var(--border-subtle)] bg-card py-[6px] font-mono text-[11px] leading-[1.2] ${
                isFirst ? 'border-t-[0.5px] pt-[9px]' : ''
              } ${isLast ? 'border-b-[0.5px] pb-[11px]' : ''}`}
            >
              <div role="cell" className="flex justify-center pl-5">
                <div
                  className="size-[5px] rounded-full"
                  style={{
                    background: isChunkError
                      ? DANGER
                      : isChunkActive || stream.done
                        ? visual.solid
                        : 'var(--icon-muted)',
                    opacity: isChunkActive || stream.done ? 1 : 0.4
                  }}
                />
              </div>

              <div role="cell" className="flex min-w-0 items-center gap-[6px]">
                <span className="font-medium whitespace-nowrap text-foreground">
                  Stream #{index + 1}
                </span>
                {stream.block && (
                  <span className="rounded-[3px] border-[0.5px] border-border bg-secondary px-[4.5px] py-[1.5px] font-mono text-[9px] leading-none whitespace-nowrap text-muted-foreground">
                    Chunk #{stream.block.index + 1}
                  </span>
                )}
                {isChunkActive ? (
                  <ColorBadge
                    bg={visual.bg}
                    border={visual.border}
                    text={visual.text}
                    className="h-auto rounded-[3px] px-[5px] py-px text-[9px] font-semibold tracking-[0.04em]"
                  >
                    ACTIVE
                  </ColorBadge>
                ) : (
                  <span
                    className={`text-[9.5px] ${
                      chunk.status === 'retrying' ? 'text-destructive' : 'text-muted-foreground'
                    }`}
                  >
                    {statusText}
                  </span>
                )}
              </div>

              <ProgressBar
                className="h-[5px]"
                label={`Stream #${index + 1} progress`}
                percent={stream.done ? 100 : stream.percent}
                color={isChunkError ? DANGER : visual.solid}
              />

              <div
                role="cell"
                className="text-right font-mono text-[11px] leading-none font-medium tabular-nums"
                style={{
                  color: stream.done
                    ? visual.text
                    : isChunkActive
                      ? 'var(--text)'
                      : 'var(--text-tertiary)'
                }}
              >
                {Math.round(stream.percent)}%
              </div>

              <div
                role="cell"
                className="text-right font-mono text-[11px] leading-none font-medium tabular-nums"
                style={{ color: isChunkActive ? visual.text : 'var(--text-tertiary)' }}
              >
                {isChunkActive ? formatSpeed(chunk.speedBytesPerSec) : '—'}
              </div>

              <div
                role="cell"
                className="pr-5 text-right font-mono text-[11px] leading-none whitespace-nowrap text-[var(--text-secondary)] tabular-nums"
              >
                {stream.size > 0
                  ? `${formatBytes(stream.downloaded)} / ${formatBytes(stream.size)}`
                  : formatBytes(stream.downloaded)}
              </div>
            </div>
          )
        })}
    </>
  )
}
