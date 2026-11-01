import { useCallback, useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { LogOut, MapPin } from 'lucide-react'

import { Clock } from '@/components/clock'
import { Dispensers } from '@/components/dispensers'
import { LoginScreen } from '@/components/login-screen'
import { OrlenLogo } from '@/components/orlen-logo'
import { PrintHost } from '@/components/receipt'
import { Register } from '@/components/register'
import { PriceList, SalesHistory } from '@/components/station-panels'
import { useStation, type CompletedSale } from '@/hooks/use-station'
import { STATION } from '@/lib/station'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const [loggedIn, setLoggedIn] = useState(false)
  const station = useStation()
  const selectPumpRef = useRef<((pump: number) => void) | null>(null)
  const [activePump, setActivePump] = useState<number | null>(null)
  const [printJob, setPrintJob] = useState<{
    sale: CompletedSale
    nonce: number
  } | null>(null)

  const print = useCallback((sale: CompletedSale) => {
    setPrintJob({ sale, nonce: Date.now() })
  }, [])
  const clearPrint = useCallback(() => setPrintJob(null), [])

  useEffect(() => {
    if (!loggedIn) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F10') {
        e.preventDefault()
        setLoggedIn(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [loggedIn])

  if (!loggedIn) {
    return (
      <LoginScreen
        onSuccess={() => {
          setLoggedIn(true)
          station.start()
        }}
      />
    )
  }

  return (
    <>
      <div className="flex min-h-screen flex-col lg:h-screen">
        <header className="flex items-center justify-between gap-6 border-b-4 border-primary bg-card px-4 py-3 sm:px-6">
          <div className="flex items-center gap-5">
            <OrlenLogo className="text-3xl" />
            <div className="hidden border-l pl-5 md:block">
              <h1 className="font-display text-lg leading-tight font-bold">
                System obsługi stacji paliw
              </h1>
              <p className="flex items-center gap-1 text-sm text-muted-foreground">
                <MapPin className="size-3.5 text-primary" />
                {STATION.street}, {STATION.city} · Numer {STATION.number} ·{' '}
                {STATION.website}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-5">
            <Clock className="text-right" />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setLoggedIn(false)}
              className="flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-semibold text-muted-foreground hover:border-primary hover:text-primary"
            >
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Wyloguj</span>
              <kbd className="rounded border px-1 font-mono text-[10px]">
                F10
              </kbd>
            </button>
          </div>
        </header>

        <main className="grid min-h-0 flex-1 gap-4 p-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_28rem]">
          <div className="flex min-h-0 flex-col gap-4 lg:overflow-auto">
            <Dispensers
              pumps={station.pumps}
              activePump={activePump}
              nextArrivalAt={station.nextArrivalAt}
              onSelect={(pump) => selectPumpRef.current?.(pump)}
            />
            <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]">
              <PriceList />
              <SalesHistory sales={station.sales} onPrint={print} />
            </div>
          </div>
          <Register
            pumps={station.pumps}
            selectPumpRef={selectPumpRef}
            onActivePumpChange={setActivePump}
            lock={station.lock}
            completeSale={station.completeSale}
            onPrint={print}
          />
        </main>
      </div>
      <PrintHost job={printJob} onDone={clearPrint} />
    </>
  )
}
