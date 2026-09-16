import type { NetworkInterfaceKind, NetworkPreference } from '@shared/types'

export const FONT_UI = `'Manrope', -apple-system, "SF Pro Text", "Helvetica Neue", Helvetica, sans-serif`
export const FONT_MONO = `"Roboto Mono", "SF Mono", ui-monospace, Menlo, monospace`

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
export const ACCENT = 'var(--color-accent)'
export const ACCENT_ON_TEXT = 'var(--color-accent-onsolid)'
export const SUCCESS = 'var(--color-success)'
export const DANGER = 'var(--color-danger)'

export const PROGRESS_GRADIENT = `linear-gradient(90deg, var(--color-wifi), var(--color-ethernet))`

export const accentChipStyle: React.CSSProperties = {
  padding: '4px 9px',
  borderRadius: 5,
  background: 'var(--color-usb-bg)',
  border: '0.5px solid var(--color-usb-border)',
  font: `600 10.5px/1 ${FONT_MONO}`,
  color: 'var(--color-usb-text)',
  whiteSpace: 'nowrap'
}

const PILL_TOKENS: Record<
  'positive' | 'negative' | 'paused' | 'assembling',
  { bg: string; border: string; text: string }
> = {
  positive: {
    bg: 'var(--color-wifi-bg)',
    border: 'var(--color-wifi-border)',
    text: 'var(--color-wifi-text)'
  },
  negative: {
    bg: 'var(--color-danger-bg)',
    border: 'var(--color-danger-border)',
    text: 'var(--color-danger)'
  },
  paused: {
    bg: 'var(--color-usb-bg)',
    border: 'var(--color-usb-border)',
    text: 'var(--color-usb-text)'
  },
  assembling: {
    bg: 'var(--color-ethernet-bg)',
    border: 'var(--color-ethernet-border)',
    text: 'var(--color-ethernet-text)'
  }
}

export function pillStyle(
  kind: 'positive' | 'negative' | 'paused' | 'assembling'
): React.CSSProperties {
  const tokens = PILL_TOKENS[kind]
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    padding: '4px 10px',
    borderRadius: 999,
    background: tokens.bg,
    border: `0.5px solid ${tokens.border}`,
    font: `600 10px/1 ${FONT_MONO}`,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: tokens.text,
    whiteSpace: 'nowrap'
  }
}

export const secondaryButtonStyle: React.CSSProperties = {
  border: '0.5px solid var(--button-secondary-border)',
  borderRadius: 8,
  background: 'var(--button-secondary-bg)',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  boxShadow: 'var(--button-shadow)',
  padding: '8px 17px',
  font: `600 12.5px/1.3 ${FONT_UI}`,
  color: 'var(--text)',
  cursor: 'pointer'
}

export const primaryButtonStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: 8,
  background: 'var(--color-accent)',
  boxShadow: '0 4px 14px var(--color-accent-shadow)',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  padding: '8px 19px',
  font: `700 12.5px/1.3 ${FONT_UI}`,
  color: 'var(--color-accent-onsolid)',
  cursor: 'pointer'
}

export const disabledPrimaryButtonStyle: React.CSSProperties = {
  border: '0.5px solid var(--button-disabled-border)',
  borderRadius: 8,
  whiteSpace: 'nowrap',
  flexShrink: 0,
  background: 'var(--button-disabled-bg)',
  padding: '8px 19px',
  font: `700 12.5px/1.3 ${FONT_UI}`,
  color: 'var(--button-disabled-text)',
  cursor: 'not-allowed'
}

export const dangerButtonStyle: React.CSSProperties = {
  border: '0.5px solid var(--color-danger-border)',
  borderRadius: 8,
  background: 'var(--color-danger-bg)',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  padding: '8px 17px',
  font: `600 12.5px/1.3 ${FONT_UI}`,
  color: 'var(--color-danger)',
  cursor: 'pointer'
}

export const footerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '11px 20px',
  borderTop: '0.5px solid var(--footer-border)',
  background: 'var(--bg-tertiary)'
}

export const footerTextStyle: React.CSSProperties = {
  whiteSpace: 'nowrap',
  flexShrink: 0,
  font: `11px/1.4 ${FONT_MONO}`,
  color: 'var(--text-tertiary)'
}

export const sectionHeaderLabelStyle: React.CSSProperties = {
  font: `500 10px/1 ${FONT_MONO}`,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'var(--text-tertiary)'
}

export const sectionHeaderMetaStyle: React.CSSProperties = {
  whiteSpace: 'nowrap',
  flexShrink: 0,
  font: `10.5px/1 ${FONT_MONO}`,
  color: 'var(--text-tertiary)'
}

export const statGridStyle: React.CSSProperties = {
  display: 'grid',
  border: '0.5px solid var(--border)',
  borderRadius: 10,
  overflow: 'hidden',
  background: 'var(--bg-secondary)'
}

export const statLabelStyle: React.CSSProperties = {
  font: `500 9px/1 ${FONT_MONO}`,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text-tertiary)'
}

export const statValueStyle: React.CSSProperties = {
  font: `500 14px/1 ${FONT_MONO}`,
  fontVariantNumeric: 'tabular-nums'
}

// Network is a fixed width, sized to what its content (name + streams pill + "⋯" button) needs
// and nothing more — giving it a share of `fr` growth (an earlier version of this did, in a 1:2
// ratio with Progress) just accumulated dead trailing space inside it on a wide window, since
// nothing in that cell actually gets wider. Progress is the one column that should visually
// scale with the window (the bar already fills 100% of its track), so it alone takes the rest
// of the space; that also keeps the gap after the bar, into Share, the same fixed 12px as every
// other column boundary — instead of Network's gap growing while Progress's stays put.
export const NETWORK_ROW_GRID_COLUMNS = '10px 220px 1fr 48px 78px 90px'

// The header and every NetworkRow used to each be their own independent CSS grid with this same
// column template — which happened to compute matching track widths most of the time, but wasn't
// actually *guaranteed* to, since each grid resolves its own tracks independently. The real fix
// is structural: one grid (this style, wrapping the header and every row) owns the column tracks,
// and the header/rows below opt into those exact tracks via `gridTemplateColumns: 'subgrid'`
// rather than each declaring the column list a second time — so "the columns line up" stops being
// a coincidence of matching inputs and becomes a property the browser enforces.
export const networkTableGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: NETWORK_ROW_GRID_COLUMNS,
  // A subgridded axis takes its gutters from whichever grid actually defines the tracks — this
  // one — not from the `gap` set on each subgrid item (the header row, each NetworkRow). Without
  // this, every column boundary on the subgridded axis collapses to 0, which is invisible on the
  // wider columns (their fixed/flexible track width still leaves visible space) but reads as the
  // status dot touching the network name, since that track has no slack to fall back on.
  columnGap: 12
}

export const networkTableHeaderStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'subgrid',
  gridColumn: '1 / -1',
  gap: 12,
  padding: '10px 20px 7px',
  font: `400 9.5px/1 ${FONT_MONO}`,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--text-tertiary)',
  borderBottom: '0.5px solid var(--border)'
}

export const TITLE_BAR_HEIGHT = 44

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
