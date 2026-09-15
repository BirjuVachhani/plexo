import type { BlockState, BlockStatus } from '@shared/types'
import { useCallback, useRef, useState } from 'react'
import { FONT_MONO, type NetworkVisual } from '../theme'
import { formatBytes, type NetworkGroup } from '../utils/format'

// The grid is a byte-space map of the file: cells run left-to-right, top-to-bottom, and each
// is colored by the network that downloaded most of it.
//
// Vocabulary, kept consistent with the streams table: a *chunk* is one real 8 MB unit the
// downloader actually fetches (what NetworkRow labels "Chunk #N"), and a *block* is one grid
// square, which normalizes a fixed number of consecutive chunks into a single cell. The
// legend states that ratio and every cell's tooltip names the exact chunk range it covers,
// so the two views can be read against each other.
//
// How many blocks there are is itself information — more blocks means a bigger file — so the
// count is derived from the file's size alone and never from the window's. Resizing only
// changes how those blocks wrap into rows, the same way a paragraph rewraps without gaining
// or losing words. Chunks are a fixed 8 MB, so their count is already proportional to file
// size; grouping a fixed number of them per block preserves that proportionality.
const CHUNKS_PER_BLOCK = 8 // ~64 MB of file per grid square
const MIN_CELLS = 8
const MAX_CELLS = 256

const TARGET_CELL_PX = 12
const CELL_GAP_PX = 3
const CELL_HEIGHT_PX = 13
const MIN_COLS = 8
const MAX_ROWS = 6

interface DisplayCell {
  status: BlockStatus
  interfaceId?: string
  fillRatio: number
  totalBytes: number
  bytesDownloaded: number
  /** 1-based, inclusive chunk numbers this block covers — matches the "Chunk #N" badges
   * in the streams table, so a hovered block points back at a specific stream's work. */
  firstChunk: number
  lastChunk: number
}

/** Aggregates chunks into exactly `cellCount` contiguous blocks, sizes differing by at most one. */
function bucketBlocks(blocks: BlockState[], cellCount: number): DisplayCell[] {
  const cells: DisplayCell[] = []

  for (let i = 0; i < cellCount; i++) {
    const groupStart = Math.floor((i * blocks.length) / cellCount)
    const groupEnd = Math.floor(((i + 1) * blocks.length) / cellCount)

    let totalBytes = 0
    let bytesDownloaded = 0
    let hasError = false
    let hasDownloading = false
    let allCompleted = true
    const bytesByInterface = new Map<string, number>()

    for (let j = groupStart; j < groupEnd; j++) {
      const block = blocks[j]
      totalBytes += block.rangeEnd !== null ? block.rangeEnd - block.rangeStart + 1 : 0
      bytesDownloaded += block.bytesDownloaded
      if (block.status === 'error') hasError = true
      if (block.status === 'downloading') hasDownloading = true
      if (block.status !== 'completed') allCompleted = false
      if (block.interfaceId) {
        bytesByInterface.set(
          block.interfaceId,
          (bytesByInterface.get(block.interfaceId) || 0) + block.bytesDownloaded
        )
      }
    }

    let dominantInterfaceId: string | undefined
    let dominantBytes = -1
    for (const [interfaceId, bytes] of bytesByInterface) {
      if (bytes > dominantBytes) {
        dominantBytes = bytes
        dominantInterfaceId = interfaceId
      }
    }

    cells.push({
      status: allCompleted
        ? 'completed'
        : hasError
          ? 'error'
          : hasDownloading
            ? 'downloading'
            : 'pending',
      interfaceId: dominantInterfaceId,
      fillRatio: totalBytes > 0 ? bytesDownloaded / totalBytes : 0,
      totalBytes,
      bytesDownloaded,
      firstChunk: groupStart + 1,
      lastChunk: groupEnd
    })
  }

  return cells
}

interface BlockGridProps {
  blocks?: BlockState[]
  groups: NetworkGroup[]
  visuals: NetworkVisual[]
  knownSize: boolean
  remainingBytes: number
  isPaused?: boolean
}

export function BlockGrid({
  blocks,
  groups,
  visuals,
  knownSize,
  remainingBytes,
  isPaused = false
}: BlockGridProps): React.JSX.Element {
  const [gridWidth, setGridWidth] = useState(0)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)

  // A callback ref rather than useEffect: the measured node only exists on the grid branch
  // below, so this has to re-observe whenever that node mounts or unmounts.
  const measureGrid = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    if (!node) return
    const observer = new ResizeObserver((entries) => {
      setGridWidth(entries[0]?.contentRect.width ?? 0)
    })
    observer.observe(node)
    observerRef.current = observer
  }, [])

  if (blocks && blocks.length > 1) {
    const visualByInterfaceId = new Map<string, NetworkVisual>()
    groups.forEach((g, idx) => {
      if (visuals[idx]) {
        visualByInterfaceId.set(g.interfaceId, visuals[idx])
      }
    })

    const cellCount = Math.min(
      blocks.length,
      Math.max(MIN_CELLS, Math.min(MAX_CELLS, Math.ceil(blocks.length / CHUNKS_PER_BLOCK)))
    )
    const fittedCols = Math.floor((gridWidth + CELL_GAP_PX) / (TARGET_CELL_PX + CELL_GAP_PX))
    // A narrow window must not wrap into an unbounded stack of rows — past MAX_ROWS the cells
    // shrink below their target width instead of adding another row.
    const minColsForRowCap = Math.ceil(cellCount / MAX_ROWS)
    const cols = Math.min(cellCount, Math.max(MIN_COLS, fittedCols, minColsForRowCap))
    const cells = gridWidth > 0 ? bucketBlocks(blocks, cellCount) : []
    const chunkBytes =
      blocks[0].rangeEnd !== null ? blocks[0].rangeEnd - blocks[0].rangeStart + 1 : 0
    const chunksPerBlock = cells.length > 0 ? Math.round(blocks.length / cells.length) : 0

    // Hovering reads out into the legend line rather than a native `title` tooltip: the grid
    // re-renders on every progress push, which resets Chromium's tooltip timer so it never
    // appears on an active block — and a tooltip advertises nothing to hover in the first place.
    const hoveredCell = hoveredIndex !== null ? cells[hoveredIndex] : undefined
    let readout: string
    if (hoveredCell) {
      const hoveredVisual = hoveredCell.interfaceId
        ? visualByInterfaceId.get(hoveredCell.interfaceId)
        : undefined
      const range =
        hoveredCell.firstChunk === hoveredCell.lastChunk
          ? `Chunk #${hoveredCell.firstChunk}`
          : `Chunks #${hoveredCell.firstChunk}–${hoveredCell.lastChunk}`
      const where = hoveredVisual?.name ?? (hoveredCell.status === 'pending' ? 'queued' : '—')
      readout = `${range} · ${formatBytes(hoveredCell.bytesDownloaded)} / ${formatBytes(hoveredCell.totalBytes)} · ${where}`
    } else if (chunksPerBlock > 1) {
      // Group sizes differ by one when the chunk count doesn't divide evenly, so don't state
      // a ratio as exact when it is only the average.
      const approx = blocks.length % cells.length === 0 ? '' : '~'
      readout = `${cells.length} blocks · ${approx}${chunksPerBlock} × ${formatBytes(chunkBytes)} chunks`
    } else {
      readout = `${cells.length} blocks · ${formatBytes(chunkBytes)} each`
    }

    return (
      <div
        style={{
          background: 'var(--bg-secondary)',
          border: '0.5px solid var(--border)',
          borderRadius: 9,
          padding: '10px 14px 11px',
          display: 'flex',
          flexDirection: 'column',
          gap: 9
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            flexWrap: 'wrap'
          }}
        >
          {groups.map((group, idx) => {
            const visual = visuals[idx]
            return (
              <div
                key={group.interfaceId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5.5,
                  font: `500 10.5px/1 ${FONT_MONO}`,
                  color: 'var(--text-secondary)'
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: visual.solid,
                    flexShrink: 0
                  }}
                />
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>{visual.name}</span>
              </div>
            )
          })}
          {cells.length > 0 && chunkBytes > 0 && (
            <div
              style={{
                marginLeft: 'auto',
                font: `500 10px/1 ${FONT_MONO}`,
                color: 'var(--text-tertiary)',
                fontVariantNumeric: 'tabular-nums'
              }}
              title={
                chunksPerBlock > 1
                  ? `This file downloads as ${blocks.length} chunks of ${formatBytes(chunkBytes)}. Each square groups ${chunksPerBlock} of them so the grid stays readable.`
                  : `This file downloads as ${blocks.length} chunks of ${formatBytes(chunkBytes)}, one per square.`
              }
            >
              {readout}
            </div>
          )}
        </div>

        <div
          ref={measureGrid}
          onMouseLeave={() => setHoveredIndex(null)}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gap: CELL_GAP_PX,
            width: '100%',
            minHeight: CELL_HEIGHT_PX
          }}
        >
          {cells.map((cell, index) => {
            const visual = cell.interfaceId ? visualByInterfaceId.get(cell.interfaceId) : undefined

            // Base track uses theme-aware tokens (not hardcoded white-based rgba) so a
            // mostly-pending bucket stays visible in light theme, not just dark.
            let background = 'var(--track-bg)'
            let border = '0.5px solid var(--border-strong)'
            let boxShadow = 'none'
            let opacity = 1
            let fillColor = visual?.solid || 'var(--color-accent)'

            if (cell.status === 'downloading') {
              background = visual?.bg || 'var(--color-accent-bg)'
              border = `1px solid ${visual?.solid || 'var(--color-accent)'}`
              boxShadow = isPaused ? 'none' : `0 0 7px ${visual?.solid || 'var(--color-accent)'}`
              opacity = isPaused ? 0.6 : 1
            } else if (cell.status === 'error') {
              fillColor = 'var(--color-danger)'
              border = 'none'
            } else if (cell.status === 'completed') {
              border = 'none'
              opacity = 0.92
            }

            const networkName = visual?.name || (cell.interfaceId ? 'Assigned' : 'Pending')
            // Named by chunk range rather than cell index, so a hovered square maps onto the
            // "Chunk #N" badges the streams table shows for each active connection.
            const chunkLabel =
              cell.firstChunk === cell.lastChunk
                ? `Chunk #${cell.firstChunk}`
                : `Chunks #${cell.firstChunk}–${cell.lastChunk}`
            const title = `${chunkLabel} · ${formatBytes(cell.bytesDownloaded)} / ${formatBytes(cell.totalBytes)} · ${networkName} · ${cell.status}`
            const rawFillPercent = Math.min(1, Math.max(0, cell.fillRatio)) * 100
            // A cell aggregates several real blocks, so early progress within it can be a
            // fraction of a percent — floor it to a visible sliver rather than 0 width.
            const fillPercent = rawFillPercent > 0 ? Math.max(6, Math.round(rawFillPercent)) : 0

            return (
              <div
                key={index}
                title={title}
                onMouseEnter={() => setHoveredIndex(index)}
                style={{
                  position: 'relative',
                  height: CELL_HEIGHT_PX,
                  borderRadius: 2.5,
                  background,
                  border,
                  boxShadow,
                  opacity,
                  outline: hoveredIndex === index ? '1.5px solid var(--text-secondary)' : 'none',
                  outlineOffset: 1,
                  overflow: 'hidden',
                  transition: 'opacity 0.15s, box-shadow 0.15s'
                }}
              >
                {fillPercent > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: `${fillPercent}%`,
                      background: fillColor,
                      transition: 'width 0.15s, background 0.15s'
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // Fallback for single stream / non-splittable download: clean horizontal bar
  return (
    <div
      style={{
        height: 10,
        borderRadius: 5,
        background: 'var(--track-bg)',
        overflow: 'hidden',
        display: 'flex',
        gap: 2,
        border: '0.5px solid var(--border-strong)'
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
  )
}
