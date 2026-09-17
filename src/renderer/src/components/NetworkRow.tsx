import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import type { BlockState } from '@shared/types'
import {
  DANGER,
  FONT_MONO,
  FONT_UI,
  NETWORK_ROW_GRID_COLUMNS,
  resolveNetworkVisual,
  type NetworkColorId
} from '../theme'
import type { NetworkGroup } from '../utils/format'
import { formatBytes, formatSpeed } from '../utils/format'
import { NetworkEditorFields } from './NetworkEditorFields'
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
    // (networkTableGridStyle in DownloadingScreen) computed for the header and every other row,
    // rather than recomputing its own from the same column list and hoping they match.
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'subgrid',
        gridColumn: '1 / -1',
        gap: 12,
        alignItems: 'center',
        padding: '11px 0',
        borderTop: '0.5px solid var(--border-subtle)'
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: hasError ? DANGER : visual.solid,
          animation: isActive ? 'plexo-glow 1.8s infinite' : undefined,
          opacity: isActive || hasError ? 1 : 0.65
        }}
      />
      <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            font: `600 12.5px/1.2 ${FONT_UI}`,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            color: 'var(--text)'
          }}
          title={visual.name}
        >
          {visual.name}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Collapse streams' : 'Expand streams'}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            padding: '2px 6px',
            borderRadius: 4,
            background: expanded ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
            border: '0.5px solid var(--border)',
            font: `500 10px/1 ${FONT_MONO}`,
            color: expanded ? 'var(--text)' : 'var(--text-secondary)',
            cursor: 'pointer',
            flexShrink: 0,
            userSelect: 'none',
            lineHeight: 1
          }}
        >
          <span>{group.chunks.length} streams</span>
          <span style={{ fontSize: 7.5, opacity: 0.75 }}>{expanded ? '▲' : '▼'}</span>
        </button>
        <Popover open={editing} onOpenChange={setEditing}>
          <PopoverTrigger
            render={
              <button
                type="button"
                title="Rename or recolor this network"
                style={{
                  border: 'none',
                  background: 'none',
                  color: 'var(--text-tertiary)',
                  font: `700 12px/1 ${FONT_UI}`,
                  cursor: 'pointer',
                  padding: '2px 4px',
                  flexShrink: 0
                }}
              >
                ⋯
              </button>
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
      <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
        <div
          style={{
            flex: 1,
            height: 6,
            borderRadius: 999,
            background: 'var(--track-bg)',
            border: '0.5px solid var(--border-strong)',
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              height: '100%',
              width:
                totalBytes && totalBytes > 0
                  ? `${Math.min(100, Math.max(0, (group.bytesDownloaded / totalBytes) * 100))}%`
                  : '0%',
              background: visual.solid,
              borderRadius: 999,
              transition: 'width 0.25s ease-out'
            }}
          />
        </div>
      </div>
      <div
        style={{
          textAlign: 'right',
          font: `500 11.5px/1 ${FONT_MONO}`,
          color: sharePercent > 0 ? 'var(--text)' : 'var(--text-tertiary)',
          fontVariantNumeric: 'tabular-nums'
        }}
      >
        {groupShareDisplay}
      </div>
      <div
        style={{
          textAlign: 'right',
          font: `600 12.5px/1 ${FONT_MONO}`,
          color: isActive ? visual.text : 'var(--text-tertiary)',
          fontVariantNumeric: 'tabular-nums'
        }}
      >
        {isActive ? formatSpeed(group.speedBytesPerSec) : '—'}
      </div>
      <div
        style={{
          textAlign: 'right',
          font: `11.5px/1 ${FONT_MONO}`,
          color: 'var(--text-secondary)',
          fontVariantNumeric: 'tabular-nums'
        }}
      >
        {formatBytes(group.bytesDownloaded)}
      </div>
      {expanded && group.chunks.length > 0 && (
        <div
          style={{
            gridColumn: '1 / -1',
            padding: '6px 20px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            background: 'var(--bg-secondary)',
            borderTop: '0.5px solid var(--border-subtle)',
            borderBottom: '0.5px solid var(--border-subtle)'
          }}
        >
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
                style={{
                  display: 'grid',
                  gridTemplateColumns: NETWORK_ROW_GRID_COLUMNS,
                  gap: 12,
                  alignItems: 'center',
                  padding: '3px 0',
                  font: `11px/1.2 ${FONT_MONO}`
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <div
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
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

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span
                    style={{
                      color: 'var(--text)',
                      fontWeight: 500,
                      whiteSpace: 'nowrap'
                    }}
                  >
                    Stream #{index + 1}
                  </span>
                  {currentBlock && (
                    <span
                      style={{
                        font: `500 9px/1 ${FONT_MONO}`,
                        color: 'var(--text-tertiary)',
                        background: 'var(--bg-tertiary)',
                        padding: '1.5px 4.5px',
                        borderRadius: 3,
                        border: '0.5px solid var(--border)',
                        whiteSpace: 'nowrap'
                      }}
                      title={`Range: ${currentBlock.rangeStart} – ${currentBlock.rangeEnd ?? 'end'}`}
                    >
                      Chunk #{currentBlock.index + 1}
                    </span>
                  )}
                  {isChunkActive ? (
                    <span
                      style={{
                        padding: '1px 5px',
                        borderRadius: 3,
                        background: visual.bg,
                        border: `0.5px solid ${visual.border}`,
                        color: visual.text,
                        fontSize: '9px',
                        fontWeight: 600,
                        letterSpacing: '0.04em'
                      }}
                    >
                      ACTIVE
                    </span>
                  ) : isCurrentBlockDone ? (
                    <span
                      style={{
                        color: 'var(--text-tertiary)',
                        fontSize: '9.5px'
                      }}
                    >
                      Done
                    </span>
                  ) : chunk.status === 'paused' ? (
                    <span
                      style={{
                        color: 'var(--text-tertiary)',
                        fontSize: '9.5px'
                      }}
                    >
                      Paused
                    </span>
                  ) : chunk.status === 'retrying' ? (
                    <span
                      style={{
                        color: DANGER,
                        fontSize: '9.5px'
                      }}
                    >
                      Retrying…
                    </span>
                  ) : (
                    <span
                      style={{
                        color: 'var(--text-tertiary)',
                        fontSize: '9.5px'
                      }}
                    >
                      Waiting
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                  <div
                    style={{
                      flex: 1,
                      height: 5,
                      borderRadius: 999,
                      background: 'var(--track-bg)',
                      border: '0.5px solid var(--border-strong)',
                      overflow: 'hidden'
                    }}
                    title={
                      chunkSize > 0
                        ? `Chunk progress: ${formatBytes(chunkBytesDownloaded)} of ${formatBytes(chunkSize)} (${Math.round(chunkPercent)}%)`
                        : undefined
                    }
                  >
                    <div
                      style={{
                        height: '100%',
                        width: isCurrentBlockDone ? '100%' : `${chunkPercent}%`,
                        background: isChunkError ? DANGER : visual.solid,
                        borderRadius: 999,
                        transition: 'width 0.2s ease-out'
                      }}
                    />
                  </div>
                </div>

                <div
                  style={{
                    textAlign: 'right',
                    font: `500 11px/1 ${FONT_MONO}`,
                    color: isCurrentBlockDone
                      ? visual.text
                      : isChunkActive
                        ? 'var(--text)'
                        : 'var(--text-tertiary)',
                    fontVariantNumeric: 'tabular-nums'
                  }}
                >
                  {Math.round(chunkPercent)}%
                </div>

                <div
                  style={{
                    textAlign: 'right',
                    font: `500 11px/1 ${FONT_MONO}`,
                    color: isChunkActive ? visual.text : 'var(--text-tertiary)',
                    fontVariantNumeric: 'tabular-nums'
                  }}
                >
                  {isChunkActive ? formatSpeed(chunk.speedBytesPerSec) : '—'}
                </div>

                <div
                  style={{
                    textAlign: 'right',
                    font: `11px/1 ${FONT_MONO}`,
                    color: 'var(--text-secondary)',
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap'
                  }}
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
