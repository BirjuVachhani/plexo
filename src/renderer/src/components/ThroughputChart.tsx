const WIDTH = 560
const HEIGHT = 130

interface ThroughputChartProps {
  order: Array<{ interfaceId: string; solid: string }>
  historyByInterface: Record<string, number[]>
}

/** Stacked area chart of recent throughput, split by physical network — the "whole divided
 * by each physical network" readout from design v2, instead of one line per connection. */
export function ThroughputChart({
  order,
  historyByInterface
}: ThroughputChartProps): React.JSX.Element | null {
  const length = Math.max(
    0,
    ...order.map((entry) => historyByInterface[entry.interfaceId]?.length ?? 0)
  )
  if (length < 2) return null

  const totals = Array.from({ length }, (_, i) =>
    order.reduce((sum, entry) => sum + (historyByInterface[entry.interfaceId]?.[i] ?? 0), 0)
  )
  const max = Math.max(1, ...totals)
  const xStep = WIDTH / (length - 1)
  const toY = (value: number): number => HEIGHT - (value / max) * HEIGHT

  interface Layer {
    solid: string
    points: string
  }
  const toPoint = (value: number, i: number): string =>
    `${(i * xStep).toFixed(1)},${toY(value).toFixed(1)}`
  const { layers } = order.reduce<{ cumulative: number[]; layers: Layer[] }>(
    (acc, entry) => {
      const series = historyByInterface[entry.interfaceId] ?? []
      const bottom = acc.cumulative
      const top = bottom.map((value, i) => value + (series[i] ?? 0))
      const points = [...top.map(toPoint), ...bottom.map(toPoint).reverse()].join(' ')
      return { cumulative: top, layers: [...acc.layers, { solid: entry.solid, points }] }
    },
    { cumulative: new Array<number>(length).fill(0), layers: [] }
  )

  const outline = totals
    .map((value, i) => `${(i * xStep).toFixed(1)},${toY(value).toFixed(1)}`)
    .join(' ')

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: 104, display: 'block', marginTop: 7 }}
    >
      <g stroke="var(--border)" strokeWidth={1}>
        <line x1={0} y1={HEIGHT * 0.33} x2={WIDTH} y2={HEIGHT * 0.33} />
        <line x1={0} y1={HEIGHT * 0.66} x2={WIDTH} y2={HEIGHT * 0.66} />
      </g>
      {layers.map((layer, index) => (
        <polygon key={index} points={layer.points} fill={layer.solid} fillOpacity={0.62} />
      ))}
      <polyline
        points={outline}
        fill="none"
        stroke="var(--node-accent)"
        strokeWidth={2}
        strokeOpacity={0.85}
      />
    </svg>
  )
}
