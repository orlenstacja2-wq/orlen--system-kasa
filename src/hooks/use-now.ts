import { useEffect, useState } from 'react'

/** Current timestamp, refreshed every `intervalMs`. Null until mounted so SSR markup stays stable. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    const tick = () => setNow(Date.now())
    const first = window.setTimeout(tick, 0)
    const id = window.setInterval(tick, intervalMs)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(id)
    }
  }, [intervalMs])

  return now
}
