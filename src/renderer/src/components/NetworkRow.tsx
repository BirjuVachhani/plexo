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
  const [expanded, setExpanded] = useState(true)
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
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? 'Collapse stream details' : 'Expand stream details'}
              style={{
                marginTop: 3,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                border: 'none',
                background: 'none',
                padding: 0,
                font: `500 10px/1 ${FONT_MONO}`,
                color: 'var(--text-tertiary)',
                cursor: 'pointer'
              }}
            >
              <span>
                {group.chunks.length} parallel stream{group.chunks.length === 1 ? '' : 's'}
              </span>
              <span style={{ fontSize: 8 }}>{expanded ? '▲' : '▼'}</span>
            </button>
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
        <div style={{ display: 'flex', gap: 4, height: 16 }}>
          {group.chunks.map((chunk, index) => {
            const chunkSize =
              chunk.rangeEnd !== null
                ? chunk.rangeEnd - chunk.rangeStart + 1
                : totalBytes - chunk.rangeStart
            const percent =
              chunkSize > 0 ? Math.min(100, (chunk.bytesDownloaded / chunkSize) * 100) : 0
            const isChunkDone = chunk.status === 'completed'
            const isChunkActive = chunk.status === 'downloading'
            const isChunkError = chunk.status === 'error'
            const title = `Stream #${index + 1}: ${Math.round(percent)}% · ${formatBytes(chunk.bytesDownloaded)} / ${formatBytes(chunkSize)}${chunk.speedBytesPerSec > 0 ? ` · ${formatSpeed(chunk.speedBytesPerSec)}` : ''}`

            return (
              <div
                key={chunk.id}
                title={title}
                style={{
                  flex: 1,
                  borderRadius: 3,
                  background: 'var(--track-bg)',
                  border: '0.5px solid var(--border-strong)',
                  overflow: 'hidden',
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: isChunkDone ? '100%' : `${percent}%`,
                    background: isChunkError ? DANGER : visual.solid,
                    opacity: isChunkDone ? 1 : isChunkActive ? 0.9 : 0.45,
                    transition: 'width 0.2s ease-out',
                    borderRadius: 2
                  }}
                />
              </div>
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
      {expanded && group.chunks.length > 0 && (
        <div
          style={{
            padding: '6px 20px 10px 42px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            background: 'var(--bg-secondary)',
            borderTop: '0.5px solid var(--border-subtle)',
            borderBottom: '0.5px solid var(--border-subtle)'
          }}
        >
          {group.chunks.map((chunk, index) => {
            const chunkSize =
              chunk.rangeEnd !== null
                ? chunk.rangeEnd - chunk.rangeStart + 1
                : totalBytes - chunk.rangeStart
            const percent =
              chunkSize > 0 ? Math.min(100, (chunk.bytesDownloaded / chunkSize) * 100) : 0
            const isChunkActive = chunk.status === 'downloading'
            const isChunkDone = chunk.status === 'completed'
            const isChunkError = chunk.status === 'error'

            const rangeText =
              chunk.rangeEnd !== null
                ? `${formatBytes(chunk.rangeStart)} – ${formatBytes(chunk.rangeEnd)}`
                : `${formatBytes(chunk.rangeStart)}+`

            return (
              <div
                key={chunk.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '110px 1fr 52px 82px 140px',
                  gap: 12,
                  alignItems: 'center',
                  padding: '3px 0',
                  font: `11px/1.2 ${FONT_MONO}`
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <div
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: isChunkError
                        ? DANGER
                        : isChunkDone
                          ? visual.solid
                          : isChunkActive
                            ? visual.solid
                            : 'var(--icon-muted)',
                      opacity: isChunkActive || isChunkDone ? 1 : 0.4
                    }}
                  />
                  <span
                    style={{
                      color: 'var(--text)',
                      fontWeight: 600,
                      whiteSpace: 'nowrap'
                    }}
                  >
                    Stream #{index + 1}
                  </span>
                </div>

                <div
                  style={{
                    height: 6,
                    borderRadius: 999,
                    background: 'var(--track-bg)',
                    overflow: 'hidden',
                    position: 'relative'
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: isChunkDone ? '100%' : `${percent}%`,
                      background: isChunkError ? DANGER : visual.solid,
                      borderRadius: 999,
                      transition: 'width 0.2s ease-out'
                    }}
                  />
                </div>

                <div
                  style={{
                    textAlign: 'right',
                    color: isChunkDone ? visual.text : 'var(--text)',
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: 500
                  }}
                >
                  {Math.round(percent)}%
                </div>

                <div
                  style={{
                    textAlign: 'right',
                    color: isChunkActive ? visual.text : 'var(--text-tertiary)',
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: 500
                  }}
                >
                  {isChunkActive
                    ? formatSpeed(chunk.speedBytesPerSec)
                    : isChunkDone
                      ? 'Done'
                      : chunk.status === 'retrying'
                        ? 'Retrying…'
                        : 'Waiting'}
                </div>

                <div
                  style={{
                    textAlign: 'right',
                    color: 'var(--text-secondary)',
                    fontVariantNumeric: 'tabular-nums',
                    fontSize: '10.5px',
                    whiteSpace: 'nowrap'
                  }}
                  title={`Byte range: ${rangeText}`}
                >
                  {formatBytes(chunk.bytesDownloaded)} / {formatBytes(chunkSize)}
                </div>
              </div>
            )
          })}
        </div>
      )}
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
