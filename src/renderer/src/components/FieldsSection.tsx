import { FONT_MONO, FONT_UI, secondaryButtonStyle } from '../theme'

const labelStyle: React.CSSProperties = {
  width: 60,
  textAlign: 'right',
  font: `13px/1 ${FONT_UI}`,
  color: '#3c3c3e',
  flexShrink: 0
}

const fieldBoxStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: '0.5px solid #b9b9bb',
  borderRadius: 6,
  background: '#fff',
  boxShadow: 'inset 0 1px 1px rgba(0,0,0,0.05)',
  padding: '6px 9px',
  font: `13px/1.3 ${FONT_MONO}`,
  color: '#1d1d1f',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis'
}

interface FieldsSectionProps {
  url: string
  onUrlChange: (url: string) => void
  displayDestinationDir: string
  onBrowse: () => void
  disabled?: boolean
}

export function FieldsSection({
  url,
  onUrlChange,
  displayDestinationDir,
  onBrowse,
  disabled = false
}: FieldsSectionProps): React.JSX.Element {
  return (
    <div
      style={{
        padding: '18px 20px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? 'none' : 'auto'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={labelStyle}>URL</div>
        <input
          type="text"
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          placeholder="https://"
          disabled={disabled}
          style={{ ...fieldBoxStyle, border: '0.5px solid #b9b9bb', outline: 'none' }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={labelStyle}>Save to</div>
        <div style={fieldBoxStyle}>{displayDestinationDir}</div>
        <button type="button" onClick={onBrowse} disabled={disabled} style={secondaryButtonStyle}>
          Browse…
        </button>
      </div>
    </div>
  )
}
