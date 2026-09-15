import { FONT_MONO } from '../theme'
import { formatSpeed } from '../utils/format'

const ROW_HEIGHT = 36
const LABEL_X = 68
const DOT_X = 76
const CURVE_START_X = 82
const MERGE_X = 146
const STREAM_END_X = 188
const WIDTH = 196

export interface MergeDiagramNetwork {
  solid: string
  label: string
  speedBytesPerSec?: number
}

/** Draws the bonded-links-into-one-stream diagram: individual networks with their
 * real-time speed on the left, converging into a single merged stream pointing
 * directly to the final total speed on the right. */
export function MergeDiagram({
  networks,
  muted = false,
  paused = false
}: {
  networks: MergeDiagramNetwork[]
  muted?: boolean
  paused?: boolean
}): React.JSX.Element {
  const height = Math.max(78, networks.length * ROW_HEIGHT + 10)
  const midY = height / 2

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${height}`}
      style={{ width: WIDTH, height, display: 'block', flexShrink: 0 }}
    >
      <g fill="none" strokeWidth={3} strokeLinecap="round">
        {networks.map((network, index) => {
          const y = (index + 0.5) * (height / networks.length)
          const color = muted ? 'var(--icon-muted)' : network.solid
          return (
            <path
              key={network.label + index}
              d={`M${CURVE_START_X},${y.toFixed(1)} C${CURVE_START_X + 36},${y.toFixed(1)} ${MERGE_X - 26},${midY.toFixed(1)} ${MERGE_X},${midY.toFixed(1)}`}
              stroke={color}
              strokeDasharray="6 8"
              opacity={paused ? 0.55 : 1}
              style={
                muted || paused
                  ? undefined
                  : { animation: `plexo-dash ${1.1 + index * 0.2}s linear infinite` }
              }
            />
          )
        })}
        <path
          d={`M${MERGE_X},${midY} L${STREAM_END_X},${midY}`}
          stroke={
            muted ? 'var(--icon-muted)' : paused ? 'var(--text-secondary)' : 'var(--node-accent)'
          }
          strokeWidth={6.5}
          opacity={paused ? 0.6 : 1}
        />
      </g>
      <polygon
        points={`${STREAM_END_X - 1},${midY - 4.5} ${STREAM_END_X + 6},${midY} ${STREAM_END_X - 1},${midY + 4.5}`}
        fill={muted ? 'var(--icon-muted)' : paused ? 'var(--text-secondary)' : 'var(--node-accent)'}
        opacity={paused ? 0.6 : 1}
      />
      <circle
        cx={MERGE_X}
        cy={midY}
        r={9.5}
        fill="none"
        stroke={muted ? 'var(--icon-muted)' : 'var(--node-accent)'}
        strokeOpacity={muted ? 1 : 0.25}
        strokeWidth={1.5}
        strokeDasharray={muted ? '3 4' : undefined}
      />
      <circle
        cx={MERGE_X}
        cy={midY}
        r={3.5}
        fill={muted ? 'var(--icon-muted)' : 'var(--node-accent)'}
      />
      {networks.map((network, index) => {
        const y = (index + 0.5) * (height / networks.length)
        const color = muted ? 'var(--icon-muted)' : network.solid
        return <circle key={`dot-${index}`} cx={DOT_X} cy={y} r={3.5} fill={color} />
      })}
      {networks.map((network, index) => {
        const y = (index + 0.5) * (height / networks.length)
        const label =
          network.label.trim().length > 10
            ? `${network.label.trim().slice(0, 9).toUpperCase()}…`
            : network.label.trim().toUpperCase()
        const hasSpeed = network.speedBytesPerSec != null && network.speedBytesPerSec > 0
        const speedText = hasSpeed ? formatSpeed(network.speedBytesPerSec!) : '—'

        return (
          <g key={`info-${index}`}>
            <text
              x={LABEL_X}
              y={y - 5.5}
              textAnchor="end"
              fill={muted ? 'var(--icon-muted)' : 'var(--text-tertiary)'}
              style={{ font: `500 8.5px ${FONT_MONO}`, letterSpacing: '0.08em' }}
            >
              <title>{network.label}</title>
              {label}
            </text>
            {!muted && (
              <text
                x={LABEL_X}
                y={y + 7.5}
                textAnchor="end"
                fill={hasSpeed ? network.solid : 'var(--text-tertiary)'}
                style={{
                  font: `600 11px ${FONT_MONO}`,
                  fontVariantNumeric: 'tabular-nums'
                }}
              >
                {speedText}
              </text>
            )}
          </g>
        )
      })}
      {!muted && (
        <text
          x={STREAM_END_X + 2}
          y={midY - 11}
          textAnchor="end"
          fill={paused ? 'var(--color-usb)' : 'var(--text-tertiary)'}
          style={{
            font: `${paused ? '600' : '500'} 8.5px ${FONT_MONO}`,
            letterSpacing: '0.12em'
          }}
        >
          {paused ? 'PAUSED' : 'MERGED'}
        </text>
      )}
    </svg>
  )
}
