import { LOGO_RATIO, LOGO_SRC, logoUrl } from '@/lib/station'
import { cn } from '@/lib/utils'

/**
 * The station's ORLEN logo (supplied artwork, never redrawn or stretched).
 * Height comes from `className` (e.g. `h-10`); width follows the aspect ratio.
 * `inverted` puts it on a white tile for red backgrounds.
 * `print` loads the file directly so it is ready before the print dialog opens.
 */
export function OrlenLogo({
  className,
  inverted = false,
  print = false,
  width = 240,
}: {
  className?: string
  inverted?: boolean
  print?: boolean
  /** Rendered width in CSS pixels, used to request a sharp CDN size. */
  width?: number
}) {
  const img = (
    <img
      src={print ? LOGO_SRC : logoUrl(Math.round(width * 2))}
      alt="ORLEN"
      draggable={false}
      className={cn('block h-full w-auto object-contain', !inverted && className)}
      style={{ aspectRatio: LOGO_RATIO }}
    />
  )
  if (!inverted) return img
  return (
    <span
      className={cn(
        'inline-flex rounded-xl bg-white p-2 shadow-sm',
        className,
      )}
    >
      {img}
    </span>
  )
}

/** Kept for screens that still use the old mark; renders the supplied logo. */
export function OrlenEagle({ className }: { className?: string }) {
  return <OrlenLogo print className={className} />
}
