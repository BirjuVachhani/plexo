import type { NetworkInterfaceKind } from '@shared/types'

export const FONT_UI = `-apple-system, "SF Pro Text", "Helvetica Neue", Helvetica, sans-serif`
export const FONT_MONO = `"SF Mono", ui-monospace, Menlo, monospace`

interface KindPalette {
  solid: string
  bg: string
  text: string
  label: string
}

export const KIND_PALETTE: Record<NetworkInterfaceKind, KindPalette> = {
  wifi: {
    solid: 'oklch(0.6 0.16 250)',
    bg: 'oklch(0.6 0.16 250 / 0.13)',
    text: 'oklch(0.46 0.14 250)',
    label: 'WIFI'
  },
  usb: {
    solid: 'oklch(0.65 0.14 195)',
    bg: 'oklch(0.65 0.14 195 / 0.15)',
    text: 'oklch(0.44 0.11 195)',
    label: 'USB'
  },
  ethernet: {
    solid: 'oklch(0.58 0.17 300)',
    bg: 'oklch(0.58 0.17 300 / 0.13)',
    text: 'oklch(0.44 0.14 300)',
    label: 'ETH'
  },
  bridge: {
    solid: 'oklch(0.55 0.02 260)',
    bg: 'oklch(0.55 0.02 260 / 0.13)',
    text: 'oklch(0.4 0.02 260)',
    label: 'NET'
  },
  other: {
    solid: 'oklch(0.55 0.02 260)',
    bg: 'oklch(0.55 0.02 260 / 0.13)',
    text: 'oklch(0.4 0.02 260)',
    label: 'NET'
  }
}

export const ACCENT_GRADIENT = 'linear-gradient(oklch(0.62 0.19 255), oklch(0.56 0.19 255))'
export const PROGRESS_GRADIENT = 'linear-gradient(90deg, oklch(0.6 0.16 250), oklch(0.62 0.17 290))'
export const SUCCESS = 'oklch(0.62 0.15 150)'
export const DANGER = 'oklch(0.55 0.2 25)'

export const secondaryButtonStyle: React.CSSProperties = {
  border: '0.5px solid #b9b9bb',
  borderRadius: 6,
  background: 'linear-gradient(#fefefe, #f3f3f3)',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  boxShadow: '0 1px 1px rgba(0,0,0,0.05)',
  padding: '6px 14px',
  font: `13px/1.3 ${FONT_UI}`,
  color: '#1d1d1f',
  cursor: 'pointer'
}

export const primaryButtonStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: 6,
  background: ACCENT_GRADIENT,
  boxShadow: '0 1px 2px rgba(0,0,0,0.18), inset 0 0.5px 0 rgba(255,255,255,0.3)',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  padding: '6px 20px',
  font: `500 13px/1.3 ${FONT_UI}`,
  color: '#fff',
  cursor: 'pointer'
}

export const disabledPrimaryButtonStyle: React.CSSProperties = {
  border: '0.5px solid #d2d2d4',
  borderRadius: 6,
  whiteSpace: 'nowrap',
  flexShrink: 0,
  background: '#f4f4f5',
  padding: '6px 20px',
  font: `500 13px/1.3 ${FONT_UI}`,
  color: '#a8a8ac',
  cursor: 'not-allowed'
}

export const footerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '12px 20px',
  borderTop: '0.5px solid #d8d8da',
  background: '#f0f0f0'
}

export const footerTextStyle: React.CSSProperties = {
  whiteSpace: 'nowrap',
  flexShrink: 0,
  font: `11.5px/1.4 ${FONT_MONO}`,
  color: '#6e6e73'
}

export const sectionHeaderLabelStyle: React.CSSProperties = {
  font: `600 11px/1 ${FONT_UI}`,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#8a8a8e'
}

export const sectionHeaderMetaStyle: React.CSSProperties = {
  whiteSpace: 'nowrap',
  flexShrink: 0,
  font: `11px/1 ${FONT_MONO}`,
  color: '#8a8a8e'
}
