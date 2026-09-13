import type { ChunkStatus } from '@shared/types'
import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
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

/** A chunk still filling in fades up from a floor opacity rather than snapping straight to
 * full color, so its own progress reads at a glance within the network's mini chunk bar. */
function chunkOpacity(percent: number, status: ChunkStatus): number {
  if (status === 'completed') return 1
  if (status === 'pending') return 0.16
  return Math.max(0.3, Math.min(1, percent / 100))
}

export function NetworkRow({
  group,
  totalBytes,
  sharePercent,
  latencyMs
}: {
  group: NetworkGroup
  totalBytes: number
  sharePercent: number
  latencyMs?: number | null
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const preference = useAppStore((store) => store.networkPreferences[group.interfaceId])
  const setNetworkPreference = useAppStore((store) => store.setNetworkPreference)
  const visual = resolveNetworkVisual(group.interfaceKind, group.interfaceLabel, preference)
  const hasError = group.chunks.some((chunk) => chunk.status === 'error')
  const isActive = group.chunks.some((chunk) => chunk.status === 'downloading')

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: NETWORK_ROW_GRID_COLUMNS,
          gap: 14,
          alignItems: 'center',
          padding: '11px 20px',
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
            opacity: isActive || hasError ? 1 : 0.45
          }}
        />
        <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                font: `600 12.5px/1.3 ${FONT_UI}`,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {visual.name}
            </div>
            <div
              style={{ marginTop: 3, font: `10px/1 ${FONT_MONO}`, color: 'var(--text-tertiary)' }}
            >
              {group.chunks.length} chunk{group.chunks.length === 1 ? '' : 's'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEditing((value) => !value)}
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
        </div>
        <div style={{ display: 'flex', gap: 3, height: 15 }}>
          {group.chunks.map((chunk) => {
            const chunkSize =
              chunk.rangeEnd !== null
                ? chunk.rangeEnd - chunk.rangeStart + 1
                : totalBytes - chunk.rangeStart
            const percent = chunkSize > 0 ? (chunk.bytesDownloaded / chunkSize) * 100 : 0
            return (
              <div
                key={chunk.id}
                style={{
                  flex: 1,
                  borderRadius: 2,
                  background: chunk.status === 'error' ? DANGER : visual.solid,
                  opacity: chunkOpacity(percent, chunk.status)
                }}
              />
            )
          })}
        </div>
        <div
          style={{
            textAlign: 'right',
            font: `500 12px/1 ${FONT_MONO}`,
            color: 'var(--text)',
            fontVariantNumeric: 'tabular-nums'
          }}
        >
          {Math.round(sharePercent)}%
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
        <div
          style={{
            textAlign: 'right',
            font: `11.5px/1 ${FONT_MONO}`,
            color: 'var(--text-tertiary)'
          }}
        >
          {latencyMs != null ? `${latencyMs} ms` : '—'}
        </div>
      </div>
      {editing && (
        <div style={{ padding: '0 20px 11px' }}>
          <NetworkEditorFields
            name={preference?.customName ?? ''}
            onNameChange={(customName) => setNetworkPreference(group.interfaceId, { customName })}
            namePlaceholder={group.interfaceLabel}
            colorId={preference?.colorId as NetworkColorId | undefined}
            onColorSelect={(colorId) => setNetworkPreference(group.interfaceId, { colorId })}
            onDone={() => setEditing(false)}
          />
        </div>
      )}
    </div>
  )
}
