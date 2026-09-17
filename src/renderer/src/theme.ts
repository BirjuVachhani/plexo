import type { NetworkInterfaceKind, NetworkPreference } from '@shared/types'

interface KindPalette {
  solid: string
  bg: string
  border: string
  text: string
  /** Glyph/text color for content drawn directly on top of `solid` (e.g. a checkmark). */
  onSolid: string
  label: string
}

function makeKindPalette(name: string, label: string): KindPalette {
  return {
    solid: `var(--color-${name})`,
    bg: `var(--color-${name}-bg)`,
    border: `var(--color-${name}-border)`,
    text: `var(--color-${name}-text)`,
    onSolid: `var(--color-${name}-onsolid)`,
    label
  }
}

// Teal / amber / steel per network, per the "Plexo v2" design — exact hex values live as
// CSS custom properties (main.css) so dark mode reproduces the design precisely while light
// mode gets a coherent, hand-tuned counterpart in the same hues.
export const KIND_PALETTE: Record<NetworkInterfaceKind, KindPalette> = {
  wifi: makeKindPalette('wifi', 'WIFI'),
  usb: makeKindPalette('usb', 'USB'),
  ethernet: makeKindPalette('ethernet', 'ETH'),
  bridge: makeKindPalette('neutral', 'NET'),
  other: makeKindPalette('neutral', 'NET')
}

// The brand amber doubles as the USB network color, exactly as in the design.
export const DANGER = 'var(--color-danger)'

// Network sizes to its content (name + streams pill + "⋯" button) instead of a guessed fixed
// px — `minmax(0, max-content)` grows it to fit whatever's actually in that cell (no dead
// trailing space before Progress) and, just as importantly, lets it shrink below that on a
// narrow window instead of holding a fixed width the row can't fit in. Progress is the one
// column that should visually scale with the window (the bar already fills 100% of its track),
// so it alone takes the leftover space; that also keeps the gap after the bar, into Share, the
// same fixed 12px as every other column boundary — instead of Network's gap growing while
// Progress's stays put.
export const NETWORK_ROW_GRID_COLUMNS = '10px minmax(0, max-content) 1fr 48px 78px 90px'

// A curated set of user-selectable network colors, distinct from (and in addition to) the
// kind defaults above — each ships its own on-solid text color so it's legible without having
// to compute contrast for an arbitrary user-picked hue at runtime.
export const NETWORK_COLOR_SWATCHES = [
  { id: 'teal', label: 'Teal', solid: '#4ea89a', onSolid: '#10201d' },
  { id: 'amber', label: 'Amber', solid: '#d8a44c', onSolid: '#221806' },
  { id: 'steel', label: 'Steel', solid: '#7e93bd', onSolid: '#141a26' },
  { id: 'rose', label: 'Rose', solid: '#c97b7b', onSolid: '#210f0f' },
  { id: 'violet', label: 'Violet', solid: '#9c8fd6', onSolid: '#17131f' },
  { id: 'lime', label: 'Lime', solid: '#a3c66a', onSolid: '#161f0d' },
  { id: 'cyan', label: 'Cyan', solid: '#6db8c9', onSolid: '#0d1a1e' },
  { id: 'coral', label: 'Coral', solid: '#d99168', onSolid: '#241209' }
] as const

export type NetworkColorId = (typeof NETWORK_COLOR_SWATCHES)[number]['id']

/** Derives a full surface set (bg/border/text) from a swatch's one solid color, tinted against
 * the ambient theme — same trick as the kind palette, just computed at runtime since these
 * colors are picked by the user rather than baked into the design. */
function tint(source: string, amount: number, base = 'var(--bg-secondary)'): string {
  return `color-mix(in oklch, ${source} ${amount}%, ${base})`
}

export interface NetworkVisual extends KindPalette {
  /** The network's effective display name — the user's custom name if set, else the OS one. */
  name: string
}

/** Resolves what a physical network should actually look like in the UI: its kind's default
 * palette, unless the user picked a custom color for this specific interface id, and its OS
 * display name, unless the user gave it a friendlier one (e.g. "feth0" -> "iPhone Hotspot"). */
export function resolveNetworkVisual(
  kind: NetworkInterfaceKind,
  fallbackName: string,
  preference: NetworkPreference | undefined
): NetworkVisual {
  const name = preference?.customName?.trim() || fallbackName
  const kindPalette = KIND_PALETTE[kind]
  const swatch = NETWORK_COLOR_SWATCHES.find((entry) => entry.id === preference?.colorId)

  if (!swatch) {
    return { ...kindPalette, name }
  }

  return {
    solid: swatch.solid,
    bg: tint(swatch.solid, 16),
    border: tint(swatch.solid, 42, 'var(--border-strong)'),
    text: tint(swatch.solid, 62, 'var(--text)'),
    onSolid: swatch.onSolid,
    label: kindPalette.label,
    name
  }
}
