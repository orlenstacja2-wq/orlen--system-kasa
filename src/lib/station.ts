export const STATION = {
  name: 'ORLEN',
  street: 'Aleja Armii Krajowej 46',
  city: '35-307 Rzeszów',
  website: 'orlen.pl',
  number: '242564698',
} as const

/** Shown in the employee panel, on documents and reports. */
export const SYSTEM_NOTICE =
  'SYSTEM SŁUŻY WYŁĄCZNIE DO EWIDENCJONOWANIA I ROZLICZANIA TANKOWAŃ. NIE JEST PEŁNYM SYSTEMEM SPRZEDAŻY ANI FISKALNYM SYSTEMEM KASOWYM.'

/** Logo supplied by the station. Screens go through the Image CDN; print uses the file directly. */
export const LOGO_SRC = '/img/orlen-logo.png'
export const LOGO_RATIO = 350 / 260
export const logoUrl = (width: number) =>
  `/.netlify/images?url=${LOGO_SRC}&w=${width}&fm=webp`

export type Role = 'pracownik' | 'kierownik' | 'admin'
export const ROLE_LABEL: Record<Role, string> = {
  pracownik: 'Pracownik',
  kierownik: 'Kierownik stacji',
  admin: 'Administrator',
}
const ROLE_RANK: Record<Role, number> = { pracownik: 0, kierownik: 1, admin: 2 }
export const hasRole = (role: string, min: Role) =>
  (ROLE_RANK[role as Role] ?? -1) >= ROLE_RANK[min]

export const PUMPS = [1, 2, 3, 4, 5] as const

export type FuelId = 'pb95' | 'pb98' | 'on' | 'ona' | 'eko'

export interface Fuel {
  id: FuelId
  name: string
  /** Product family shown above the name. */
  group: string
  /** Short label for dispenser badges and the register display. */
  short: string
  /** Price per litre in PLN. Defaults below; managers set current prices in the admin panel. */
  price: number
  /** Badge classes for the fuel. */
  badge: string
}

export const FUELS: Fuel[] = [
  {
    id: 'pb95',
    name: 'Eurosuper 95',
    group: 'Benzyna bezołowiowa',
    short: 'PB 95',
    price: 5.675,
    badge: 'bg-emerald-600 text-white',
  },
  {
    id: 'pb98',
    name: 'Super Plus 98',
    group: 'Benzyna bezołowiowa',
    short: 'PB 98',
    price: 6.466,
    badge: 'bg-emerald-800 text-white',
  },
  {
    id: 'on',
    name: 'Ekodiesel',
    group: 'Olej Napędowy',
    short: 'ON',
    price: 7.233,
    badge: 'bg-neutral-900 text-white',
  },
  {
    id: 'ona',
    name: 'Arktyczny 2',
    group: 'Olej Napędowy',
    short: 'ON A2',
    price: 7.708,
    badge: 'bg-sky-700 text-white',
  },
  {
    id: 'eko',
    name: 'Grzewczy Ekoterm',
    group: 'Olej Napędowy',
    short: 'EKOTERM',
    price: 6.205,
    badge: 'bg-red-800 text-white',
  },
]

export const FUEL_IDS = FUELS.map((f) => f.id) as [FuelId, ...FuelId[]]

export type PriceMap = Partial<Record<FuelId, number>>

/** Fuel list with the current prices applied. */
export function withPrices(prices: PriceMap): Fuel[] {
  return FUELS.map((f) => ({ ...f, price: prices[f.id] ?? f.price }))
}

export function getFuel(id: FuelId, fuels: Fuel[] = FUELS): Fuel {
  return fuels.find((f) => f.id === id) ?? fuels[0]
}

export function fuelFullName(fuel: Fuel) {
  return fuel.group === 'Benzyna bezołowiowa'
    ? `${fuel.group} – ${fuel.name}`
    : `${fuel.group} ${fuel.name}`
}

/** Litres (2 dp) × price (3 dp), computed in integers and rounded to the grosz. */
export function calcAmount(liters: number, price: number) {
  const centiLiters = Math.round(liters * 100)
  const milliPrice = Math.round(price * 1000)
  return Math.round((centiLiters * milliPrice) / 1000) / 100
}

export type DiscountType = 'info' | 'per_liter' | 'percent'

/** Discount in PLN for a promotion; never more than the fill itself. */
export function calcDiscount(
  type: DiscountType,
  value: number,
  liters: number,
  gross: number,
) {
  let grosze = 0
  if (type === 'per_liter') {
    grosze = Math.round((Math.round(liters * 100) * Math.round(value * 1000)) / 1000)
  } else if (type === 'percent') {
    grosze = Math.round((Math.round(gross * 100) * value) / 100)
  }
  return Math.min(Math.max(0, grosze), Math.round(gross * 100)) / 100
}

export interface PromotionRule {
  status: string
  fuelIds: string[]
  requiresVitay: boolean
  minLiters: number | null
  validFrom: string
  validTo: string | null
}

/** True when a promotion is active now, covers the fuel and its conditions are met. */
export function promotionApplies(
  p: PromotionRule,
  ctx: { fuelId: FuelId; liters: number; vitayEligible: boolean; now: number },
) {
  if (p.status !== 'active') return false
  if (Date.parse(p.validFrom) > ctx.now) return false
  if (p.validTo && Date.parse(p.validTo) <= ctx.now) return false
  if (p.fuelIds.length > 0 && !p.fuelIds.includes(ctx.fuelId)) return false
  if (p.minLiters !== null && ctx.liters < p.minLiters) return false
  if (p.requiresVitay && !ctx.vitayEligible) return false
  return true
}

/** Gross VAT share for 23% PTU. */
export function vatOf(gross: number) {
  return Math.round(((gross * 23) / 123) * 100) / 100
}

/** Polish mobile number: 9 digits, optional +48 / 0048 prefix. Returns the 9 digits or null. */
export function normalizePhone(text: string) {
  let digits = text.replace(/[\s-]/g, '')
  if (digits.startsWith('+48')) digits = digits.slice(3)
  else if (digits.startsWith('0048')) digits = digits.slice(4)
  return /^[4-8]\d{8}$/.test(digits) ? digits : null
}

/** Only the last 3 digits are ever stored or shown. */
export const maskPhone = (digits: string) => `+48 *** *** ${digits.slice(-3)}`

/** VITAY card numbers typed by hand: 8–19 digits. */
export const VITAY_CARD_RE = /^\d{8,19}$/
export const TEST_CARD_PREFIX = 'TEST-'

export function maskCard(number: string, test: boolean) {
  const last = number.replace(/\D/g, '').slice(-4)
  return test ? `TEST •••• ${last}` : `•••• ${last}`
}

/** Random card number clearly marked as test data. Never a real customer card. */
export function randomTestCard() {
  const digits = Array.from({ length: 12 }, () =>
    Math.floor(Math.random() * 10),
  ).join('')
  return `${TEST_CARD_PREFIX}${digits}`
}

const pln = new Intl.NumberFormat('pl-PL', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const unitPrice = new Intl.NumberFormat('pl-PL', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
})

export const formatMoney = (n: number) => pln.format(n)
export const formatPLN = (n: number) => `${pln.format(n)} zł`
export const formatLiters = (n: number) => `${pln.format(n)} l`
export const formatUnitPrice = (n: number) => unitPrice.format(n)

/** Parses "42,5" or "42.5"; returns NaN for anything else. */
export function parseDecimal(text: string) {
  const clean = text.replace(/\s/g, '').replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(clean)) return NaN
  return Number(clean)
}

/** Keeps only digits and one decimal separator, with up to `maxInt` integer and 2 fraction digits. */
export function sanitizeDecimal(text: string, maxInt: number) {
  const normalized = text.replace('.', ',').replace(/[^\d,]/g, '')
  const [int = '', ...rest] = normalized.split(',')
  const fraction = rest.join('').slice(0, 2)
  const intPart = int.slice(0, maxInt)
  return normalized.includes(',') ? `${intPart},${fraction}` : intPart
}

export function toInputDecimal(n: number) {
  return n.toFixed(2).replace('.', ',')
}

export function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function formatDateTime(ts: number | string) {
  const t = typeof ts === 'string' ? Date.parse(ts) : ts
  return `${formatDate(t)} ${formatTime(t)}`
}

export function formatTime(ts: number, seconds = false) {
  return new Date(ts).toLocaleTimeString('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
  })
}

/** Legacy login code still used by the current login screen until server login is wired in. */
export const ACCESS_CODE = '2009'
