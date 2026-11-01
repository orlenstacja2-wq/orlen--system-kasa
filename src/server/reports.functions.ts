import { createServerFn } from '@tanstack/react-start'
import { aliasedTable, and, asc, eq, gte, inArray, lt, type SQL } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db/index.js'
import {
  employees,
  fuelings,
  registerChanges,
  registers,
  shifts,
} from '../../db/schema.js'
import { hasRole } from '@/lib/station'
import { computeTotals } from '@/lib/totals'
import type { ShiftListItem, ShiftReport } from '@/lib/types'
import { UserError, requireRole, safe } from './auth.server'
import { loadFuelings, loadShifts } from './data.server'

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()

/** Shift list with filters. Employees only ever see their own shifts. */
export const listShifts = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      registerId: z.number().int().positive().optional(),
      employeeId: z.number().int().positive().optional(),
      from: dateSchema,
      to: dateSchema,
    }),
  )
  .handler(({ data }) =>
    safe(async () => {
      const me = await requireRole()
      const manager = hasRole(me.role, 'kierownik')
      const filters: SQL[] = []
      if (!manager) filters.push(eq(shifts.employeeId, me.id))
      else if (data.employeeId) filters.push(eq(shifts.employeeId, data.employeeId))
      if (data.registerId) filters.push(eq(shifts.registerId, data.registerId))
      if (data.from) filters.push(gte(shifts.startedAt, warsawMidnight(data.from)))
      if (data.to) {
        const end = warsawMidnight(data.to)
        end.setUTCDate(end.getUTCDate() + 1)
        filters.push(lt(shifts.startedAt, end))
      }
      const list = await loadShifts(and(...filters), 300)
      const fills =
        list.length === 0
          ? []
          : await db
              .select({
                shiftId: fuelings.shiftId,
                liters: fuelings.liters,
                amount: fuelings.amount,
                status: fuelings.status,
              })
              .from(fuelings)
              .where(inArray(fuelings.shiftId, list.map((s) => s.id)))
      const items: ShiftListItem[] = list.map((s) => {
        const rows = fills.filter((f) => f.shiftId === s.id && f.status === 'active')
        return {
          ...s,
          count: rows.length,
          liters: rows.reduce((a, r) => a + Math.round(Number(r.liters) * 100), 0) / 100,
          amount: rows.reduce((a, r) => a + Math.round(Number(r.amount) * 100), 0) / 100,
        }
      })

      const [regs, emps] = await Promise.all([
        db
          .select({ id: registers.id, code: registers.code, name: registers.name })
          .from(registers)
          .orderBy(asc(registers.code)),
        manager
          ? db
              .select({ id: employees.id, login: employees.login, name: employees.name })
              .from(employees)
              .orderBy(asc(employees.name))
          : Promise.resolve([{ id: me.id, login: me.login, name: me.name }]),
      ])
      return { me, shifts: items, registers: regs, employees: emps }
    }),
  )

export const getShiftReport = createServerFn({ method: 'GET' })
  .validator(z.object({ shiftId: z.number().int().positive() }))
  .handler(({ data }) =>
    safe(async (): Promise<ShiftReport> => {
      const me = await requireRole()
      const [shift] = await loadShifts(eq(shifts.id, data.shiftId), 1)
      if (!shift) throw new UserError('Nie znaleziono zmiany.')
      if (shift.employee.id !== me.id && !hasRole(me.role, 'kierownik'))
        throw new UserError('Brak uprawnień do tego raportu.')
      const fills = await loadFuelings(eq(fuelings.shiftId, shift.id))
      fills.reverse()

      const fromReg = aliasedTable(registers, 'from_reg')
      const toReg = aliasedTable(registers, 'to_reg')
      const changes = await db
        .select({
          from: fromReg.code,
          to: toReg.code,
          reason: registerChanges.reason,
          approvedBy: employees.name,
          changedAt: registerChanges.changedAt,
        })
        .from(registerChanges)
        .innerJoin(fromReg, eq(registerChanges.fromRegisterId, fromReg.id))
        .innerJoin(toReg, eq(registerChanges.toRegisterId, toReg.id))
        .innerJoin(employees, eq(registerChanges.approvedBy, employees.id))
        .where(eq(registerChanges.shiftId, shift.id))
        .orderBy(asc(registerChanges.changedAt))

      return {
        shift,
        totals: computeTotals(fills),
        fuelings: fills,
        registerChanges: changes.map((c) => ({
          ...c,
          changedAt: c.changedAt.toISOString(),
        })),
        generatedAt: new Date().toISOString(),
      }
    }),
  )

/** Midnight of a YYYY-MM-DD day in Europe/Warsaw, as a UTC Date. */
function warsawMidnight(day: string) {
  const utc = new Date(`${day}T00:00:00Z`)
  const offset = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Warsaw',
    timeZoneName: 'shortOffset',
  })
    .formatToParts(utc)
    .find((p) => p.type === 'timeZoneName')?.value
  const m = offset?.match(/GMT([+-]\d+)/)
  const hours = m ? Number(m[1]) : 0
  return new Date(utc.getTime() - hours * 3_600_000)
}
