import type { NetworkInterfaceKind } from '@shared/types'
import { FONT_MONO, KIND_PALETTE } from '../theme'

export function KindBadge({ kind }: { kind: NetworkInterfaceKind }): React.JSX.Element {
  const palette = KIND_PALETTE[kind]
  return (
    <div
      style={{
        width: 38,
        textAlign: 'center',
        borderRadius: 4,
        background: palette.bg,
        color: palette.text,
        font: `600 9.5px/1 ${FONT_MONO}`,
        letterSpacing: '0.04em',
        padding: '4px 0',
        flexShrink: 0
      }}
    >
      {palette.label}
    </div>
  )
}
