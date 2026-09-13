import type { NetworkInterfaceKind } from '@shared/types'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  FONT_MONO,
  FONT_UI,
  NETWORK_COLOR_SWATCHES,
  resolveNetworkVisual,
  type NetworkColorId
} from '../theme'

export interface NetworkEditorFieldsProps {
  anchorRef: React.RefObject<HTMLElement | null>
  name: string
  onNameChange: (name: string) => void
  namePlaceholder: string
  colorId: NetworkColorId | undefined
  onColorSelect: (colorId: NetworkColorId | undefined) => void
  interfaceKind: NetworkInterfaceKind
  onDone: () => void
}

/** Floating rename + recolor popover for a physical network — anchored to the `⋯` button
 * without shifting layout or causing jank, with real-time preview and keyboard support. */
export function NetworkEditorFields({
  anchorRef,
  name,
  onNameChange,
  namePlaceholder,
  colorId,
  onColorSelect,
  interfaceKind,
  onDone
}: NetworkEditorFieldsProps): React.JSX.Element | null {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useLayoutEffect(() => {
    if (!anchorRef.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    const popoverWidth = 276
    const popoverHeight = 220

    let left = rect.left - 10
    if (left + popoverWidth > window.innerWidth - 14) {
      left = window.innerWidth - popoverWidth - 14
    }
    if (left < 14) left = 14

    let top = rect.bottom + 6
    if (top + popoverHeight > window.innerHeight - 14) {
      top = Math.max(14, rect.top - popoverHeight - 6)
    }

    setCoords({ top, left })
  }, [anchorRef])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onDone()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onDone])

  if (!coords) return null

  const previewVisual = resolveNetworkVisual(interfaceKind, namePlaceholder, {
    customName: name,
    colorId
  })

  return createPortal(
    <>
      <div
        onClick={onDone}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9998,
          background: 'rgba(0, 0, 0, 0.25)',
          backdropFilter: 'blur(1.5px)'
        }}
      />
      <div
        style={{
          position: 'fixed',
          top: coords.top,
          left: coords.left,
          zIndex: 9999,
          width: 276,
          background: 'var(--bg-secondary)',
          border: '0.5px solid var(--border-strong)',
          borderRadius: 10,
          boxShadow: '0 16px 36px rgba(0, 0, 0, 0.55), 0 4px 12px rgba(0, 0, 0, 0.25)',
          animation: 'plexo-popover-in 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
          padding: '13px 15px',
          display: 'flex',
          flexDirection: 'column',
          gap: 11
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div
            style={{
              font: `600 9.5px/1 ${FONT_MONO}`,
              letterSpacing: '0.14em',
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase'
            }}
          >
            Edit Network
          </div>
          <button
            type="button"
            onClick={onDone}
            title="Close (Esc)"
            style={{
              border: 'none',
              background: 'none',
              color: 'var(--text-tertiary)',
              font: `600 12px/1 ${FONT_UI}`,
              cursor: 'pointer',
              padding: '2px 4px',
              borderRadius: 4
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label
            style={{
              font: `500 9px/1 ${FONT_MONO}`,
              letterSpacing: '0.12em',
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase'
            }}
          >
            Display Name
          </label>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onDone()
            }}
            placeholder={namePlaceholder}
            autoFocus
            style={{
              border: '0.5px solid var(--border-strong)',
              borderRadius: 6,
              background: 'var(--bg)',
              outline: 'none',
              padding: '6px 9px',
              font: `500 12px/1.3 ${FONT_UI}`,
              color: 'var(--text)'
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span
              style={{
                font: `500 9px/1 ${FONT_MONO}`,
                letterSpacing: '0.12em',
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase'
              }}
            >
              Color
            </span>
            {colorId && (
              <button
                type="button"
                onClick={() => onColorSelect(undefined)}
                style={{
                  border: 'none',
                  background: 'none',
                  color: 'var(--color-accent)',
                  font: `500 9.5px/1 ${FONT_MONO}`,
                  cursor: 'pointer',
                  padding: 0
                }}
              >
                Reset to default
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '2px 0' }}>
            <button
              type="button"
              onClick={() => onColorSelect(undefined)}
              title="Default color for this network kind"
              style={{
                width: 19,
                height: 19,
                borderRadius: '50%',
                border: !colorId ? '2px solid var(--text)' : '1px solid var(--border-strong)',
                background: 'var(--bg)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                padding: 0,
                flexShrink: 0
              }}
            >
              <span style={{ fontSize: 9, color: 'var(--text-tertiary)', lineHeight: 1 }}>✕</span>
            </button>
            {NETWORK_COLOR_SWATCHES.map((swatch) => {
              const isSelected = colorId === swatch.id
              return (
                <button
                  key={swatch.id}
                  type="button"
                  onClick={() => onColorSelect(swatch.id)}
                  title={swatch.label}
                  style={{
                    width: 19,
                    height: 19,
                    borderRadius: '50%',
                    border: isSelected ? '2px solid var(--text)' : '1px solid transparent',
                    background: swatch.solid,
                    cursor: 'pointer',
                    padding: 0,
                    flexShrink: 0,
                    transform: isSelected ? 'scale(1.1)' : 'scale(1)'
                  }}
                />
              )
            })}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: 8,
            borderTop: '0.5px solid var(--border)',
            marginTop: 2
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: previewVisual.solid,
                flexShrink: 0
              }}
            />
            <span
              style={{
                font: `600 11px/1 ${FONT_UI}`,
                color: previewVisual.text,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 155
              }}
            >
              {previewVisual.name}
            </span>
          </div>
          <button
            type="button"
            onClick={onDone}
            style={{
              border: 'none',
              borderRadius: 6,
              background: 'var(--color-accent)',
              color: 'var(--color-accent-onsolid)',
              font: `600 11px/1 ${FONT_UI}`,
              padding: '5px 13px',
              cursor: 'pointer'
            }}
          >
            Done
          </button>
        </div>
      </div>
    </>,
    document.body
  )
}
