import type { DiscountType, FuelId, Role } from '@/lib/station'

/** Data shapes returned by server functions. Dates are ISO strings. */

export interface Me {
  id: number
  login: string
  name: string
  role: Role
}

export interface RegisterInfo {
  id: number
  code: string
  name: string
  active: boolean
  /** Name of the employee with an open shift on this register. */
  occupiedBy: string | null
}

export interface ShiftInfo {
  id: number
  status: 'open' | 'closed'
  startedAt: string
  endedAt: string | null
  register: { id: number; code: string; name: string }
  employee: { id: number; login: string; name: string }
  openingNote: string | null
  closingNote: string | null
}

export type DocType = 'paragon' | 'faktura'
export type PaymentMethod = 'gotowka' | 'karta'
export type VitayMode = 'card' | 'none' | 'phone'

export interface PromotionSnapshot {
  id: number
  title: string
  discountType: DiscountType
  discountValue: number
  requiresVitay: boolean
}

export interface Fueling {
  id: number
  docNumber: string
  docType: DocType
  shiftId: number
  register: { code: string; name: string }
  employee: { login: string; name: string }
  pump: number
  fuelId: FuelId
  fuelName: string
  liters: number
  pricePerLiter: number
  grossAmount: number
  discountAmount: number
  amount: number
  promotion: PromotionSnapshot | null
  payment: PaymentMethod
  cashGiven: number | null
  change: number | null
  vitayMode: VitayMode
  vitayCardMasked: string | null
  vitayTest: boolean
  vitayPhoneMasked: string | null
  nip: string | null
  company: string | null
  status: 'active' | 'cancelled'
  cancelledAt: string | null
  cancelReason: string | null
  createdAt: string
}

export interface Promotion {
  id: number
  title: string
  description: string
  fuelIds: FuelId[]
  discountType: DiscountType
  discountValue: number
  requiresVitay: boolean
  minLiters: number | null
  conditions: string
  validFrom: string
  validTo: string | null
  status: 'draft' | 'active' | 'ended'
  createdBy: string
  updatedBy: string | null
  createdAt: string
  updatedAt: string
}

export interface PromotionEvent {
  id: number
  promotionId: number
  action: 'utworzona' | 'zmieniona' | 'wlaczona' | 'zakonczona'
  employee: string
  at: string
}

export type AnnouncementCategory =
  | 'wewnetrzny'
  | 'organizacyjny'
  | 'procedura'
  | 'awaria'
  | 'paliwowy'
  | 'publiczny'

export interface Announcement {
  id: number
  title: string
  body: string
  category: AnnouncementCategory
  visibility: 'internal' | 'public'
  important: boolean
  status: 'draft' | 'published' | 'hidden'
  publishedAt: string | null
  expiresAt: string | null
  author: string
  updatedAt: string
}

export interface PublicAnnouncement {
  id: number
  title: string
  body: string
  important: boolean
  publishedAt: string | null
}

export interface FuelPriceInfo {
  fuelId: FuelId
  price: number
  /** Null when the built-in default is still in use. */
  updatedAt: string | null
  updatedBy: string | null
}

export interface PanelData {
  me: Me
  shift: ShiftInfo | null
  registers: RegisterInfo[]
  prices: FuelPriceInfo[]
  announcements: Announcement[]
  promotions: Promotion[]
  fuelings: Fueling[]
  simulation: boolean
}

export interface FuelBreakdown {
  fuelId: FuelId
  fuelName: string
  count: number
  liters: number
  amount: number
}

export interface ShiftTotals {
  count: number
  liters: number
  grossAmount: number
  discountAmount: number
  amount: number
  vitayCard: number
  vitayTestCard: number
  vitayPhone: number
  vitayNone: number
  promotions: number
  cash: number
  card: number
  cancelledCount: number
  cancelledAmount: number
  byFuel: FuelBreakdown[]
}

export interface RegisterChangeInfo {
  from: string
  to: string
  reason: string
  approvedBy: string
  changedAt: string
}

export interface ShiftReport {
  shift: ShiftInfo
  totals: ShiftTotals
  fuelings: Fueling[]
  registerChanges: RegisterChangeInfo[]
  generatedAt: string
}

export interface ShiftListItem extends ShiftInfo {
  count: number
  liters: number
  amount: number
}

export interface EmployeeInfo {
  id: number
  login: string
  name: string
  role: Role
  active: boolean
  locked: boolean
  createdAt: string
}
