import { CombineDiagram } from '../components/CombineDiagram'
import { useNetworkPolling } from '../hooks/useNetworkPolling'
import { useAppStore } from '../store/useAppStore'
import { FONT_MONO, FONT_UI, disabledPrimaryButtonStyle, secondaryButtonStyle } from '../theme'

// Colors are irrelevant here — the diagram is rendered `muted`, which overrides them all to
// var(--icon-muted) — these are just three placeholder rows to draw the illustration with.
const PLACEHOLDER_NETWORKS = [
  { solid: 'var(--icon-muted)', label: 'Wi-Fi' },
  { solid: 'var(--icon-muted)', label: 'USB' },
  { solid: 'var(--icon-muted)', label: 'Ethernet' }
]

export function NoConnectionsScreen(): React.JSX.Element {
  useNetworkPolling(true)

  const loadInterfaces = useAppStore((store) => store.loadInterfaces)

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}
    >
      <div
        style={{
          flex: 1,
          padding: '40px 20px 44px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16
        }}
      >
        <CombineDiagram networks={PLACEHOLDER_NETWORKS} muted />
        <div style={{ font: `700 16px/1.2 ${FONT_UI}`, color: 'var(--text)' }}>
          No networks to combine
        </div>
        <div
          style={{
            maxWidth: 380,
            textAlign: 'center',
            font: `12.5px/1.6 ${FONT_UI}`,
            color: 'var(--text-secondary)'
          }}
        >
          Plexo needs at least one active network. Join a Wi-Fi network, plug in Ethernet, or
          connect an iPhone over USB with Personal Hotspot enabled.
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button type="button" onClick={() => loadInterfaces()} style={secondaryButtonStyle}>
            Scan Again
          </button>
          <button
            type="button"
            onClick={() => window.plexo.openNetworkSettings()}
            style={secondaryButtonStyle}
          >
            Network Settings…
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '11px 20px',
          background: 'var(--bg-tertiary)',
          borderTop: '0.5px solid var(--footer-border)'
        }}
      >
        <div style={{ font: `11px/1.4 ${FONT_MONO}`, color: 'var(--text-tertiary)' }}>
          0 networks · watching for changes
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" disabled style={disabledPrimaryButtonStyle}>
          Start
        </button>
      </div>
    </div>
  )
}
