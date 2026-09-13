import type { BlockState } from '@shared/types'
import { FONT_MONO, type NetworkVisual } from '../theme'
import { formatBytes, type NetworkGroup } from '../utils/format'

interface BlockGridProps {
  blocks?: BlockState[]
  groups: NetworkGroup[]
  visuals: NetworkVisual[]
  knownSize: boolean
  remainingBytes: number
  isPaused?: boolean
  blockSizeBytes?: number
}

export function BlockGrid({
  blocks,
  groups,
  visuals,
  knownSize,
  remainingBytes,
  isPaused = false,
  blockSizeBytes
}: BlockGridProps): React.JSX.Element {
  // If we have 2D blocks from range splitting, render the rich 2D Block Matrix
  if (blocks && blocks.length > 1) {
    const visualByInterfaceId = new Map<string, NetworkVisual>()
    groups.forEach((g, idx) => {
      if (visuals[idx]) {
        visualByInterfaceId.set(g.interfaceId, visuals[idx])
      }
    })

    const effectiveBlockSize =
      blockSizeBytes ||
      (blocks[0]?.rangeEnd !== null ? blocks[0].rangeEnd - blocks[0].rangeStart + 1 : 0)

    // 32 columns yields a clean 2-row grid for ~64 blocks
    const cols = blocks.length <= 32 ? blocks.length : Math.ceil(blocks.length / 2)

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
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gap: 3,
            width: '100%'
          }}
        >
          {blocks.map((block) => {
            const visual = block.interfaceId
              ? visualByInterfaceId.get(block.interfaceId)
              : undefined
            const blockSize =
              block.rangeEnd !== null ? block.rangeEnd - block.rangeStart + 1 : effectiveBlockSize

            let bg = 'rgba(255, 255, 255, 0.05)'
            let border = '0.5px solid rgba(255, 255, 255, 0.08)'
            let boxShadow = 'none'
            let opacity = 1

            if (block.status === 'completed') {
              bg = visual?.solid || 'var(--color-wifi)'
              border = 'none'
              opacity = 0.92
            } else if (block.status === 'downloading') {
              bg = visual?.bg || 'var(--color-accent-bg)'
              border = `1px solid ${visual?.solid || 'var(--color-accent)'}`
              boxShadow = isPaused ? 'none' : `0 0 7px ${visual?.solid || 'var(--color-accent)'}`
              opacity = isPaused ? 0.6 : 1
            } else if (block.status === 'error') {
              bg = 'var(--color-danger)'
              border = 'none'
            }

            const networkName = visual?.name || (block.interfaceId ? 'Assigned' : 'Pending')
            const title = `Block #${block.index + 1} (${formatBytes(blockSize)}) · ${networkName} · ${block.status}`

            return (
              <div
                key={block.index}
                title={title}
                style={{
                  height: 13,
                  borderRadius: 2.5,
                  background: bg,
                  border,
                  boxShadow,
                  opacity,
                  transition: 'background 0.15s, opacity 0.15s, box-shadow 0.15s'
                }}
              />
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
