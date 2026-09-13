import { FONT_UI, TITLE_BAR_HEIGHT, pillStyle } from '../theme'

export type TitleBarStatus =
  | { kind: 'none' }
  | { kind: 'merged'; networkCount: number }
  | { kind: 'paused'; networkCount: number }
  | { kind: 'offline' }

const isMac = window.plexo.platform === 'darwin'

export function TitleBar({ status }: { status: TitleBarStatus }): React.JSX.Element {
  const dimmed = status.kind === 'offline'

  return (
    <div
      style={{
        height: TITLE_BAR_HEIGHT,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 13,
        // Real traffic lights are inset here on macOS (see main/index.ts, trafficLightPosition) —
        // 16px inset + ~52px cluster width + a clear ~26px gap before our own content starts.
        padding: `0 14px 0 ${isMac ? 94 : 14}px`,
        background: 'var(--bg-secondary)',
        borderBottom: '0.5px solid var(--border)',
        WebkitAppRegion: 'drag'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          style={{
            width: 15,
            height: 15,
            borderRadius: 4,
            background: dimmed ? 'var(--icon-muted)' : 'var(--color-accent)',
            flexShrink: 0
          }}
        />
        <div
          style={{
            font: `700 12.5px/1 ${FONT_UI}`,
            letterSpacing: '0.005em',
            color: dimmed ? 'var(--text-tertiary)' : 'var(--text)'
          }}
        >
          Plexo
        </div>
      </div>
      <div style={{ flex: 1 }} />
      {status.kind === 'merged' && (
        <div style={pillStyle('positive')}>
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--color-wifi)',
              animation: 'plexo-glow 2s ease-in-out infinite'
            }}
          />
          {status.networkCount} {status.networkCount === 1 ? 'network' : 'networks'} merged
        </div>
      )}
      {status.kind === 'paused' && (
        <div style={pillStyle('paused')}>
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--color-usb)'
            }}
          />
          {status.networkCount} {status.networkCount === 1 ? 'network' : 'networks'} · Paused
        </div>
      )}
      {status.kind === 'offline' && (
        <div style={pillStyle('negative')}>
          <div
            style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-danger)' }}
          />
          Offline
        </div>
      )}
    </div>
  )
}
