import { createServerFn } from '@tanstack/react-start'
import { asc, desc, eq, ne, and, count } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db/index.js'
import {
  announcements,
  employees,
  fuelPrices,
  promotionEvents,
  promotions,
  registers,
  sessions,
  shifts,
  stationSettings,
} from '../../db/schema.js'
import { FUEL_IDS, hasRole } from '@/lib/station'
import type { EmployeeInfo, PromotionEvent, RegisterInfo } from '@/lib/types'
import { loginSchema, pinSchema, roleSchema } from '@/lib/validation'
import { UserError, hashPin, isUniqueViolation, requireRole, safe } from './auth.server'
import {
  SETTING_SIMULATION,
  loadAnnouncements,
  loadPrices,
  loadPromotions,
  loadShifts,
  loadSimulation,
} from './data.server'

const optionalDate = z.string().datetime({ offset: true }).nullable()

/** Everything shown in the admin / manager panel. */
export const getAdminData = createServerFn({ method: 'GET' }).handler(() =>
  safe(async () => {
    const me = await requireRole('kierownik')
    const [anns, promos, events, regs, emps, prices, openShifts, simulation] =
      await Promise.all([
        loadAnnouncements(),
        loadPromotions(),
        db
          .select({ e: promotionEvents, employee: employees.name })
          .from(promotionEvents)
          .innerJoin(employees, eq(promotionEvents.employeeId, employees.id))
          .orderBy(desc(promotionEvents.at))
          .limit(500),
        db.select().from(registers).orderBy(asc(registers.code)),
        db.select().from(employees).orderBy(asc(employees.name)),
        loadPrices(),
        loadShifts(eq(shifts.status, 'open')),
        loadSimulation(),
      ])
    const now = Date.now()
    return {
      me,
      announcements: anns,
      promotions: promos,
      promotionEvents: events.map(
        ({ e, employee }): PromotionEvent => ({
          id: e.id,
          promotionId: e.promotionId,
          action: e.action as PromotionEvent['action'],
          employee,
          at: e.at.toISOString(),
        }),
      ),
      registers: regs.map(
        (r): RegisterInfo => ({
          id: r.id,
          code: r.code,
          name: r.name,
          active: r.active,
          occupiedBy:
            openShifts.find((s) => s.register.id === r.id)?.employee.name ?? null,
        }),
      ),
      employees: emps.map(
        (e): EmployeeInfo => ({
          id: e.id,
          login: e.login,
          name: e.name,
          role: e.role as EmployeeInfo['role'],
          active: e.active,
          locked: !!e.lockedUntil && e.lockedUntil.getTime() > now,
          createdAt: e.createdAt.toISOString(),
        }),
      ),
      prices,
      openShifts,
      simulation,
    }
  }),
)

// --- announcements ----------------------------------------------------------

export const saveAnnouncement = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.number().int().positive().nullable(),
      title: z.string().trim().min(3).max(160),
      body: z.string().trim().min(1).max(5000),
      category: z.enum([
        'wewnetrzny',
        'organizacyjny',
        'procedura',
        'awaria',
        'paliwowy',
        'publiczny',
      ]),
      visibility: z.enum(['internal', 'public']),
      important: z.boolean(),
      status: z.enum(['draft', 'published', 'hidden']),
      expiresAt: optionalDate,
    }),
  )
  .handler(({ data }) =>
    safe(async () => {
      const me = await requireRole('kierownik')
      const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null
      const values = {
        title: data.title,
        body: data.body,
        category: data.category,
        visibility: data.visibility,
        important: data.important,
        status: data.status,
        expiresAt,
        updatedBy: me.id,
        updatedAt: new Date(),
      }
      if (data.id === null) {
        await db.insert(announcements).values({
          ...values,
          authorId: me.id,
          publishedAt: data.status === 'published' ? new Date() : null,
        })
      } else {
        const [current] = await db
          .select({ publishedAt: announcements.publishedAt })
          .from(announcements)
          .where(eq(announcements.id, data.id))
        if (!current) throw new UserError('Nie znaleziono komunikatu.')
        await db
          .update(announcements)
          .set({
            ...values,
            publishedAt:
              data.status === 'published' && !current.publishedAt
                ? new Date()
                : current.publishedAt,
          })
          .where(eq(announcements.id, data.id))
      }
      return { ok: true }
    }),
  )

export const setAnnouncementStatus = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.number().int().positive(),
      status: z.enum(['published', 'hidden']),
    }),
  )
  .handler(({ data }) =>
    safe(async () => {
      const me = await requireRole('kierownik')
      const [current] = await db
        .select({ publishedAt: announcements.publishedAt })
        .from(announcements)
        .where(eq(announcements.id, data.id))
      if (!current) throw new UserError('Nie znaleziono komunikatu.')
      await db
        .update(announcements)
        .set({
          status: data.status,
          publishedAt:
            data.status === 'published' && !current.publishedAt
              ? new Date()
              : current.publishedAt,
          updatedBy: me.id,
          updatedAt: new Date(),
        })
        .where(eq(announcements.id, data.id))
      return { ok: true }
    }),
  )

// --- promotions -------------------------------------------------------------

const promotionInput = z
  .object({
    id: z.number().int().positive().nullable(),
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().max(3000),
    fuelIds: z.array(z.enum(FUEL_IDS)).max(FUEL_IDS.length),
    discountType: z.enum(['info', 'per_liter', 'percent']),
    discountValue: z.number().min(0).max(100),
    requiresVitay: z.boolean(),
    minLiters: z.number().positive().max(999).nullable(),
    conditions: z.string().trim().max(3000),
    validFrom: z.string().datetime({ offset: true }),
    validTo: optionalDate,
  })
  .refine((p) => !p.validTo || Date.parse(p.validTo) > Date.parse(p.validFrom), {
    message: 'Data zakończenia musi być późniejsza niż data rozpoczęcia.',
  })
  .refine((p) => p.discountType !== 'percent' || p.discountValue <= 100, {
    message: 'Rabat procentowy nie może przekraczać 100%.',
  })
  .refine((p) => p.discountType !== 'per_liter' || p.discountValue <= 10, {
    message: 'Rabat na litrze nie może przekraczać 10 zł.',
  })

/** Editing a promotion never touches already recorded fills (they keep a snapshot). */
export const savePromotion = createServerFn({ method: 'POST' })
  .validator(promotionInput)
  .handler(({ data }) =>
    safe(async () => {
      const me = await requireRole('kierownik')
      const values = {
        title: data.title,
        description: data.description,
        fuelIds: data.fuelIds,
        discountType: data.discountType,
        discountValue: data.discountType === 'info' ? '0' : data.discountValue.toFixed(3),
        requiresVitay: data.requiresVitay,
        minLiters: data.minLiters === null ? null : data.minLiters.toFixed(2),
        conditions: data.conditions,
        validFrom: new Date(data.validFrom),
        validTo: data.validTo ? new Date(data.validTo) : null,
        updatedBy: me.id,
        updatedAt: new Date(),
      }
      if (data.id === null) {
        const [row] = await db
          .insert(promotions)
          .values({ ...values, createdBy: me.id, status: 'draft' })
          .returning({ id: promotions.id })
        await db
          .insert(promotionEvents)
          .values({ promotionId: row.id, action: 'utworzona', employeeId: me.id })
      } else {
        const [current] = await db
          .select({ status: promotions.status })
          .from(promotions)
          .where(eq(promotions.id, data.id))
        if (!current) throw new UserError('Nie znaleziono promocji.')
        if (current.status === 'ended')
          throw new UserError('Zakończonej promocji nie można edytować. Utwórz nową.')
        await db.update(promotions).set(values).where(eq(promotions.id, data.id))
        await db
          .insert(promotionEvents)
          .values({ promotionId: data.id, action: 'zmieniona', employeeId: me.id })
      }
      return { ok: true }
    }),
  )

export const setPromotionStatus = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.number().int().positive(),
      status: z.enum(['active', 'ended']),
    }),
  )
  .handler(({ data }) =>
    safe(async () => {
      const me = await requireRole('kierownik')
      const [current] = await db
        .select({ status: promotions.status })
        .from(promotions)
        .where(eq(promotions.id, data.id))
      if (!current) throw new UserError('Nie znaleziono promocji.')
      if (current.status === 'ended')
        throw new UserError('Promocja jest już zakończona.')
      if (current.status === data.status) return { ok: true }
      await db
        .update(promotions)
        .set({ status: data.status, updatedBy: me.id, updatedAt: new Date() })
        .where(eq(promotions.id, data.id))
      await db.insert(promotionEvents).values({
        promotionId: data.id,
        action: data.status === 'active' ? 'wlaczona' : 'zakonczona',
        employeeId: me.id,
      })
      return { ok: true }
    }),
  )

// --- registers --------------------------------------------------------------

export const saveRegister = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.number().int().positive().nullable(),
      code: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9-]{1,10}$/, { message: 'Oznaczenie: 1–10 liter, cyfr lub „-”' }),
      name: z.string().trim().min(2).max(60),
      active: z.boolean(),
    }),
  )
  .handler(({ data }) =>
    safe(async () => {
      await requireRole('kierownik')
      const code = data.code.toUpperCase()
      try {
        if (data.id === null) {
          await db.insert(registers).values({ code, name: data.name, active: data.active })
        } else {
          if (!data.active) {
            const [{ n }] = await db
              .select({ n: count() })
              .from(shifts)
              .where(and(eq(shifts.registerId, data.id), eq(shifts.status, 'open')))
            if (n > 0)
              throw new UserError('Na tej kasie trwa zmiana – nie można jej wyłączyć.')
          }
          // Code stays fixed once documents are numbered with it.
          await db
            .update(registers)
            .set({ name: data.name, active: data.active })
            .where(eq(registers.id, data.id))
        }
      } catch (err) {
        if (isUniqueViolation(err))
          throw new UserError(`Kasa o oznaczeniu ${code} już istnieje.`)
        throw err
      }
      return { ok: true }
    }),
  )

// --- employees --------------------------------------------------------------

export const saveEmployee = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.number().int().positive().nullable(),
      login: loginSchema,
      name: z.string().trim().min(2).max(80),
      role: roleSchema,
      active: z.boolean(),
      pin: pinSchema.nullable(),
    }),
  )
  .handler(({ data }) =>
    safe(async () => {
      const me = await requireRole('kierownik')
      const isAdmin = hasRole(me.role, 'admin')
      if (!isAdmin && data.role !== 'pracownik')
        throw new UserError('Kierownik może zakładać tylko konta pracowników.')
      const login = data.login.toUpperCase()
      try {
        if (data.id === null) {
          if (!data.pin) throw new UserError('Ustaw PIN dla nowego pracownika.')
          await db.insert(employees).values({
            login,
            name: data.name,
            role: data.role,
            active: data.active,
            pinHash: await hashPin(data.pin),
          })
        } else {
          const [target] = await db
            .select()
            .from(employees)
            .where(eq(employees.id, data.id))
          if (!target) throw new UserError('Nie znaleziono pracownika.')
          if (!isAdmin && target.role !== 'pracownik')
            throw new UserError('Kierownik może edytować tylko konta pracowników.')
          if (target.id === me.id && (!data.active || data.role !== me.role))
            throw new UserError('Nie możesz wyłączyć ani zmienić roli własnego konta.')
          if (target.role === 'admin' && (data.role !== 'admin' || !data.active)) {
            const [{ n }] = await db
              .select({ n: count() })
              .from(employees)
              .where(
                and(
                  eq(employees.role, 'admin'),
                  eq(employees.active, true),
                  ne(employees.id, target.id),
                ),
              )
            if (n === 0) throw new UserError('Musi pozostać co najmniej jeden aktywny administrator.')
          }
          await db
            .update(employees)
            .set({
              login,
              name: data.name,
              role: data.role,
              active: data.active,
              ...(data.pin
                ? { pinHash: await hashPin(data.pin), failedAttempts: 0, lockedUntil: null }
                : {}),
            })
            .where(eq(employees.id, data.id))
          if (!data.active || data.pin) {
            await db.delete(sessions).where(eq(sessions.employeeId, data.id))
          }
        }
      } catch (err) {
        if (isUniqueViolation(err))
          throw new UserError(`Numer pracownika ${login} jest już zajęty.`)
        throw err
      }
      return { ok: true }
    }),
  )

export const unlockEmployee = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(({ data }) =>
    safe(async () => {
      await requireRole('kierownik')
      await db
        .update(employees)
        .set({ failedAttempts: 0, lockedUntil: null })
        .where(eq(employees.id, data.id))
      return { ok: true }
    }),
  )

// --- prices & settings -------------------------------------------------------

export const setFuelPrice = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      fuelId: z.enum(FUEL_IDS),
      price: z.number().min(0.5).max(50),
    }),
  )
  .handler(({ data }) =>
    safe(async () => {
      const me = await requireRole('kierownik')
      const values = {
        price: data.price.toFixed(3),
        updatedBy: me.id,
        updatedAt: new Date(),
      }
      await db
        .insert(fuelPrices)
        .values({ fuelId: data.fuelId, ...values })
        .onConflictDoUpdate({ target: fuelPrices.fuelId, set: values })
      return { ok: true }
    }),
  )

export const setSimulation = createServerFn({ method: 'POST' })
  .validator(z.object({ enabled: z.boolean() }))
  .handler(({ data }) =>
    safe(async () => {
      const me = await requireRole('admin')
      const values = { value: data.enabled, updatedBy: me.id, updatedAt: new Date() }
      await db
        .insert(stationSettings)
        .values({ key: SETTING_SIMULATION, ...values })
        .onConflictDoUpdate({ target: stationSettings.key, set: values })
      return { ok: true }
    }),
  )
