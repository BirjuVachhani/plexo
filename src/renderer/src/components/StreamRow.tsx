import type { ChunkState } from '@shared/types'
import { DANGER, FONT_MONO, FONT_UI, KIND_PALETTE } from '../theme'
import { formatBytes, formatSpeed } from '../utils/format'
import { KindBadge } from './KindBadge'

export function StreamRow({
  chunk,
  totalBytes,
  connectionSuffix
}: {
  chunk: ChunkState
  totalBytes: number
  connectionSuffix?: string
}): React.JSX.Element {
  const chunkSize =
    chunk.rangeEnd !== null ? chunk.rangeEnd - chunk.rangeStart + 1 : totalBytes - chunk.rangeStart
  const percent =
    chunkSize > 0 ? Math.min(100, Math.round((chunk.bytesDownloaded / chunkSize) * 100)) : 0
  const barColor = chunk.status === 'error' ? DANGER : KIND_PALETTE[chunk.interfaceKind].solid

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 20px',
        borderTop: '0.5px solid var(--border-subtle)'
      }}
    >
      <KindBadge kind={chunk.interfaceKind} />
      <div
        style={{
          width: 150,
          font: `13px/1 ${FONT_UI}`,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        {chunk.interfaceLabel}
        {connectionSuffix}
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          height: 5,
          borderRadius: 3,
          background: 'var(--track-bg)',
          overflow: 'hidden'
        }}
      >
        <div
          style={{ width: `${percent}%`, height: '100%', borderRadius: 3, background: barColor }}
        />
      </div>
      <div
        style={{
          width: 38,
          textAlign: 'right',
          font: `11.5px/1 ${FONT_MONO}`,
          fontVariantNumeric: 'tabular-nums'
        }}
      >
        {percent}%
      </div>
      <div
        style={{
          width: 92,
          textAlign: 'right',
          font: `11.5px/1 ${FONT_MONO}`,
          color: 'var(--text)',
          fontVariantNumeric: 'tabular-nums'
        }}
      >
        {chunk.status === 'downloading' ? formatSpeed(chunk.speedBytesPerSec) : '—'}
      </div>
      <div
        style={{
          width: 74,
          textAlign: 'right',
          font: `11.5px/1 ${FONT_MONO}`,
          color: 'var(--text-tertiary)',
          fontVariantNumeric: 'tabular-nums'
        }}
      >
        {formatBytes(chunk.bytesDownloaded)}
      </div>
    </div>
  )
}
