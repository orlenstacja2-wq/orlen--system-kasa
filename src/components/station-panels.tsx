import { Ban, Printer } from 'lucide-react'

import type { Fueling } from '@/lib/types'
import {
  formatDateTime,
  formatLiters,
  formatMoney,
  formatTime,
  formatUnitPrice,
  getFuel,
  type Fuel,
} from '@/lib/station'
import { cn } from '@/lib/utils'

export function PriceList({
  fuels,
  updatedAt,
}: {
  fuels: Fuel[]
  /** Latest price change, or null while the built-in defaults are used. */
  updatedAt: string | null
}) {
  return (
    <section
      aria-labelledby="prices-title"
      className="rounded-2xl border bg-card p-4"
    >
      <h2
        id="prices-title"
        className="font-display text-xl font-bold tracking-tight"
      >
        Cennik paliw
      </h2>
      <p className="text-xs text-muted-foreground">
        PLN brutto za 1 litr ·{' '}
        {updatedAt
          ? `zmiana: ${formatDateTime(updatedAt)}`
          : 'ceny domyślne – kierownik ustawia aktualne w panelu'}
      </p>
      <ul className="mt-3 divide-y">
        {fuels.map((fuel, i) => (
          <li key={fuel.id} className="flex items-center gap-3 py-2.5">
            <span className="w-4 text-xs text-muted-foreground tabular-nums">
              {i + 1}
            </span>
            <span
              className={cn(
                'w-16 shrink-0 rounded-md px-1.5 py-0.5 text-center text-[11px] font-bold',
                fuel.badge,
              )}
            >
              {fuel.short}
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-semibold">
                {fuel.name}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {fuel.group}
              </span>
            </span>
            <span className="font-display text-xl font-bold tabular-nums">
              {formatUnitPrice(fuel.price)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

const PAYMENT_SHORT = {
  gotowka: 'Gotówka',
  karta: 'Karta',
} as const

const VITAY_SHORT = { card: 'Karta', phone: 'Tel.', none: '—' } as const

export function SalesHistory({
  sales,
  onPrint,
  onCancel,
}: {
  sales: Fueling[]
  onPrint: (sale: Fueling) => void
  onCancel: (sale: Fueling) => void
}) {
  const total =
    sales
      .filter((s) => s.status === 'active')
      .reduce((sum, s) => sum + Math.round(s.amount * 100), 0) / 100

  return (
    <section
      aria-labelledby="history-title"
      className="flex min-h-0 flex-col rounded-2xl border bg-card p-4"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2
          id="history-title"
          className="font-display text-xl font-bold tracking-tight"
        >
          Tankowania tej zmiany
        </h2>
        <span className="text-sm text-muted-foreground">
          Suma:{' '}
          <strong className="text-foreground">{formatMoney(total)} zł</strong>
        </span>
      </div>
      {sales.length === 0 ? (
        <p className="flex flex-1 items-center justify-center py-8 text-sm text-muted-foreground">
          Brak zarejestrowanych tankowań w tej zmianie.
        </p>
      ) : (
        <div className="mt-2 min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">Godz.</th>
                <th className="py-2 font-medium">Nr</th>
                <th className="py-2 font-medium">Dystr.</th>
                <th className="py-2 font-medium">Paliwo</th>
                <th className="py-2 text-right font-medium">Litry</th>
                <th className="py-2 text-right font-medium">Kwota</th>
                <th className="py-2 pl-3 font-medium">Płatność</th>
                <th className="py-2 font-medium">VITAY</th>
                <th className="py-2">
                  <span className="sr-only">Akcje</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sales.map((sale) => {
                const cancelled = sale.status === 'cancelled'
                return (
                  <tr
                    key={sale.id}
                    className={cn(
                      'animate-in fade-in slide-in-from-top-1 duration-300 motion-reduce:animate-none',
                      cancelled && 'text-muted-foreground',
                    )}
                  >
                    <td className="py-2 tabular-nums">
                      {formatTime(Date.parse(sale.createdAt))}
                    </td>
                    <td className="py-2 text-xs">
                      <span className={cn(cancelled && 'line-through')}>
                        {sale.docNumber.split('/').pop()}
                      </span>
                      {cancelled && (
                        <span className="ml-1 rounded bg-destructive/10 px-1 font-semibold text-destructive">
                          anul.
                        </span>
                      )}
                    </td>
                    <td className="py-2 font-semibold">{sale.pump}</td>
                    <td className="py-2">{getFuel(sale.fuelId).short}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatLiters(sale.liters)}
                    </td>
                    <td
                      className={cn(
                        'py-2 text-right font-semibold tabular-nums',
                        cancelled && 'line-through',
                      )}
                    >
                      {formatMoney(sale.amount)}
                    </td>
                    <td className="py-2 pl-3">{PAYMENT_SHORT[sale.payment]}</td>
                    <td className="py-2">
                      {VITAY_SHORT[sale.vitayMode]}
                      {sale.vitayTest && (
                        <span className="ml-1 text-[10px] font-bold text-warning">
                          TEST
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => onPrint(sale)}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-primary"
                        aria-label={`Drukuj ponownie potwierdzenie ${sale.docNumber}`}
                      >
                        <Printer className="size-4" />
                      </button>
                      {!cancelled && (
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => onCancel(sale)}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label={`Anuluj tankowanie ${sale.docNumber}`}
                        >
                          <Ban className="size-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
