import type { NetworkInterfaceInfo } from '@shared/types'
import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { resolveNetworkVisual, type NetworkColorId } from '../theme'
import { ColorBadge } from './ColorBadge'
import { NetworkEditorFields } from './NetworkEditorFields'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

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
        className="flex size-[15px] shrink-0 items-center justify-center rounded-[4px] font-sans text-[9px] leading-none font-bold shadow-[inset_0_0_0_0.5px_var(--checkbox-shadow)]"
        style={{ background: color, color: onColor }}
      >
        ✓
      </div>
    )
  }
  return (
    <div className="size-[15px] shrink-0 rounded-[4px] border-[0.5px] border-[var(--icon-muted-strong)] bg-[var(--input-bg)] shadow-[inset_0_1px_1px_var(--checkbox-inset-shadow)]" />
  )
}

export function NetworkCard({
  iface,
  selected,
  latencyMs,
  onToggle
}: NetworkCardProps): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const preference = useAppStore((store) => store.networkPreferences[iface.id])
  const setNetworkPreference = useAppStore((store) => store.setNetworkPreference)
  const visual = resolveNetworkVisual(iface.kind, iface.displayName, preference)
  const online = latencyMs != null

  return (
    <div
      className="flex flex-col gap-[11px] rounded-[11px] border-[0.5px] p-[15px]"
      style={{
        background: selected ? visual.bg : 'var(--bg-secondary)',
        borderColor: selected ? visual.border : 'var(--border)'
      }}
    >
      <div className="flex items-center gap-[9px]">
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-[9px] border-none bg-transparent p-0 text-left [font:inherit] text-inherit"
        >
          <Checkbox checked={selected} color={visual.solid} onColor={visual.onSolid} />
          <div
            className={`min-w-0 truncate font-sans text-[13px] leading-none font-semibold ${
              selected ? 'text-foreground' : 'text-[var(--text-secondary)]'
            }`}
          >
            {visual.name}
          </div>
        </button>
        <Popover open={editing} onOpenChange={setEditing}>
          <Tooltip>
            <TooltipTrigger
              render={
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Rename or recolor this network"
                      className="shrink-0 font-sans text-xs font-bold text-muted-foreground"
                    >
                      ⋯
                    </Button>
                  }
                />
              }
            />
            <TooltipContent>Rename or recolor this network</TooltipContent>
          </Tooltip>
          <PopoverContent className="w-[276px]">
            <NetworkEditorFields
              name={preference?.customName ?? ''}
              onNameChange={(customName) => setNetworkPreference(iface.id, { customName })}
              namePlaceholder={iface.displayName}
              colorId={preference?.colorId as NetworkColorId | undefined}
              onColorSelect={(colorId) => setNetworkPreference(iface.id, { colorId })}
              interfaceKind={iface.kind}
              onDone={() => setEditing(false)}
            />
          </PopoverContent>
        </Popover>
        <ColorBadge
          bg={selected ? visual.bg : 'transparent'}
          border={selected ? visual.border : 'var(--border)'}
          text={selected ? visual.text : 'var(--text-tertiary)'}
          className="font-mono text-[10px] tracking-[0.1em]"
        >
          {visual.label}
        </ColorBadge>
      </div>
      <div className="truncate font-mono text-[10.5px] leading-none text-muted-foreground">
        {iface.device} · {iface.address}
      </div>
      <div className="flex items-end justify-between">
        <div className="flex flex-col gap-[5px]">
          <div className="font-mono text-[9px] leading-none font-medium tracking-[0.12em] text-muted-foreground">
            PING
          </div>
          <div
            className="font-mono text-[13px] leading-none font-medium"
            style={{ color: online && selected ? visual.text : 'var(--text-secondary)' }}
          >
            {online ? `${latencyMs} ms` : '—'}
          </div>
        </div>
        <div
          className={`size-[7px] shrink-0 rounded-full ${
            online ? 'bg-[var(--color-success)]' : 'bg-[var(--icon-muted)]'
          }`}
        />
      </div>
    </div>
  )
}
