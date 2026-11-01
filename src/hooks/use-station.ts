import { useCallback, useEffect, useReducer, useRef } from 'react'

import {
  PUMPS,
  calcAmount,
  getFuel,
  type Fuel,
  type FuelId,
} from '@/lib/station'

/** Litres per second delivered by a dispenser nozzle. */
export const FLOW_LPS = 0.6
/** A new customer arrives roughly every 5 minutes. */
const ARRIVAL_MIN_MS = 4.5 * 60_000
const ARRIVAL_MAX_MS = 5.5 * 60_000
/** Retry soon when every dispenser is busy. */
const ARRIVAL_RETRY_MS = 30_000
/** Unsettled fills close as paid at the pump terminal after this long. */
const AWAITING_EXPIRE_MS = 15 * 60_000

export interface PumpTx {
  id: string
  pump: number
  fuelId: FuelId
  liters: number
  amount: number
  startedAt: number
  fuelingMs: number
  status: 'fueling' | 'awaiting'
  awaitingSince: number | null
  /** Being settled at the register, so it must not expire. */
  locked: boolean
}

type Pumps = Record<number, PumpTx | null>

interface StationState {
  pumps: Pumps
  nextArrivalAt: number | null
}

interface TxSeed {
  id: string
  fuelId: FuelId
  price: number
  liters: number
  pumpOrder: number[]
  delay: number
}

type Action =
  | { type: 'start'; now: number; seeds: [TxSeed, TxSeed] }
  | { type: 'tick'; now: number; seed: TxSeed }
  | { type: 'lock'; pump: number; locked: boolean }
  | { type: 'release'; pump: number; txId: string }
  | { type: 'stop' }

const FUEL_WEIGHTS: [FuelId, number][] = [
  ['pb95', 45],
  ['on', 30],
  ['pb98', 12],
  ['ona', 8],
  ['eko', 5],
]
const FIXED_AMOUNTS = [50, 100, 150, 200, 250]

const uid = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

function randomSeed(fuels: Fuel[]): TxSeed {
  let roll = Math.random() * 100
  let fuelId: FuelId = 'pb95'
  for (const [id, weight] of FUEL_WEIGHTS) {
    if (roll < weight) {
      fuelId = id
      break
    }
    roll -= weight
  }

  const price = getFuel(fuelId, fuels).price
  // Some customers fill "for an amount", most fill by volume.
  const liters =
    Math.random() < 0.3
      ? Math.round(
          (FIXED_AMOUNTS[Math.floor(Math.random() * FIXED_AMOUNTS.length)] /
            price) *
            100,
        ) / 100
      : Math.round((12 + Math.random() * 50) * 100) / 100

  const pumpOrder = [...PUMPS].sort(() => Math.random() - 0.5)
  const delay =
    ARRIVAL_MIN_MS + Math.random() * (ARRIVAL_MAX_MS - ARRIVAL_MIN_MS)
  return { id: uid(), fuelId, price, liters, pumpOrder, delay }
}

function createTx(seed: TxSeed, pump: number, startedAt: number): PumpTx {
  return {
    id: seed.id,
    pump,
    fuelId: seed.fuelId,
    liters: seed.liters,
    amount: calcAmount(seed.liters, seed.price),
    startedAt,
    fuelingMs: (seed.liters / FLOW_LPS) * 1000,
    status: 'fueling',
    awaitingSince: null,
    locked: false,
  }
}

function emptyPumps(): Pumps {
  return Object.fromEntries(PUMPS.map((p) => [p, null]))
}

function reducer(state: StationState, action: Action): StationState {
  switch (action.type) {
    case 'start': {
      if (state.nextArrivalAt !== null) return state
      const [waiting, fueling] = action.seeds
      const pumps = emptyPumps()
      const waitingPump = waiting.pumpOrder[0]
      const fuelingPump =
        fueling.pumpOrder.find((p) => p !== waitingPump) ?? PUMPS[0]
      const done = createTx(waiting, waitingPump, 0)
      pumps[waitingPump] = {
        ...done,
        startedAt: action.now - done.fuelingMs - 45_000,
        status: 'awaiting',
        awaitingSince: action.now - 45_000,
      }
      pumps[fuelingPump] = createTx(fueling, fuelingPump, action.now - 8_000)
      return { ...state, pumps, nextArrivalAt: action.now + waiting.delay }
    }

    case 'tick': {
      const { now, seed } = action
      if (state.nextArrivalAt === null) return state
      let changed = false
      const pumps: Pumps = { ...state.pumps }

      for (const pump of PUMPS) {
        const tx = pumps[pump]
        if (!tx) continue
        if (tx.status === 'fueling' && now >= tx.startedAt + tx.fuelingMs) {
          pumps[pump] = {
            ...tx,
            status: 'awaiting',
            awaitingSince: tx.startedAt + tx.fuelingMs,
          }
          changed = true
        } else if (
          tx.status === 'awaiting' &&
          !tx.locked &&
          tx.awaitingSince !== null &&
          now - tx.awaitingSince > AWAITING_EXPIRE_MS
        ) {
          // Simulated customer paid at the pump terminal; nothing is recorded here.
          pumps[pump] = null
          changed = true
        }
      }

      let nextArrivalAt = state.nextArrivalAt
      if (now >= nextArrivalAt) {
        const free = seed.pumpOrder.find((p) => !pumps[p])
        if (free !== undefined) {
          pumps[free] = createTx(seed, free, now)
          nextArrivalAt = now + seed.delay
        } else {
          nextArrivalAt = now + ARRIVAL_RETRY_MS
        }
        changed = true
      }

      return changed ? { pumps, nextArrivalAt } : state
    }

    case 'lock': {
      const tx = state.pumps[action.pump]
      if (!tx || tx.locked === action.locked) return state
      return {
        ...state,
        pumps: {
          ...state.pumps,
          [action.pump]: { ...tx, locked: action.locked },
        },
      }
    }

    case 'release': {
      const tx = state.pumps[action.pump]
      if (!tx || tx.id !== action.txId) return state
      return { ...state, pumps: { ...state.pumps, [action.pump]: null } }
    }

    case 'stop':
      return state.nextArrivalAt === null
        ? state
        : { pumps: emptyPumps(), nextArrivalAt: null }
  }
}

/**
 * Simulated forecourt (training mode, switched on by an administrator):
 * customers arrive at free dispensers about every 5 minutes, fuel up, then
 * wait to be settled at the register. There is no link to real dispenser
 * controllers. All timing is timestamp-based, so it keeps working across
 * midnight and in throttled tabs.
 */
export function useStation(enabled: boolean, fuels: Fuel[]) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    pumps: emptyPumps(),
    nextArrivalAt: null,
  }))
  const fuelsRef = useRef(fuels)
  useEffect(() => {
    fuelsRef.current = fuels
  })
  const started = state.nextArrivalAt !== null

  useEffect(() => {
    if (enabled) {
      dispatch({
        type: 'start',
        now: Date.now(),
        seeds: [randomSeed(fuelsRef.current), randomSeed(fuelsRef.current)],
      })
    } else {
      dispatch({ type: 'stop' })
    }
  }, [enabled])

  useEffect(() => {
    if (!started) return
    const id = window.setInterval(() => {
      dispatch({
        type: 'tick',
        now: Date.now(),
        seed: randomSeed(fuelsRef.current),
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [started])

  const lock = useCallback((pump: number, locked: boolean) => {
    dispatch({ type: 'lock', pump, locked })
  }, [])

  /** Frees the dispenser once its fill has been recorded. */
  const release = useCallback((pump: number, txId: string) => {
    dispatch({ type: 'release', pump, txId })
  }, [])

  return { pumps: state.pumps, lock, release }
}
