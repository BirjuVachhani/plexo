import { FONT_MONO, FONT_UI, NETWORK_COLOR_SWATCHES, type NetworkColorId } from '../theme'

interface NetworkEditorFieldsProps {
  name: string
  onNameChange: (name: string) => void
  namePlaceholder: string
  colorId: NetworkColorId | undefined
  onColorSelect: (colorId: NetworkColorId | undefined) => void
  onDone: () => void
}

/** Inline rename + recolor controls for one physical network — shared between the Idle screen's
 * network cards and the live network row on the Downloading screen, so a confusing OS device
 * name (e.g. "feth0") can be fixed from wherever it shows up. */
export function NetworkEditorFields({
  name,
  onNameChange,
  namePlaceholder,
  colorId,
  onColorSelect,
  onDone
}: NetworkEditorFieldsProps): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 9,
        padding: '10px 12px',
        borderRadius: 8,
        background: 'var(--input-bg)',
        border: '0.5px solid var(--border-strong)'
      }}
    >
      <input
        type="text"
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
        placeholder={namePlaceholder}
        style={{
          border: '0.5px solid var(--border)',
          borderRadius: 6,
          background: 'var(--bg)',
          outline: 'none',
          padding: '6px 8px',
          font: `12.5px/1.3 ${FONT_UI}`,
          color: 'var(--text)'
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => onColorSelect(undefined)}
          title="Use the default color for this network kind"
          style={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            border: `1.5px solid ${!colorId ? 'var(--text)' : 'var(--border-strong)'}`,
            background: 'var(--bg)',
            color: 'var(--text-tertiary)',
            font: `600 10px/1 ${FONT_UI}`,
            cursor: 'pointer',
            flexShrink: 0
          }}
        >
          ×
        </button>
        {NETWORK_COLOR_SWATCHES.map((swatch) => (
          <button
            key={swatch.id}
            type="button"
            onClick={() => onColorSelect(swatch.id)}
            title={swatch.label}
            style={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              border: colorId === swatch.id ? '1.5px solid var(--text)' : '1.5px solid transparent',
              background: swatch.solid,
              cursor: 'pointer',
              flexShrink: 0
            }}
          />
        ))}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onDone}
          style={{
            border: 'none',
            background: 'none',
            color: 'var(--color-accent)',
            font: `600 11px/1 ${FONT_MONO}`,
            cursor: 'pointer',
            padding: '2px 0'
          }}
        >
          Done
        </button>
      </div>
    </div>
  )
}
