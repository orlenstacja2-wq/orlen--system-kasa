import { useNow } from '@/hooks/use-now'
import { cn } from '@/lib/utils'

export function Clock({
  inverted = false,
  className,
}: {
  inverted?: boolean
  className?: string
}) {
  const now = useNow(1000)
  const date = now ? new Date(now) : null

  return (
    <div className={cn('flex flex-col leading-tight', className)}>
      <time
        className="font-display text-4xl font-bold tabular-nums"
        dateTime={date?.toISOString()}
      >
        {date
          ? date.toLocaleTimeString('pl-PL', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })
          : '--:--:--'}
      </time>
      <span
        className={cn(
          'text-sm capitalize',
          inverted ? 'text-white/75' : 'text-muted-foreground',
        )}
      >
        {date
          ? date.toLocaleDateString('pl-PL', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })
          : ' '}
      </span>
    </div>
  )
}
