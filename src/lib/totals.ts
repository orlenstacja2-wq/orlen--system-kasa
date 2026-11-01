import { FUELS } from '@/lib/station'
import type { Fueling, ShiftTotals } from '@/lib/types'

const sum = (values: number[]) =>
  Math.round(values.reduce((acc, v) => acc + Math.round(v * 100), 0)) / 100

/** Shift totals from recorded fills only. Cancelled fills are counted separately. */
export function computeTotals(fuelings: Fueling[]): ShiftTotals {
  const active = fuelings.filter((f) => f.status === 'active')
  const cancelled = fuelings.filter((f) => f.status === 'cancelled')
  const byFuel = FUELS.map((fuel) => {
    const rows = active.filter((f) => f.fuelId === fuel.id)
    return {
      fuelId: fuel.id,
      fuelName: fuel.name,
      count: rows.length,
      liters: sum(rows.map((r) => r.liters)),
      amount: sum(rows.map((r) => r.amount)),
    }
  }).filter((row) => row.count > 0)

  return {
    count: active.length,
    liters: sum(active.map((f) => f.liters)),
    grossAmount: sum(active.map((f) => f.grossAmount)),
    discountAmount: sum(active.map((f) => f.discountAmount)),
    amount: sum(active.map((f) => f.amount)),
    vitayCard: active.filter((f) => f.vitayMode === 'card' && !f.vitayTest)
      .length,
    vitayTestCard: active.filter((f) => f.vitayMode === 'card' && f.vitayTest)
      .length,
    vitayPhone: active.filter((f) => f.vitayMode === 'phone').length,
    vitayNone: active.filter((f) => f.vitayMode === 'none').length,
    promotions: active.filter((f) => f.promotion).length,
    cash: sum(active.filter((f) => f.payment === 'gotowka').map((f) => f.amount)),
    card: sum(active.filter((f) => f.payment === 'karta').map((f) => f.amount)),
    cancelledCount: cancelled.length,
    cancelledAmount: sum(cancelled.map((f) => f.amount)),
    byFuel,
  }
}
