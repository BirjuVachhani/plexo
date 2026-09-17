import type { NetworkInterfaceKind } from '@shared/types'
import { useRef } from 'react'
import { NETWORK_COLOR_SWATCHES, resolveNetworkVisual, type NetworkColorId } from '../theme'
import { Button } from './ui/button'

export interface NetworkEditorFieldsProps {
  name: string
  onNameChange: (name: string) => void
  namePlaceholder: string
  colorId: NetworkColorId | undefined
  onColorSelect: (colorId: NetworkColorId | undefined) => void
  interfaceKind: NetworkInterfaceKind
  onDone: () => void
}

const fieldLabelClass =
  'font-mono text-[9px] leading-none font-medium tracking-[0.12em] text-muted-foreground uppercase'

/** Rename + recolor fields for a physical network, rendered inside a shadcn `PopoverContent` (see
 * NetworkCard) — real-time preview and keyboard support, positioning/portal/dismissal all handled
 * by the Popover primitive rather than by hand here. */
export function NetworkEditorFields({
  name,
  onNameChange,
  namePlaceholder,
  colorId,
  onColorSelect,
  interfaceKind,
  onDone
}: NetworkEditorFieldsProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)

  const previewVisual = resolveNetworkVisual(interfaceKind, namePlaceholder, {
    customName: name,
    colorId
  })

  return (
    <div className="flex flex-col gap-[11px]">
      <div className="font-mono text-[9.5px] leading-none font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        Edit Network
      </div>

      <div className="flex flex-col gap-[5px]">
        <label htmlFor="network-display-name" className={fieldLabelClass}>
          Display Name
        </label>
        <input
          ref={inputRef}
          id="network-display-name"
          type="text"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onDone()
          }}
          placeholder={namePlaceholder}
          autoFocus
          className="rounded-[6px] border border-input bg-background px-[9px] py-1.5 font-sans text-[12px] leading-[1.3] font-medium text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>

      <div className="flex flex-col gap-[6px]">
        <div className="flex items-center justify-between">
          <span className={fieldLabelClass}>Color</span>
          {colorId && (
            <button
              type="button"
              onClick={() => onColorSelect(undefined)}
              className="border-none bg-transparent p-0 font-mono text-[9.5px] leading-none font-medium text-primary"
            >
              Reset to default
            </button>
          )}
        </div>
        <div className="flex items-center gap-[7px] py-0.5">
          <button
            type="button"
            onClick={() => onColorSelect(undefined)}
            title="Default color for this network kind"
            aria-label="Default color for this network kind"
            aria-pressed={!colorId}
            className={`flex size-6 shrink-0 items-center justify-center rounded-full bg-background p-0 ${
              !colorId ? 'border-2 border-foreground' : 'border border-input'
            }`}
          >
            <span className="text-[9px] leading-none text-muted-foreground">✕</span>
          </button>
          {NETWORK_COLOR_SWATCHES.map((swatch) => {
            const isSelected = colorId === swatch.id
            return (
              <button
                key={swatch.id}
                type="button"
                onClick={() => onColorSelect(swatch.id)}
                title={swatch.label}
                aria-label={swatch.label}
                aria-pressed={isSelected}
                className={`size-6 shrink-0 rounded-full p-0 ${
                  isSelected ? 'scale-110 border-2 border-foreground' : 'border border-transparent'
                }`}
                style={{ background: swatch.solid }}
              />
            )
          })}
        </div>
      </div>

      <div className="mt-0.5 flex items-center justify-between border-t-[0.5px] border-border pt-2">
        <div className="flex min-w-0 items-center gap-[6px]">
          <div
            className="size-[7px] shrink-0 rounded-full"
            style={{ background: previewVisual.solid }}
          />
          <span
            className="max-w-[155px] truncate font-sans text-[11px] leading-none font-semibold"
            style={{ color: previewVisual.text }}
          >
            {previewVisual.name}
          </span>
        </div>
        <Button type="button" size="xs" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  )
}
