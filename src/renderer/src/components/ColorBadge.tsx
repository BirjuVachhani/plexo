import { cn } from '../lib/utils'
import { Badge } from './ui/badge'

/** A `Badge` tinted with an arbitrary bg/border/text triple — for the many places a status or
 * network-kind label needs colors that come from `resolveNetworkVisual`/`KIND_PALETTE` at
 * runtime rather than from a fixed shadcn variant. The triple travels as CSS custom properties
 * (not a `style` object with literal color properties) so `className` can still win normal
 * Tailwind specificity fights, same trick this replaces from NetworkCard. */
export function ColorBadge({
  bg,
  border,
  text,
  className,
  style,
  ...props
}: {
  bg: string
  border: string
  text: string
} & React.ComponentProps<typeof Badge>): React.JSX.Element {
  return (
    <Badge
      variant="outline"
      style={
        {
          ...style,
          '--badge-bg': bg,
          '--badge-border': border,
          '--badge-text': text
        } as React.CSSProperties
      }
      className={cn(
        'rounded-[4px] border-[var(--badge-border)] bg-[var(--badge-bg)] text-[var(--badge-text)]',
        className
      )}
      {...props}
    />
  )
}
