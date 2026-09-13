import type { NetworkInterfaceInfo } from '@shared/types'
import { useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { FONT_MONO, FONT_UI, resolveNetworkVisual, type NetworkColorId } from '../theme'
import { NetworkEditorFields } from './NetworkEditorFields'

interface NetworkCardProps {
  iface: NetworkInterfaceInfo
  selected: boolean
  latencyMs: number | null | undefined
  onToggle: () => void
}

function Checkbox({
  checked,
  color,
  onColor
}: {
  checked: boolean
  color: string
  onColor: string
}): React.JSX.Element {
  if (checked) {
    return (
      <div
        style={{
          width: 15,
          height: 15,
          borderRadius: 4,
          background: color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: onColor,
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
        width: 15,
        height: 15,
        borderRadius: 4,
        background: 'var(--input-bg)',
        border: '0.5px solid var(--icon-muted-strong)',
        boxShadow: 'inset 0 1px 1px var(--checkbox-inset-shadow)',
        flexShrink: 0
      }}
    />
  )
}

export function NetworkCard({
  iface,
  selected,
  latencyMs,
  onToggle
}: NetworkCardProps): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const preference = useAppStore((store) => store.networkPreferences[iface.id])
  const setNetworkPreference = useAppStore((store) => store.setNetworkPreference)
  const visual = resolveNetworkVisual(iface.kind, iface.displayName, preference)
  const online = latencyMs != null

  return (
    <div
      style={{
        borderRadius: 11,
        padding: 15,
        background: selected ? visual.bg : 'var(--bg-secondary)',
        border: `0.5px solid ${selected ? visual.border : 'var(--border)'}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 11
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <button
          type="button"
          onClick={onToggle}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            flex: 1,
            minWidth: 0,
            border: 'none',
            background: 'none',
            padding: 0,
            textAlign: 'left',
            cursor: 'pointer',
            font: 'inherit',
            color: 'inherit'
          }}
        >
          <Checkbox checked={selected} color={visual.solid} onColor={visual.onSolid} />
          <div
            style={{
              font: `600 13px/1 ${FONT_UI}`,
              color: selected ? 'var(--text)' : 'var(--text-secondary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              minWidth: 0
            }}
          >
            {visual.name}
          </div>
        </button>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setEditing(true)}
          title="Rename or recolor this network"
          style={{
            border: 'none',
            background: 'none',
            color: 'var(--text-tertiary)',
            font: `700 12px/1 ${FONT_UI}`,
            cursor: 'pointer',
            padding: '2px 4px',
            flexShrink: 0
          }}
        >
          ⋯
        </button>
        {editing && (
          <NetworkEditorFields
            anchorRef={buttonRef}
            name={preference?.customName ?? ''}
            onNameChange={(customName) => setNetworkPreference(iface.id, { customName })}
            namePlaceholder={iface.displayName}
            colorId={preference?.colorId as NetworkColorId | undefined}
            onColorSelect={(colorId) => setNetworkPreference(iface.id, { colorId })}
            interfaceKind={iface.kind}
            onDone={() => setEditing(false)}
          />
        )}
        <div
          style={{
            font: `500 10px/1 ${FONT_MONO}`,
            letterSpacing: '0.1em',
            color: selected ? visual.text : 'var(--text-tertiary)',
            flexShrink: 0
          }}
        >
          {visual.label}
        </div>
      </div>
      <div
        style={{
          font: `10.5px/1 ${FONT_MONO}`,
          color: 'var(--text-tertiary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        {iface.device} · {iface.address}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div
            style={{
              font: `500 9px/1 ${FONT_MONO}`,
              letterSpacing: '0.12em',
              color: 'var(--text-tertiary)'
            }}
          >
            PING
          </div>
          <div
            style={{
              font: `500 13px/1 ${FONT_MONO}`,
              color: online && selected ? visual.text : 'var(--text-secondary)'
            }}
          >
            {online ? `${latencyMs} ms` : '—'}
          </div>
        </div>
        <div
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: online ? 'var(--color-success)' : 'var(--icon-muted)',
            flexShrink: 0
          }}
        />
      </div>
    </div>
  )
}
