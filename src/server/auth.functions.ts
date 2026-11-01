import { createServerFn } from '@tanstack/react-start'
import { count } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db/index.js'
import { employees, registers } from '../../db/schema.js'
import {
  UserError,
  checkCredentials,
  currentEmployee,
  endSession,
  hashPin,
  safe,
  startSession,
} from './auth.server'
import { loginSchema, pinSchema } from '@/lib/validation'

/** Who is logged in, and whether the station still needs its first administrator. */
export const getBootstrap = createServerFn({ method: 'GET' }).handler(() =>
  safe(async () => {
    const [{ n }] = await db.select({ n: count() }).from(employees)
    return {
      needsSetup: n === 0,
      setupCodeRequired: n === 0 && !!process.env.SETUP_CODE,
      me: n === 0 ? null : await currentEmployee(),
    }
  }),
)

/** First run only: creates the administrator account and the first register. */
export const setupStation = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      name: z.string().trim().min(2).max(80),
      login: loginSchema,
      pin: pinSchema,
      setupCode: z.string().max(200).optional(),
    }),
  )
  .handler(({ data }) =>
    safe(async () => {
      const expected = process.env.SETUP_CODE
      if (expected && data.setupCode !== expected)
        throw new UserError('Nieprawidłowy kod konfiguracji.')
      const [{ n }] = await db.select({ n: count() }).from(employees)
      if (n > 0) throw new UserError('Stacja jest już skonfigurowana.')
      const [admin] = await db
        .insert(employees)
        .values({
          login: data.login.toUpperCase(),
          name: data.name,
          role: 'admin',
          pinHash: await hashPin(data.pin),
        })
        .returning({ id: employees.id })
      const [existing] = await db
        .select({ id: registers.id })
        .from(registers)
        .limit(1)
      if (!existing) {
        await db.insert(registers).values({ code: 'K1', name: 'Kasa 1' })
      }
      await startSession(admin.id)
      return { ok: true }
    }),
  )

export const login = createServerFn({ method: 'POST' })
  .validator(z.object({ login: z.string().trim().max(12), pin: z.string().max(8) }))
  .handler(({ data }) =>
    safe(async () => {
      const emp = await checkCredentials(data.login.toUpperCase(), data.pin)
      await startSession(emp.id)
      return { ok: true }
    }),
  )

export const logout = createServerFn({ method: 'POST' }).handler(() =>
  safe(async () => {
    await endSession()
    return { ok: true }
  }),
)
