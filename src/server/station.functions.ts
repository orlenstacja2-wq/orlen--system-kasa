import { createServerFn } from '@tanstack/react-start'
import { and, count, eq, gt, isNull, like, lte, ne, or } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db/index.js'
import {
  announcements,
  employees,
  fuelings,
  promotions,
  registerChanges,
  registers,
  shifts,
} from '../../db/schema.js'
import {
  FUEL_IDS,
  TEST_CARD_PREFIX,
  VITAY_CARD_RE,
  calcAmount,
  calcDiscount,
  getFuel,
  hasRole,
  maskCard,
  maskPhone,
  normalizePhone,
  promotionApplies,
  withPrices,
} from '@/lib/station'
import type { PanelData, PromotionSnapshot } from '@/lib/types'
import {
  UserError,
  checkCredentials,
  isUniqueViolation,
  requireRole,
  safe,
} from './auth.server'
import {
  loadAnnouncements,
  loadFuelings,
  loadPrices,
  loadPromotions,
  loadShifts,
  loadSimulation,
  openShiftOf,
} from './data.server'

const MAX_LITERS = 999

/** Published, unexpired announcements for logged-in staff (internal and public). */
function visibleAnnouncements() {
  const now = new Date()
  return and(
    eq(announcements.status, 'published'),
    lte(announcements.publishedAt, now),
    or(isNull(announcements.expiresAt), gt(announcements.expiresAt, now)),
  )
}

/** Active promotions whose end date has not passed. */
function currentPromotions() {
  const now = new Date()
  return and(
    eq(promotions.status, 'active'),
    or(isNull(promotions.validTo), gt(promotions.validTo, now)),
  )
}

async function requireOpenShift(employeeId: number) {
  const shift = await openShiftOf(employeeId)
  if (!shift)
    throw new UserError('Brak otwartej zmiany. Rozpocznij zmianę i wybierz kasę.')
  return shift
}

/** Everything the employee panel needs in one round trip. */
export const getPanelData = createServerFn({ method: 'GET' }).handler(() =>
  safe(async (): Promise<PanelData> => {
    const me = await requireRole()
    const shift = await openShiftOf(me.id)
    const [regs, open, prices, anns, promos, fills, simulation] =
      await Promise.all([
        db.select().from(registers).where(eq(registers.active, true)),
        db
          .select({ registerId: shifts.registerId, name: employees.name })
          .from(shifts)
          .innerJoin(employees, eq(shifts.employeeId, employees.id))
          .where(eq(shifts.status, 'open')),
        loadPrices(),
        loadAnnouncements(visibleAnnouncements()),
        loadPromotions(currentPromotions()),
        shift ? loadFuelings(eq(fuelings.shiftId, shift.id)) : [],
        loadSimulation(),
      ])
    return {
      me,
      shift,
      registers: regs
        .sort((a, b) => a.code.localeCompare(b.code, 'pl', { numeric: true }))
        .map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          active: r.active,
          occupiedBy: open.find((o) => o.registerId === r.id)?.name ?? null,
        })),
      prices,
      announcements: anns,
      promotions: promos,
      fuelings: fills,
      simulation,
    }
  }),
)

export const startShift = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      registerId: z.number().int().positive(),
      note: z.string().trim().max(500).optional(),
    }),
  )
  .handler(({ data }) =>
    safe(async () => {
      const me = await requireRole()
      const [reg] = await db
        .select()
        .from(registers)
        .where(eq(registers.id, data.registerId))
      if (!reg || !reg.active) throw new UserError('Wybrana kasa jest niedostępna.')
      try {
        await db.insert(shifts).values({
          employeeId: me.id,
          registerId: reg.id,
          openingNote: data.note || null,
        })
      } catch (err) {
        if (isUniqueViolation(err, 'employee'))
          throw new UserError('Masz już otwartą zmianę.')
        if (isUniqueViolation(err))
          throw new UserError(
            `Na kasie ${reg.code} trwa już zmiana innego pracownika.`,
          )
        throw err
      }
      return { ok: true }
    }),
  )

/** Moving an open shift to another register needs a manager's login + PIN and a reason. */
export const changeRegister = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      toRegisterId: z.number().int().positive(),
      reason: z.string().trim().min(3).max(300),
      managerLogin: z.string().trim().max(12),
      managerPin: z.string().max(8),
    }),
  )
  .handler(({ data }) =>
    safe(async () => {
      const me = await requireRole()
      const shift = await requireOpenShift(me.id)
      if (shift.register.id === data.toRegisterId)
        throw new UserError('Zmiana jest już prowadzona na tej kasie.')
      const manager = await checkCredentials(
        data.managerLogin.toUpperCase(),
        data.managerPin,
      )
      if (!hasRole(manager.role, 'kierownik'))
        throw new UserError('Zmianę kasy może zatwierdzić tylko kierownik lub administrator.')
      const [reg] = await db
        .select()
        .from(registers)
        .where(eq(registers.id, data.toRegisterId))
      if (!reg || !reg.active) throw new UserError('Wybrana kasa jest niedostępna.')
      try {
        await db.transaction(async (tx) => {
          await tx
            .update(shifts)
            .set({ registerId: reg.id })
            .where(and(eq(shifts.id, shift.id), eq(shifts.status, 'open')))
          await tx.insert(registerChanges).values({
            shiftId: shift.id,
            fromRegisterId: shift.register.id,
            toRegisterId: reg.id,
            reason: data.reason,
            approvedBy: manager.id,
          })
        })
      } catch (err) {
        if (isUniqueViolation(err))
          throw new UserError(`Na kasie ${reg.code} trwa już inna zmiana.`)
        throw err
      }
      return { ok: true }
    }),
  )

export const recordFueling = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      clientRef: z.string().uuid(),
      shiftId: z.number().int().positive(),
      pump: z.number().int().min(1).max(5),
      fuelId: z.enum(FUEL_IDS),
      liters: z.number().positive().max(MAX_LITERS),
      docType: z.enum(['paragon', 'faktura']),
      nip: z.string().optional(),
      company: z.string().trim().max(200).optional(),
      vitayMode: z.enum(['card', 'none', 'phone']),
      vitayCard: z.string().max(40).optional(),
      vitayPhone: z.string().max(20).optional(),
      promotionId: z.number().int().positive().nullable(),
      payment: z.enum(['gotowka', 'karta']),
      cashGiven: z.number().nonnegative().max(100_000).nullable(),
    }),
  )
  .handler(({ data }) =>
    safe(async () => {
      const me = await requireRole()

      // Same settlement sent twice (double click, retry) returns the first record.
      const existing = await loadFuelings(eq(fuelings.clientRef, data.clientRef), 1)
      if (existing[0]) return existing[0]

      const shift = await requireOpenShift(me.id)
      if (shift.id !== data.shiftId)
        throw new UserError('Ta zmiana została zamknięta. Odśwież panel.')

      const liters = Math.round(data.liters * 100) / 100
      if (liters <= 0) throw new UserError('Podaj liczbę litrów.')
      const fuel = getFuel(
        data.fuelId,
        withPrices(
          Object.fromEntries((await loadPrices()).map((p) => [p.fuelId, p.price])),
        ),
      )
      const gross = calcAmount(liters, fuel.price)

      let nip: string | null = null
      let company: string | null = null
      if (data.docType === 'faktura') {
        nip = (data.nip ?? '').replace(/\D/g, '')
        company = data.company?.trim() ?? ''
        if (nip.length !== 10) throw new UserError('NIP musi mieć 10 cyfr.')
        if (!company) throw new UserError('Podaj nazwę nabywcy.')
      }

      // VITAY: only masked values are stored. No real verification exists yet.
      let vitayCardMasked: string | null = null
      let vitayPhoneMasked: string | null = null
      let vitayTest = false
      if (data.vitayMode === 'card') {
        const card = (data.vitayCard ?? '').trim()
        vitayTest = card.startsWith(TEST_CARD_PREFIX)
        const digits = vitayTest ? card.slice(TEST_CARD_PREFIX.length) : card
        if (!VITAY_CARD_RE.test(digits))
          throw new UserError('Numer karty VITAY: 8–19 cyfr.')
        vitayCardMasked = maskCard(digits, vitayTest)
      } else if (data.vitayMode === 'phone') {
        const phone = normalizePhone(data.vitayPhone ?? '')
        if (!phone) throw new UserError('Nieprawidłowy numer telefonu.')
        vitayPhoneMasked = maskPhone(phone)
      }

      let discount = 0
      let snapshot: PromotionSnapshot | null = null
      if (data.promotionId !== null) {
        const [promo] = await loadPromotions(eq(promotions.id, data.promotionId))
        const ok =
          promo &&
          promotionApplies(promo, {
            fuelId: fuel.id,
            liters,
            vitayEligible: data.vitayMode !== 'none' && !vitayTest,
            now: Date.now(),
          })
        if (!promo || !ok)
          throw new UserError('Wybrana promocja nie obowiązuje dla tego tankowania.')
        discount = calcDiscount(promo.discountType, promo.discountValue, liters, gross)
        snapshot = {
          id: promo.id,
          title: promo.title,
          discountType: promo.discountType,
          discountValue: promo.discountValue,
          requiresVitay: promo.requiresVitay,
        }
      }
      const amount = Math.round((gross - discount) * 100) / 100

      let change: number | null = null
      if (data.payment === 'gotowka') {
        const given = data.cashGiven ?? amount
        if (Math.round(given * 100) < Math.round(amount * 100))
          throw new UserError('Kwota przyjęta jest niższa niż kwota do zapłaty.')
        data.cashGiven = given
        change = Math.round((given - amount) * 100) / 100
      } else {
        data.cashGiven = null
      }

      const prefix = `${shift.register.code}/${warsawDay()}/`
      for (let attempt = 0; attempt < 5; attempt++) {
        const [{ n }] = await db
          .select({ n: count() })
          .from(fuelings)
          .where(like(fuelings.docNumber, `${prefix}%`))
        const docNumber = `${prefix}${String(n + 1 + attempt).padStart(4, '0')}`
        try {
          const [row] = await db
            .insert(fuelings)
            .values({
              clientRef: data.clientRef,
              shiftId: shift.id,
              registerId: shift.register.id,
              employeeId: me.id,
              docNumber,
              docType: data.docType,
              pump: data.pump,
              fuelId: fuel.id,
              fuelName: fuel.name,
              liters: liters.toFixed(2),
              pricePerLiter: fuel.price.toFixed(3),
              grossAmount: gross.toFixed(2),
              discountAmount: discount.toFixed(2),
              amount: amount.toFixed(2),
              promotionId: snapshot?.id ?? null,
              promotionSnapshot: snapshot,
              payment: data.payment,
              cashGiven: data.cashGiven === null ? null : data.cashGiven.toFixed(2),
              change: change === null ? null : change.toFixed(2),
              vitayMode: data.vitayMode,
              vitayCardMasked,
              vitayTest,
              vitayPhoneMasked,
              nip,
              company,
            })
            .returning({ id: fuelings.id })
          const [saved] = await loadFuelings(eq(fuelings.id, row.id), 1)
          return saved
        } catch (err) {
          if (isUniqueViolation(err, 'client_ref')) {
            const [saved] = await loadFuelings(eq(fuelings.clientRef, data.clientRef), 1)
            if (saved) return saved
          }
          if (isUniqueViolation(err, 'doc_number')) continue
          throw err
        }
      }
      throw new UserError('Nie udało się nadać numeru dokumentu. Spróbuj ponownie.')
    }),
  )

/** Cancels a fill. The record stays in history with the reason and who cancelled it. */
export const cancelFueling = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.number().int().positive(),
      reason: z.string().trim().min(3).max(300),
    }),
  )
  .handler(({ data }) =>
    safe(async () => {
      const me = await requireRole()
      const [row] = await db
        .select({ f: fuelings, shiftStatus: shifts.status })
        .from(fuelings)
        .innerJoin(shifts, eq(fuelings.shiftId, shifts.id))
        .where(eq(fuelings.id, data.id))
      if (!row) throw new UserError('Nie znaleziono tankowania.')
      if (row.f.status !== 'active') throw new UserError('Tankowanie jest już anulowane.')
      const manager = hasRole(me.role, 'kierownik')
      if (!manager && (row.f.employeeId !== me.id || row.shiftStatus !== 'open'))
        throw new UserError(
          'Możesz anulować tylko własne tankowania w trakcie otwartej zmiany. Poproś kierownika.',
        )
      await db
        .update(fuelings)
        .set({
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelledBy: me.id,
          cancelReason: data.reason,
        })
        .where(and(eq(fuelings.id, data.id), eq(fuelings.status, 'active')))
      return { ok: true }
    }),
  )

export const endShift = createServerFn({ method: 'POST' })
  .validator(z.object({ note: z.string().trim().max(1000).optional() }))
  .handler(({ data }) =>
    safe(async () => {
      const me = await requireRole()
      const shift = await requireOpenShift(me.id)
      await db
        .update(shifts)
        .set({ status: 'closed', endedAt: new Date(), closingNote: data.note || null })
        .where(and(eq(shifts.id, shift.id), eq(shifts.status, 'open')))
      return { shiftId: shift.id }
    }),
  )

/** Manager closes a shift left open by someone else (e.g. forgotten logout). */
export const forceCloseShift = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      shiftId: z.number().int().positive(),
      note: z.string().trim().min(3).max(500),
    }),
  )
  .handler(({ data }) =>
    safe(async () => {
      const me = await requireRole('kierownik')
      const [shift] = await loadShifts(eq(shifts.id, data.shiftId), 1)
      if (!shift || shift.status !== 'open')
        throw new UserError('Ta zmiana nie jest otwarta.')
      await db
        .update(shifts)
        .set({
          status: 'closed',
          endedAt: new Date(),
          closingNote: `Zamknięta przez: ${me.name}. ${data.note}`,
        })
        .where(and(eq(shifts.id, data.shiftId), ne(shifts.status, 'closed')))
      return { ok: true }
    }),
  )

/** YYYYMMDD in the station's time zone, used in document numbers. */
function warsawDay() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  return parts.replace(/-/g, '')
}
