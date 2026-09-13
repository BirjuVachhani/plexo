import type { NetworkInterfaceInfo } from '@shared/types'
import { FONT_MONO, FONT_UI, SUCCESS } from '../theme'
import { KindBadge } from './KindBadge'

interface ConnectionRowProps {
  iface: NetworkInterfaceInfo
  selected: boolean
  latencyMs: number | null | undefined
  onToggle: () => void
}

function Checkbox({ checked }: { checked: boolean }): React.JSX.Element {
  if (checked) {
    return (
      <div
        style={{
          width: 14,
          height: 14,
          borderRadius: 4,
          background: 'oklch(0.58 0.19 255)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          font: `700 9px/1 ${FONT_UI}`,
          boxShadow: 'inset 0 0 0 0.5px var(--checkbox-shadow)',
          flexShrink: 0
        }}
      >
        ✓
      </div>
    )
  }
  return (
    <div
      style={{
        width: 14,
        height: 14,
        borderRadius: 4,
        background: 'var(--input-bg)',
        border: '0.5px solid var(--icon-muted-strong)',
        boxShadow: 'inset 0 1px 1px var(--checkbox-inset-shadow)',
        flexShrink: 0
      }}
    />
  )
}

export function ConnectionRow({
  iface,
  selected,
  latencyMs,
  onToggle
}: ConnectionRowProps): React.JSX.Element {
  const online = latencyMs != null

  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 20px',
        borderWidth: '0.5px 0 0 0',
        borderStyle: 'solid',
        borderColor: 'var(--border-subtle)',
        background: 'transparent',
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        font: 'inherit',
        color: 'inherit'
      }}
    >
      <Checkbox checked={selected} />
      <KindBadge kind={iface.kind} />
      <div style={{ font: `13px/1 ${FONT_UI}`, color: 'var(--text)' }}>{iface.displayName}</div>
      <div style={{ font: `11.5px/1 ${FONT_MONO}`, color: 'var(--text-tertiary)' }}>
        {iface.device}
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ font: `11.5px/1 ${FONT_MONO}`, color: 'var(--text-secondary)' }}>
        {iface.address}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: 96,
          justifyContent: 'flex-end'
        }}
      >
        <div
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: online ? SUCCESS : 'var(--icon-muted)',
            flexShrink: 0
          }}
        />
        <div style={{ font: `11.5px/1 ${FONT_MONO}`, color: 'var(--text-secondary)' }}>
          {online ? `${latencyMs} ms` : '—'}
        </div>
      </div>
    </button>
  )
}
