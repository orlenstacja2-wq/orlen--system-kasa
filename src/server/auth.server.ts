import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { and, eq, gt } from 'drizzle-orm'
import {
  deleteCookie,
  getCookie,
  getRequest,
  setCookie,
} from '@tanstack/react-start/server'

import { db } from '../../db/index.js'
import { employees, sessions } from '../../db/schema.js'
import { hasRole, type Role } from '@/lib/station'
import type { Me } from '@/lib/types'

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>

const COOKIE = 'orlen_session'
const SESSION_MS = 12 * 60 * 60_000
export const MAX_FAILED = 5
export const LOCK_MS = 5 * 60_000

/** Error whose message is safe to show to the operator. */
export class UserError extends Error {}

export async function hashPin(pin: string) {
  const salt = randomBytes(16)
  const key = await scryptAsync(pin, salt, 32)
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`
}

export async function verifyPin(pin: string, stored: string) {
  const [scheme, saltHex, keyHex] = stored.split('$')
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false
  const expected = Buffer.from(keyHex, 'hex')
  const key = await scryptAsync(pin, Buffer.from(saltHex, 'hex'), expected.length)
  return timingSafeEqual(key, expected)
}

const tokenId = (token: string) =>
  createHash('sha256').update(token).digest('hex')

export async function startSession(employeeId: number) {
  const token = randomBytes(32).toString('base64url')
  await db.insert(sessions).values({
    id: tokenId(token),
    employeeId,
    expiresAt: new Date(Date.now() + SESSION_MS),
  })
  const secure = new URL(getRequest().url).protocol === 'https:'
  setCookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_MS / 1000,
  })
}

export async function endSession() {
  const token = getCookie(COOKIE)
  if (token) await db.delete(sessions).where(eq(sessions.id, tokenId(token)))
  deleteCookie(COOKIE, { path: '/' })
}

/** The logged-in, active employee, or null. */
export async function currentEmployee(): Promise<Me | null> {
  const token = getCookie(COOKIE)
  if (!token) return null
  const [row] = await db
    .select({
      id: employees.id,
      login: employees.login,
      name: employees.name,
      role: employees.role,
    })
    .from(sessions)
    .innerJoin(employees, eq(sessions.employeeId, employees.id))
    .where(
      and(
        eq(sessions.id, tokenId(token)),
        gt(sessions.expiresAt, new Date()),
        eq(employees.active, true),
      ),
    )
  return row ? { ...row, role: row.role as Role } : null
}

/** Throws unless someone with at least `min` role is logged in. */
export async function requireRole(min: Role = 'pracownik'): Promise<Me> {
  const me = await currentEmployee()
  if (!me) throw new UserError('Sesja wygasła. Zaloguj się ponownie.')
  if (!hasRole(me.role, min))
    throw new UserError('Brak uprawnień do tej operacji.')
  return me
}

/**
 * Checks a login + PIN pair with lockout after repeated failures.
 * Used for logging in and for manager approval of register changes.
 */
export async function checkCredentials(login: string, pin: string) {
  const [emp] = await db
    .select()
    .from(employees)
    .where(eq(employees.login, login))
  const generic = new UserError('Nieprawidłowy numer pracownika lub PIN.')
  if (!emp || !emp.active) throw generic
  if (emp.lockedUntil && emp.lockedUntil.getTime() > Date.now()) {
    throw new UserError(
      'Konto jest czasowo zablokowane po kilku błędnych próbach. Spróbuj za kilka minut.',
    )
  }
  if (!(await verifyPin(pin, emp.pinHash))) {
    const failed = emp.failedAttempts + 1
    await db
      .update(employees)
      .set(
        failed >= MAX_FAILED
          ? { failedAttempts: 0, lockedUntil: new Date(Date.now() + LOCK_MS) }
          : { failedAttempts: failed },
      )
      .where(eq(employees.id, emp.id))
    throw generic
  }
  if (emp.failedAttempts > 0 || emp.lockedUntil) {
    await db
      .update(employees)
      .set({ failedAttempts: 0, lockedUntil: null })
      .where(eq(employees.id, emp.id))
  }
  return emp
}

/** Postgres unique-violation check that also looks into wrapped driver errors. */
export function isUniqueViolation(err: unknown, constraint?: string) {
  let e = err as {
    code?: string
    constraint?: string
    message?: string
    cause?: unknown
  } | null
  for (let i = 0; e && i < 4; i++) {
    if (e.code === '23505')
      return (
        !constraint ||
        `${e.constraint ?? ''} ${e.message ?? ''}`.includes(constraint)
      )
    e = e.cause as typeof e
  }
  return false
}

/** Re-throws operator-safe errors and hides everything else. */
export function safe<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err: unknown) => {
    if (err instanceof UserError) throw new Error(err.message)
    console.error(err)
    throw new Error('Wystąpił błąd serwera. Spróbuj ponownie.')
  })
}
