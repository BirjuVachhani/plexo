import { FONT_MONO } from '../theme'

const ROW_HEIGHT = 30
const WIDTH = 236
const LABEL_X = 66
const DOT_X = 74
const CURVE_START_X = 80
const MERGE_X = 168
const STREAM_END_X = WIDTH - 6

/** Draws the bonded-links-into-one-stream diagram: one dashed, flowing line
 * per active physical network, converging into a single solid stream. */
export function MergeDiagram({
  networks,
  muted = false
}: {
  networks: Array<{ solid: string; label: string }>
  muted?: boolean
}): React.JSX.Element {
  const height = Math.max(70, networks.length * ROW_HEIGHT + 16)
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
              d={`M${CURVE_START_X},${y.toFixed(1)} C${CURVE_START_X + 42},${y.toFixed(1)} ${MERGE_X - 32},${midY.toFixed(1)} ${MERGE_X},${midY.toFixed(1)}`}
              stroke={color}
              strokeDasharray="6 8"
              style={
                muted
                  ? undefined
                  : { animation: `plexo-dash ${1.1 + index * 0.2}s linear infinite` }
              }
            />
          )
        })}
        <path
          d={`M${MERGE_X},${midY} L${STREAM_END_X},${midY}`}
          stroke={muted ? 'var(--icon-muted)' : 'var(--text)'}
          strokeWidth={7}
        />
      </g>
      <circle
        cx={MERGE_X}
        cy={midY}
        r={10}
        fill="none"
        stroke={muted ? 'var(--icon-muted)' : 'var(--text)'}
        strokeOpacity={muted ? 1 : 0.25}
        strokeWidth={1.5}
        strokeDasharray={muted ? '3 4' : undefined}
      />
      <circle cx={MERGE_X} cy={midY} r={4} fill={muted ? 'var(--icon-muted)' : 'var(--text)'} />
      {networks.map((network, index) => {
        const y = (index + 0.5) * (height / networks.length)
        const color = muted ? 'var(--icon-muted)' : network.solid
        return <circle key={`dot-${index}`} cx={DOT_X} cy={y} r={3.5} fill={color} />
      })}
      {networks.map((network, index) => {
        const y = (index + 0.5) * (height / networks.length)
        const label =
          network.label.trim().length > 11
            ? `${network.label.trim().slice(0, 10).toUpperCase()}…`
            : network.label.trim().toUpperCase()
        return (
          <text
            key={`label-${index}`}
            x={LABEL_X}
            y={y}
            dominantBaseline="central"
            textAnchor="end"
            fill={muted ? 'var(--icon-muted)' : 'var(--text-secondary)'}
            style={{ font: `500 9px ${FONT_MONO}`, letterSpacing: '0.08em' }}
          >
            <title>{network.label}</title>
            {label}
          </text>
        )
      })}
      {!muted && (
        <text
          x={STREAM_END_X}
          y={midY - 12}
          textAnchor="end"
          fill="var(--text-tertiary)"
          style={{ font: `500 9px ${FONT_MONO}`, letterSpacing: '0.1em' }}
        >
          ONE STREAM
        </text>
      )}
    </svg>
  )
}
