import { FlaskConical, Fuel as FuelIcon } from 'lucide-react'

import { useNow } from '@/hooks/use-now'
import { FLOW_LPS, type PumpTx } from '@/hooks/use-station'
import {
  PUMPS,
  calcAmount,
  formatLiters,
  formatPLN,
  getFuel,
  type Fuel,
} from '@/lib/station'
import { cn } from '@/lib/utils'

function minutesAgo(now: number, since: number) {
  const m = Math.max(0, Math.floor((now - since) / 60_000))
  return m === 0 ? 'przed chwilą' : `${m} min temu`
}

export function Dispensers({
  pumps,
  activePump,
  fuels,
  simulation,
  onSelect,
}: {
  pumps: Record<number, PumpTx | null>
  activePump: number | null
  fuels: Fuel[]
  /** Training mode with simulated customers. */
  simulation: boolean
  onSelect: (pump: number) => void
}) {
  const now = useNow(500)
  const busy = PUMPS.filter((p) => pumps[p]).length

  return (
    <section aria-labelledby="dispensers-title">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2
            id="dispensers-title"
            className="font-display text-2xl font-bold tracking-tight"
          >
            Dystrybutory
          </h2>
          <p className="text-sm text-muted-foreground">
            {simulation ? `Aktywne: ${busy} z ${PUMPS.length} · ` : ''}kliknij
            lub wciśnij 1–5 w kasie
          </p>
        </div>
        {simulation ? (
          <p className="flex items-center gap-1.5 rounded-full border border-warning bg-warning/15 px-3 py-1 text-xs font-semibold">
            <FlaskConical className="size-4" />
            Tryb szkoleniowy – symulowani klienci
          </p>
        ) : (
          <p className="max-w-xs text-right text-xs text-muted-foreground">
            Brak połączenia ze sterownikiem dystrybutorów – paliwo i litry
            wprowadzasz w kasie.
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {PUMPS.map((pump) => (
          <DispenserCard
            key={pump}
            pump={pump}
            tx={pumps[pump]}
            fuels={fuels}
            now={now}
            active={activePump === pump}
            onSelect={() => onSelect(pump)}
          />
        ))}
      </div>
    </section>
  )
}

function DispenserCard({
  pump,
  tx,
  fuels,
  now,
  active,
  onSelect,
}: {
  pump: number
  tx: PumpTx | null
  fuels: Fuel[]
  now: number | null
  active: boolean
  onSelect: () => void
}) {
  const fuel = tx ? getFuel(tx.fuelId, fuels) : null
  const fueling = tx?.status === 'fueling'
  const awaiting = tx?.status === 'awaiting'
  const liveLiters =
    tx && fueling && now
      ? Math.min(
          tx.liters,
          Math.max(0, ((now - tx.startedAt) / 1000) * FLOW_LPS),
        )
      : (tx?.liters ?? 0)
  const liveAmount = fuel ? calcAmount(liveLiters, fuel.price) : 0
  const progress = tx ? Math.min(100, (liveLiters / tx.liters) * 100) : 0

  const status = !tx
    ? { label: 'Wolny', cls: 'bg-muted text-muted-foreground' }
    : active || tx.locked
      ? { label: 'W obsłudze', cls: 'bg-foreground text-background' }
      : fueling
        ? { label: 'Tankowanie', cls: 'bg-warning text-black' }
        : { label: 'Do zapłaty', cls: 'bg-primary text-primary-foreground' }

  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={onSelect}
      aria-label={`Dystrybutor ${pump}: ${status.label}`}
      className={cn(
        'group relative flex min-h-52 flex-col overflow-hidden rounded-2xl border-2 bg-card p-4 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-md motion-reduce:transition-none',
        active
          ? 'border-foreground ring-4 ring-foreground/10'
          : awaiting
            ? 'border-primary'
            : 'border-transparent',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            'flex size-12 items-center justify-center rounded-xl font-display text-3xl font-extrabold',
            tx
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {pump}
        </span>
        <span
          className={cn(
            'rounded-full px-2.5 py-1 text-xs font-bold tracking-wide uppercase',
            status.cls,
            awaiting &&
              !active &&
              !tx?.locked &&
              'animate-pulse motion-reduce:animate-none',
          )}
        >
          {status.label}
        </span>
      </div>

      {tx && fuel ? (
        <div
          key={tx.id}
          className="mt-4 flex flex-1 flex-col animate-in fade-in slide-in-from-bottom-2 duration-500 motion-reduce:animate-none"
        >
          <span
            className={cn(
              'self-start rounded-md px-2 py-0.5 text-xs font-bold',
              fuel.badge,
            )}
          >
            {fuel.short}
          </span>
          <span className="mt-1 truncate text-sm text-muted-foreground">
            {fuel.name}
          </span>
          <span className="mt-auto pt-3 text-lg font-semibold tabular-nums">
            {formatLiters(liveLiters)}
          </span>
          <span className="font-display text-3xl leading-none font-bold tabular-nums">
            {formatPLN(liveAmount)}
          </span>
          {fueling ? (
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="bg-flow h-full rounded-full bg-warning transition-[width] duration-500 motion-reduce:transition-none"
                style={{ width: `${progress}%` }}
              />
            </div>
          ) : (
            <span className="mt-3 text-xs text-muted-foreground">
              Oczekuje{' '}
              {now && tx.awaitingSince ? minutesAgo(now, tx.awaitingSince) : ''}
            </span>
          )}
        </div>
      ) : (
        <div className="mt-4 flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground/60">
          <FuelIcon className="size-10" strokeWidth={1.5} />
          <span className="text-sm">
            {active ? 'Wprowadzanie w kasie' : 'Brak klienta'}
          </span>
        </div>
      )}
    </button>
  )
}
