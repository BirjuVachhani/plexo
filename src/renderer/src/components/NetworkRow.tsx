import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import type { BlockState } from '@shared/types'
import {
  DANGER,
  NETWORK_ROW_GRID_COLUMNS,
  resolveNetworkVisual,
  type NetworkColorId
} from '../theme'
import type { NetworkGroup } from '../utils/format'
import { formatBytes, formatSpeed } from '../utils/format'
import { ColorBadge } from './ColorBadge'
import { NetworkEditorFields } from './NetworkEditorFields'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

interface NetworkRowProps {
  group: NetworkGroup
  sharePercent: number
  totalBytes?: number | null
  totalDownloaded?: number
  blocks?: BlockState[]
}

export function NetworkRow({
  group,
  sharePercent,
  totalBytes,
  blocks
}: NetworkRowProps): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const preference = useAppStore((store) => store.networkPreferences[group.interfaceId])
  const setNetworkPreference = useAppStore((store) => store.setNetworkPreference)
  const visual = resolveNetworkVisual(group.interfaceKind, group.interfaceLabel, preference)
  const hasError = group.chunks.some((chunk) => chunk.status === 'error')
  const isActive = group.chunks.some((chunk) => chunk.status === 'downloading')

  const groupShareDisplay =
    group.bytesDownloaded === 0
      ? '0%'
      : Math.round(sharePercent) === 0 && sharePercent > 0
        ? '<1%'
        : `${Math.round(sharePercent)}%`

  return (
    // A subgrid, not its own independent grid — it inherits the exact column tracks the parent
    // grid (DownloadingScreen's networks table, using the same NETWORK_ROW_GRID_COLUMNS) computed
    // for the header and every other row, rather than recomputing its own and hoping they match.
    <div className="col-span-full grid grid-cols-subgrid items-center gap-3 border-t-[0.5px] border-[var(--border-subtle)] py-[11px]">
      <div
        className="size-2 rounded-full"
        style={{
          background: hasError ? DANGER : visual.solid,
          animation: isActive ? 'plexo-glow 1.8s infinite' : undefined,
          opacity: isActive || hasError ? 1 : 0.65
        }}
      />
      <div className="flex min-w-0 items-center gap-[6px]">
        <span
          className="truncate font-sans text-[12.5px] leading-[1.2] font-semibold text-foreground"
          title={visual.name}
        >
          {visual.name}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Collapse streams' : 'Expand streams'}
          aria-expanded={expanded}
          className={`inline-flex min-h-6 shrink-0 cursor-pointer items-center gap-[3px] rounded-[4px] border-[0.5px] border-border px-1.5 py-0.5 font-mono text-[10px] leading-none font-medium select-none ${
            expanded ? 'bg-secondary text-foreground' : 'bg-card text-[var(--text-secondary)]'
          }`}
        >
          <span>{group.chunks.length} streams</span>
          <span className="text-[7.5px] opacity-75">{expanded ? '▲' : '▼'}</span>
        </button>
        <Popover open={editing} onOpenChange={setEditing}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                title="Rename or recolor this network"
                aria-label="Rename or recolor this network"
                className="shrink-0 font-sans text-xs font-bold text-muted-foreground"
              >
                ⋯
              </Button>
            }
          />
          <PopoverContent className="w-[276px]">
            <NetworkEditorFields
              name={preference?.customName ?? ''}
              onNameChange={(customName) => setNetworkPreference(group.interfaceId, { customName })}
              namePlaceholder={group.interfaceLabel}
              colorId={preference?.colorId as NetworkColorId | undefined}
              onColorSelect={(colorId) => setNetworkPreference(group.interfaceId, { colorId })}
              interfaceKind={group.interfaceKind}
              onDone={() => setEditing(false)}
            />
          </PopoverContent>
        </Popover>
      </div>
      <div className="flex min-w-0 items-center">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full border-[0.5px] border-[var(--border-strong)] bg-[var(--track-bg)]">
          <div
            className="h-full rounded-full transition-[width] duration-[250ms] ease-out"
            style={{
              width:
                totalBytes && totalBytes > 0
                  ? `${Math.min(100, Math.max(0, (group.bytesDownloaded / totalBytes) * 100))}%`
                  : '0%',
              background: visual.solid
            }}
          />
        </div>
      </div>
      <div
        className="text-right font-mono text-[11.5px] leading-none font-medium tabular-nums"
        style={{ color: sharePercent > 0 ? 'var(--text)' : 'var(--text-tertiary)' }}
      >
        {groupShareDisplay}
      </div>
      <div
        className="text-right font-mono text-[12.5px] leading-none font-semibold tabular-nums"
        style={{ color: isActive ? visual.text : 'var(--text-tertiary)' }}
      >
        {isActive ? formatSpeed(group.speedBytesPerSec) : '—'}
      </div>
      <div className="text-right font-mono text-[11.5px] leading-none text-[var(--text-secondary)] tabular-nums">
        {formatBytes(group.bytesDownloaded)}
      </div>
      {expanded && group.chunks.length > 0 && (
        <div className="col-span-full flex flex-col gap-1.5 border-y-[0.5px] border-[var(--border-subtle)] bg-card px-5 pt-1.5 pb-2.5">
          {group.chunks.map((chunk, index) => {
            const isChunkActive = chunk.status === 'downloading'
            const isChunkDone = chunk.status === 'completed'
            const isChunkError = chunk.status === 'error'

            const currentBlock =
              blocks && blocks.length > 0
                ? ((chunk.currentBlockIndex != null
                    ? blocks[chunk.currentBlockIndex]
                    : undefined) ?? blocks.find((b) => b.rangeStart === chunk.rangeStart))
                : undefined

            const chunkSize = currentBlock
              ? currentBlock.rangeEnd !== null
                ? currentBlock.rangeEnd - currentBlock.rangeStart + 1
                : 0
              : chunk.rangeEnd !== null
                ? chunk.rangeEnd - chunk.rangeStart + 1
                : totalBytes
                  ? totalBytes - chunk.rangeStart
                  : 0

            const chunkBytesDownloaded = currentBlock
              ? currentBlock.bytesDownloaded
              : isChunkDone && chunkSize > 0
                ? chunkSize
                : chunk.bytesDownloaded

            const chunkPercent =
              chunkSize > 0
                ? Math.min(100, Math.max(0, (chunkBytesDownloaded / chunkSize) * 100))
                : 0

            const isCurrentBlockDone =
              currentBlock?.status === 'completed' ||
              isChunkDone ||
              (chunkSize > 0 && chunkPercent >= 100)

            return (
              <div
                key={chunk.id}
                className="grid items-center gap-3 py-[3px] font-mono text-[11px] leading-[1.2]"
                style={{ gridTemplateColumns: NETWORK_ROW_GRID_COLUMNS }}
              >
                <div className="flex justify-center">
                  <div
                    className="size-[5px] rounded-full"
                    style={{
                      background: isChunkError
                        ? DANGER
                        : isCurrentBlockDone
                          ? visual.solid
                          : isChunkActive
                            ? visual.solid
                            : 'var(--icon-muted)',
                      opacity: isChunkActive || isCurrentBlockDone ? 1 : 0.4
                    }}
                  />
                </div>

                <div className="flex min-w-0 items-center gap-[6px]">
                  <span className="font-medium whitespace-nowrap text-foreground">
                    Stream #{index + 1}
                  </span>
                  {currentBlock && (
                    <span
                      className="rounded-[3px] border-[0.5px] border-border bg-secondary px-[4.5px] py-[1.5px] font-mono text-[9px] leading-none whitespace-nowrap text-muted-foreground"
                      title={`Range: ${currentBlock.rangeStart} – ${currentBlock.rangeEnd ?? 'end'}`}
                    >
                      Chunk #{currentBlock.index + 1}
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
                  ) : isCurrentBlockDone ? (
                    <span className="text-[9.5px] text-muted-foreground">Done</span>
                  ) : chunk.status === 'paused' ? (
                    <span className="text-[9.5px] text-muted-foreground">Paused</span>
                  ) : chunk.status === 'retrying' ? (
                    <span className="text-[9.5px] text-destructive">Retrying…</span>
                  ) : (
                    <span className="text-[9.5px] text-muted-foreground">Waiting</span>
                  )}
                </div>

                <div className="flex min-w-0 items-center">
                  <div
                    className="h-[5px] flex-1 overflow-hidden rounded-full border-[0.5px] border-[var(--border-strong)] bg-[var(--track-bg)]"
                    title={
                      chunkSize > 0
                        ? `Chunk progress: ${formatBytes(chunkBytesDownloaded)} of ${formatBytes(chunkSize)} (${Math.round(chunkPercent)}%)`
                        : undefined
                    }
                  >
                    <div
                      className="h-full rounded-full transition-[width] duration-200 ease-out"
                      style={{
                        width: isCurrentBlockDone ? '100%' : `${chunkPercent}%`,
                        background: isChunkError ? DANGER : visual.solid
                      }}
                    />
                  </div>
                </div>

                <div
                  className="text-right font-mono text-[11px] leading-none font-medium tabular-nums"
                  style={{
                    color: isCurrentBlockDone
                      ? visual.text
                      : isChunkActive
                        ? 'var(--text)'
                        : 'var(--text-tertiary)'
                  }}
                >
                  {Math.round(chunkPercent)}%
                </div>

                <div
                  className="text-right font-mono text-[11px] leading-none font-medium tabular-nums"
                  style={{ color: isChunkActive ? visual.text : 'var(--text-tertiary)' }}
                >
                  {isChunkActive ? formatSpeed(chunk.speedBytesPerSec) : '—'}
                </div>

                <div
                  className="text-right font-mono text-[11px] leading-none whitespace-nowrap text-[var(--text-secondary)] tabular-nums"
                  title={
                    chunkSize > 0
                      ? `${formatBytes(chunkBytesDownloaded)} of ${formatBytes(chunkSize)}`
                      : formatBytes(chunkBytesDownloaded)
                  }
                >
                  {chunkSize > 0
                    ? `${formatBytes(chunkBytesDownloaded)} / ${formatBytes(chunkSize)}`
                    : formatBytes(chunkBytesDownloaded)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
