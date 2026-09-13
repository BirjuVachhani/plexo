import { FieldsSection } from '../components/FieldsSection'
import { useNetworkPolling } from '../hooks/useNetworkPolling'
import { useAppStore } from '../store/useAppStore'
import {
  disabledPrimaryButtonStyle,
  footerStyle,
  footerTextStyle,
  secondaryButtonStyle
} from '../theme'
import { toDisplayPath } from '../utils/format'

export function NoConnectionsScreen(): React.JSX.Element {
  useNetworkPolling(true)

  const url = useAppStore((store) => store.draftUrl)
  const setUrl = useAppStore((store) => store.setDraftUrl)
  const destinationDir = useAppStore((store) => store.draftDestinationDir)
  const homeDir = useAppStore((store) => store.homeDir)
  const downloadsDir = useAppStore((store) => store.downloadsDir)
  const loadInterfaces = useAppStore((store) => store.loadInterfaces)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff' }}>
      <FieldsSection
        url={url}
        onUrlChange={setUrl}
        displayDestinationDir={toDisplayPath(destinationDir || downloadsDir, homeDir)}
        onBrowse={() => {}}
        disabled
      />

      <div
        style={{
          borderTop: '0.5px solid #e0e0e2',
          background: '#fafafa',
          flex: 1,
          padding: '40px 20px 44px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            border: '1.5px dashed #c2c2c6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#c2c2c6' }} />
        </div>
        <div style={{ font: '600 14px/1.2 -apple-system, sans-serif', color: '#3c3c3e' }}>
          No active network interfaces
        </div>
        <div
          style={{
            maxWidth: 400,
            textAlign: 'center',
            font: '12.5px/1.5 -apple-system, sans-serif',
            color: '#6e6e73'
          }}
        >
          Plexo needs at least one connection. Join a Wi-Fi network, plug in Ethernet, or connect an
          iPhone over USB with Personal Hotspot enabled.
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            type="button"
            onClick={() => loadInterfaces()}
            style={{
              ...secondaryButtonStyle,
              padding: '5px 13px',
              font: '12.5px/1.3 -apple-system, sans-serif'
            }}
          >
            Check Again
          </button>
          <button
            type="button"
            onClick={() => window.plexo.openNetworkSettings()}
            style={{
              ...secondaryButtonStyle,
              padding: '5px 13px',
              font: '12.5px/1.3 -apple-system, sans-serif'
            }}
          >
            Network Settings…
          </button>
        </div>
      </div>

      <div style={footerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#c2c2c6' }} />
          <div style={{ ...footerTextStyle, color: '#8a8a8e' }}>0 interfaces · monitoring</div>
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" disabled style={disabledPrimaryButtonStyle}>
          Start
        </button>
      </div>
    </div>
  )
}
