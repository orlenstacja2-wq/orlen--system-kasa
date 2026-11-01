import { aliasedTable, and, desc, eq, inArray, type SQL } from 'drizzle-orm'

import { db } from '../../db/index.js'
import {
  announcements,
  employees,
  fuelPrices,
  fuelings,
  promotions,
  registers,
  shifts,
  stationSettings,
} from '../../db/schema.js'
import { FUELS, type DiscountType, type FuelId } from '@/lib/station'
import type {
  Announcement,
  AnnouncementCategory,
  DocType,
  FuelPriceInfo,
  Fueling,
  PaymentMethod,
  Promotion,
  PromotionSnapshot,
  ShiftInfo,
  VitayMode,
} from '@/lib/types'

const iso = (d: Date | null) => (d ? d.toISOString() : null)
const num = (v: string | null) => (v === null ? null : Number(v))

const author = aliasedTable(employees, 'author')
const editor = aliasedTable(employees, 'editor')

// --- shifts ---------------------------------------------------------------

export async function loadShifts(where: SQL | undefined, limit = 200) {
  const rows = await db
    .select({
      shift: shifts,
      register: {
        id: registers.id,
        code: registers.code,
        name: registers.name,
      },
      employee: {
        id: employees.id,
        login: employees.login,
        name: employees.name,
      },
    })
    .from(shifts)
    .innerJoin(registers, eq(shifts.registerId, registers.id))
    .innerJoin(employees, eq(shifts.employeeId, employees.id))
    .where(where)
    .orderBy(desc(shifts.startedAt))
    .limit(limit)
  return rows.map(
    (r): ShiftInfo => ({
      id: r.shift.id,
      status: r.shift.status as ShiftInfo['status'],
      startedAt: r.shift.startedAt.toISOString(),
      endedAt: iso(r.shift.endedAt),
      register: r.register,
      employee: r.employee,
      openingNote: r.shift.openingNote,
      closingNote: r.shift.closingNote,
    }),
  )
}

export async function openShiftOf(employeeId: number) {
  const [shift] = await loadShifts(
    and(eq(shifts.employeeId, employeeId), eq(shifts.status, 'open')),
    1,
  )
  return shift ?? null
}

// --- fuelings ---------------------------------------------------------------

export async function loadFuelings(where: SQL | undefined, limit = 5000) {
  const rows = await db
    .select({
      f: fuelings,
      registerCode: registers.code,
      registerName: registers.name,
      employeeLogin: employees.login,
      employeeName: employees.name,
    })
    .from(fuelings)
    .innerJoin(registers, eq(fuelings.registerId, registers.id))
    .innerJoin(employees, eq(fuelings.employeeId, employees.id))
    .where(where)
    .orderBy(desc(fuelings.createdAt))
    .limit(limit)
  return rows.map(({ f, ...r }): Fueling => ({
    id: f.id,
    docNumber: f.docNumber,
    docType: f.docType as DocType,
    shiftId: f.shiftId,
    register: { code: r.registerCode, name: r.registerName },
    employee: { login: r.employeeLogin, name: r.employeeName },
    pump: f.pump,
    fuelId: f.fuelId as FuelId,
    fuelName: f.fuelName,
    liters: Number(f.liters),
    pricePerLiter: Number(f.pricePerLiter),
    grossAmount: Number(f.grossAmount),
    discountAmount: Number(f.discountAmount),
    amount: Number(f.amount),
    promotion: (f.promotionSnapshot as PromotionSnapshot | null) ?? null,
    payment: f.payment as PaymentMethod,
    cashGiven: num(f.cashGiven),
    change: num(f.change),
    vitayMode: f.vitayMode as VitayMode,
    vitayCardMasked: f.vitayCardMasked,
    vitayTest: f.vitayTest,
    vitayPhoneMasked: f.vitayPhoneMasked,
    nip: f.nip,
    company: f.company,
    status: f.status as Fueling['status'],
    cancelledAt: iso(f.cancelledAt),
    cancelReason: f.cancelReason,
    createdAt: f.createdAt.toISOString(),
  }))
}

// --- prices & settings ------------------------------------------------------

export async function loadPrices(): Promise<FuelPriceInfo[]> {
  const rows = await db
    .select({ p: fuelPrices, by: employees.name })
    .from(fuelPrices)
    .leftJoin(employees, eq(fuelPrices.updatedBy, employees.id))
  return FUELS.map((fuel) => {
    const row = rows.find((r) => r.p.fuelId === fuel.id)
    return {
      fuelId: fuel.id,
      price: row ? Number(row.p.price) : fuel.price,
      updatedAt: row ? row.p.updatedAt.toISOString() : null,
      updatedBy: row?.by ?? null,
    }
  })
}

export const SETTING_SIMULATION = 'dispenser_simulation'

export async function loadSimulation() {
  const [row] = await db
    .select({ value: stationSettings.value })
    .from(stationSettings)
    .where(eq(stationSettings.key, SETTING_SIMULATION))
  return row?.value === true
}

// --- promotions -------------------------------------------------------------

export async function loadPromotions(where?: SQL) {
  const rows = await db
    .select({ p: promotions, createdBy: author.name, updatedBy: editor.name })
    .from(promotions)
    .innerJoin(author, eq(promotions.createdBy, author.id))
    .leftJoin(editor, eq(promotions.updatedBy, editor.id))
    .where(where)
    .orderBy(desc(promotions.validFrom))
  return rows.map(
    ({ p, createdBy, updatedBy }): Promotion => ({
      id: p.id,
      title: p.title,
      description: p.description,
      fuelIds: p.fuelIds as FuelId[],
      discountType: p.discountType as DiscountType,
      discountValue: Number(p.discountValue),
      requiresVitay: p.requiresVitay,
      minLiters: num(p.minLiters),
      conditions: p.conditions,
      validFrom: p.validFrom.toISOString(),
      validTo: iso(p.validTo),
      status: p.status as Promotion['status'],
      createdBy,
      updatedBy,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }),
  )
}

// --- announcements ----------------------------------------------------------

export async function loadAnnouncements(where?: SQL) {
  const rows = await db
    .select({ a: announcements, author: author.name })
    .from(announcements)
    .innerJoin(author, eq(announcements.authorId, author.id))
    .where(where)
    .orderBy(desc(announcements.important), desc(announcements.publishedAt))
  return rows.map(
    ({ a, author }): Announcement => ({
      id: a.id,
      title: a.title,
      body: a.body,
      category: a.category as AnnouncementCategory,
      visibility: a.visibility as Announcement['visibility'],
      important: a.important,
      status: a.status as Announcement['status'],
      publishedAt: iso(a.publishedAt),
      expiresAt: iso(a.expiresAt),
      author,
      updatedAt: a.updatedAt.toISOString(),
    }),
  )
}

export async function registerCodes(ids: number[]) {
  if (ids.length === 0) return new Map<number, string>()
  const rows = await db
    .select({ id: registers.id, code: registers.code })
    .from(registers)
    .where(inArray(registers.id, ids))
  return new Map(rows.map((r) => [r.id, r.code]))
}
