import { z } from 'zod'

export const loginSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{3,12}$/, { message: 'Numer pracownika: 3–12 liter lub cyfr' })
export const pinSchema = z
  .string()
  .regex(/^\d{4,8}$/, { message: 'PIN: 4–8 cyfr' })
export const roleSchema = z.enum(['pracownik', 'kierownik', 'admin'])
