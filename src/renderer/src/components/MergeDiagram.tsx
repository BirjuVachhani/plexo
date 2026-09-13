import { FONT_MONO } from '../theme'

const ROW_HEIGHT = 30
const MERGE_X = 150
const WIDTH = 232

/** Draws the bonded-links-into-one-stream diagram from design v2: one dashed, flowing line
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
              d={`M4,${y.toFixed(1)} C70,${y.toFixed(1)} 84,${midY.toFixed(1)} ${MERGE_X},${midY.toFixed(1)}`}
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
          d={`M${MERGE_X},${midY} L${WIDTH - 10},${midY}`}
          stroke={muted ? 'var(--icon-muted)' : 'var(--text)'}
          strokeWidth={8}
        />
      </g>
      <circle
        cx={MERGE_X}
        cy={midY}
        r={11}
        fill="none"
        stroke={muted ? 'var(--icon-muted)' : 'var(--text)'}
        strokeOpacity={muted ? 1 : 0.25}
        strokeWidth={1.5}
        strokeDasharray={muted ? '3 4' : undefined}
      />
      <circle cx={MERGE_X} cy={midY} r={4.5} fill={muted ? 'var(--icon-muted)' : 'var(--text)'} />
      {networks.map((network, index) => {
        const y = (index + 0.5) * (height / networks.length)
        const color = muted ? 'var(--icon-muted)' : network.solid
        return <circle key={`dot-${index}`} cx={4} cy={y} r={4} fill={color} />
      })}
      {!muted &&
        networks.map((network, index) => {
          const y = (index + 0.5) * (height / networks.length)
          const label =
            network.label.trim().length > 16
              ? `${network.label.trim().slice(0, 15).toUpperCase()}…`
              : network.label.trim().toUpperCase()
          return (
            <text
              key={`label-${index}`}
              x={14}
              y={y - 6}
              fill="var(--text-tertiary)"
              style={{ font: `500 9px ${FONT_MONO}`, letterSpacing: '0.1em' }}
            >
              {label}
            </text>
          )
        })}
      {!muted && (
        <text
          x={WIDTH - 10}
          y={midY - 16}
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
