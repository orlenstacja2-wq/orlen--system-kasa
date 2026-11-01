import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Banknote,
  Check,
  CreditCard,
  FileText,
  FlaskConical,
  Loader2,
  Printer,
  Receipt as ReceiptIcon,
  Tag,
} from 'lucide-react'
import { toast } from 'sonner'

import { OrlenLogo } from '@/components/orlen-logo'
import { Receipt } from '@/components/receipt'
import { useNow } from '@/hooks/use-now'
import type { PumpTx } from '@/hooks/use-station'
import {
  PUMPS,
  TEST_CARD_PREFIX,
  VITAY_CARD_RE,
  calcAmount,
  calcDiscount,
  formatLiters,
  formatMoney,
  formatPLN,
  formatUnitPrice,
  getFuel,
  maskCard,
  maskPhone,
  normalizePhone,
  parseDecimal,
  promotionApplies,
  randomTestCard,
  sanitizeDecimal,
  toInputDecimal,
  type Fuel,
  type FuelId,
} from '@/lib/station'
import type {
  DocType,
  Fueling,
  PaymentMethod,
  Promotion,
  VitayMode,
} from '@/lib/types'
import { cn } from '@/lib/utils'
import { recordFueling } from '@/server/station.functions'

type Step =
  | 'pump'
  | 'fuel'
  | 'liters'
  | 'doc'
  | 'invoice'
  | 'vitay'
  | 'vitayCard'
  | 'vitayPhone'
  | 'promo'
  | 'payment'
  | 'cash'
  | 'card'
  | 'done'

interface Draft {
  pump: number | null
  txId: string | null
  fuelId: FuelId | null
  liters: string
  docType: DocType
  nip: string
  company: string
  vitayMode: VitayMode | null
  /** Card digits; `vitayTest` marks a generated test number. */
  vitayCard: string
  vitayTest: boolean
  vitayPhone: string
  promotionId: number | null
  payment: PaymentMethod | null
  cash: string
  /** Idempotency key: the same settlement is never saved twice. */
  clientRef: string
}

const EMPTY: Draft = {
  pump: null,
  txId: null,
  fuelId: null,
  liters: '',
  docType: 'paragon',
  nip: '',
  company: '',
  vitayMode: null,
  vitayCard: '',
  vitayTest: false,
  vitayPhone: '',
  promotionId: null,
  payment: null,
  cash: '',
  clientRef: '',
}

const newDraft = (patch: Partial<Draft>): Draft => ({
  ...EMPTY,
  clientRef: crypto.randomUUID(),
  ...patch,
})

const STAGES = [
  'Dystrybutor',
  'Paliwo',
  'Litry',
  'Dokument',
  'VITAY',
  'Promocja',
  'Płatność',
]
const STAGE_OF: Record<Step, number> = {
  pump: 0,
  fuel: 1,
  liters: 2,
  doc: 3,
  invoice: 3,
  vitay: 4,
  vitayCard: 4,
  vitayPhone: 4,
  promo: 5,
  payment: 6,
  cash: 6,
  card: 6,
  done: 7,
}

const DOCS: { id: DocType; label: string; key: string }[] = [
  { id: 'paragon', label: 'Potwierdzenie', key: 'P' },
  { id: 'faktura', label: 'Z danymi nabywcy', key: 'F' },
]
const PAYMENTS: { id: PaymentMethod; label: string; key: string }[] = [
  { id: 'gotowka', label: 'Gotówka', key: 'G' },
  { id: 'karta', label: 'Karta', key: 'K' },
]
const VITAY_OPTIONS: { mode: VitayMode; label: string; sub: string; key: string }[] = [
  { mode: 'card', label: 'TAK', sub: 'klient ma kartę', key: 'T' },
  { mode: 'none', label: 'NIE', sub: 'brak karty', key: 'N' },
  { mode: 'phone', label: 'TELEFON', sub: 'identyfikacja po numerze', key: 'P' },
]
const QUICK_CASH = [20, 50, 100, 200, 500]

const MAX_LITERS = 999

export function Register({
  pumps,
  fuels,
  promotions,
  shiftId,
  registerCode,
  selectPumpRef,
  onActivePumpChange,
  lock,
  onRecorded,
  onPrint,
}: {
  pumps: Record<number, PumpTx | null>
  /** Fuels with current prices. */
  fuels: Fuel[]
  /** Currently active promotions. */
  promotions: Promotion[]
  /** Every fill is saved against this open shift (and its register). */
  shiftId: number
  registerCode: string
  /** Filled by the register so dispenser cards can select a pump. */
  selectPumpRef: React.RefObject<((pump: number) => void) | null>
  onActivePumpChange: (pump: number | null) => void
  lock: (pump: number, locked: boolean) => void
  onRecorded: (fueling: Fueling, pumpTxId: string | null) => void
  onPrint: (sale: Fueling) => void
}) {
  const [step, setStep] = useState<Step>('pump')
  const [cursor, setCursor] = useState(0)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [finished, setFinished] = useState<Fueling | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const fieldRef = useRef<HTMLInputElement>(null)
  const companyRef = useRef<HTMLInputElement>(null)
  const now = useNow(30_000)

  const fuel = draft.fuelId ? getFuel(draft.fuelId, fuels) : null
  const liters = parseDecimal(draft.liters)
  const litersValid =
    Number.isFinite(liters) && liters > 0 && liters <= MAX_LITERS
  const gross = fuel && litersValid ? calcAmount(liters, fuel.price) : 0

  /** Promotions that apply to this fill for a given VITAY identification. */
  const promosFor = (mode: VitayMode | null, test: boolean) =>
    fuel && litersValid && now
      ? promotions.filter((p) =>
          promotionApplies(p, {
            fuelId: fuel.id,
            liters,
            // Test numbers never unlock VITAY benefits.
            vitayEligible: mode !== null && mode !== 'none' && !test,
            now,
          }),
        )
      : []
  const applicable = promosFor(draft.vitayMode, draft.vitayTest)
  const promo = applicable.find((p) => p.id === draft.promotionId) ?? null
  const discount = promo
    ? calcDiscount(promo.discountType, promo.discountValue, liters, gross)
    : 0
  const amount = Math.round((gross - discount) * 100) / 100
  const cashValue = draft.cash ? parseDecimal(draft.cash) : NaN
  const change =
    Number.isFinite(cashValue) && cashValue >= amount
      ? Math.round((cashValue - amount) * 100) / 100
      : null

  function go(next: Step, nextCursor = 0) {
    setStep(next)
    setCursor(nextCursor)
    setFieldError(null)
  }

  const reset = useCallback(() => {
    setDraft(EMPTY)
    setFinished(null)
    setFieldError(null)
    setStep('pump')
    setCursor(0)
  }, [])

  // Keep the pump's pending fill from expiring while it is being settled.
  const { pump: draftPump, txId: draftTxId } = draft
  useEffect(() => {
    if (draftPump === null || !draftTxId) return
    lock(draftPump, true)
    return () => lock(draftPump, false)
  }, [draftPump, draftTxId, lock])

  useEffect(() => {
    onActivePumpChange(step === 'done' ? null : draft.pump)
  }, [draft.pump, step, onActivePumpChange])

  // Focus the input of the current step.
  useEffect(() => {
    if (
      step === 'liters' ||
      step === 'invoice' ||
      step === 'cash' ||
      step === 'vitayCard' ||
      step === 'vitayPhone'
    ) {
      fieldRef.current?.focus()
      fieldRef.current?.select()
    }
  }, [step])

  // --- transitions -------------------------------------------------------

  function selectPump(pump: number) {
    const tx = pumps[pump]
    if (tx?.status === 'fueling') {
      toast.warning(`Dystrybutor ${pump}: tankowanie w toku`, {
        description: 'Poczekaj, aż klient zakończy tankowanie.',
      })
      setCursor(pump - 1)
      return
    }
    if (tx) {
      setDraft(
        newDraft({
          pump,
          txId: tx.id,
          fuelId: tx.fuelId,
          liters: toInputDecimal(tx.liters),
        }),
      )
      go('liters')
    } else {
      setDraft(newDraft({ pump }))
      go('fuel', 0)
    }
  }

  function selectFuel(id: FuelId) {
    setDraft((d) => ({ ...d, fuelId: id }))
    go('liters')
  }

  function confirmLiters() {
    if (!litersValid) {
      setFieldError(`Podaj liczbę litrów od 0,01 do ${MAX_LITERS}`)
      return
    }
    go('doc', draft.docType === 'faktura' ? 1 : 0)
  }

  function selectDoc(docType: DocType) {
    setDraft((d) => ({ ...d, docType }))
    if (docType === 'faktura') go('invoice')
    else go('vitay', 0)
  }

  function confirmInvoice() {
    if (draft.nip.length !== 10) {
      setFieldError('NIP musi mieć 10 cyfr')
      fieldRef.current?.focus()
      return
    }
    if (!draft.company.trim()) {
      setFieldError('Podaj nazwę nabywcy')
      companyRef.current?.focus()
      return
    }
    go('vitay', 0)
  }

  function selectVitay(mode: VitayMode) {
    setDraft((d) => ({
      ...d,
      vitayMode: mode,
      ...(mode !== 'card' && { vitayCard: '', vitayTest: false }),
      ...(mode !== 'phone' && { vitayPhone: '' }),
    }))
    if (mode === 'card') go('vitayCard')
    else if (mode === 'phone') go('vitayPhone')
    else afterVitay('none', false)
  }

  /** Promotion step only when at least one promotion applies. */
  function afterVitay(mode: VitayMode, test: boolean) {
    const list = promosFor(mode, test)
    if (list.length > 0) {
      const idx = list.findIndex((p) => p.id === draft.promotionId)
      go('promo', idx >= 0 ? idx : 0)
    } else {
      go('payment', draft.payment === 'karta' ? 1 : 0)
    }
  }

  function generateTestCard() {
    const digits = randomTestCard().slice(TEST_CARD_PREFIX.length)
    setFieldError(null)
    setDraft((d) => ({ ...d, vitayCard: digits, vitayTest: true }))
    fieldRef.current?.focus()
  }

  function confirmCard() {
    if (!VITAY_CARD_RE.test(draft.vitayCard)) {
      setFieldError('Numer karty VITAY: 8–19 cyfr')
      return
    }
    afterVitay('card', draft.vitayTest)
  }

  function confirmPhone() {
    if (!normalizePhone(draft.vitayPhone)) {
      setFieldError('Podaj 9-cyfrowy numer komórkowy (np. 600 100 200)')
      return
    }
    afterVitay('phone', false)
  }

  function selectPromo(id: number | null) {
    setDraft((d) => ({ ...d, promotionId: id }))
    go('payment', draft.payment === 'karta' ? 1 : 0)
  }

  function selectPayment(payment: PaymentMethod) {
    setDraft((d) => ({ ...d, payment, cash: '' }))
    go(payment === 'gotowka' ? 'cash' : 'card')
  }

  async function finish(cashGiven: number | null) {
    if (!fuel || draft.pump === null || !draft.payment || !draft.vitayMode)
      return
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      const sale = await recordFueling({
        data: {
          clientRef: draft.clientRef,
          shiftId,
          pump: draft.pump,
          fuelId: fuel.id,
          liters,
          docType: draft.docType,
          nip: draft.docType === 'faktura' ? draft.nip : undefined,
          company:
            draft.docType === 'faktura' ? draft.company.trim() : undefined,
          vitayMode: draft.vitayMode,
          vitayCard:
            draft.vitayMode === 'card'
              ? `${draft.vitayTest ? TEST_CARD_PREFIX : ''}${draft.vitayCard}`
              : undefined,
          vitayPhone:
            draft.vitayMode === 'phone' ? draft.vitayPhone : undefined,
          promotionId: promo?.id ?? null,
          payment: draft.payment,
          cashGiven,
        },
      })
      onRecorded(sale, draft.txId)
      setFinished(sale)
      go('done')
      if (Math.round(sale.amount * 100) !== Math.round(amount * 100)) {
        toast.warning('Kwota przeliczona według aktualnego cennika', {
          description: `Zapisano ${formatPLN(sale.amount)}`,
        })
      }
      toast.success(`Tankowanie ${sale.docNumber} zarejestrowane`, {
        description: `Dystrybutor ${sale.pump} · ${formatPLN(sale.amount)}`,
      })
    } catch (err) {
      toast.error('Nie zapisano tankowania', {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  function confirmCash() {
    if (!draft.cash) {
      finish(amount)
      return
    }
    if (!Number.isFinite(cashValue) || cashValue < amount) {
      setFieldError('Kwota przyjęta jest niższa niż kwota do zapłaty')
      return
    }
    finish(cashValue)
  }

  function printAndReset() {
    if (finished) onPrint(finished)
    reset()
  }

  function vitayBack() {
    if (draft.vitayMode === 'card') return go('vitayCard')
    if (draft.vitayMode === 'phone') return go('vitayPhone')
    return go('vitay', 1)
  }

  function back() {
    if (saving) return
    switch (step) {
      case 'fuel':
        setDraft(EMPTY)
        return go('pump', (draft.pump ?? 1) - 1)
      case 'liters':
        return go(
          'fuel',
          Math.max(
            0,
            fuels.findIndex((f) => f.id === draft.fuelId),
          ),
        )
      case 'doc':
        return go('liters')
      case 'invoice':
        return go('doc', 1)
      case 'vitay':
        return draft.docType === 'faktura' ? go('invoice') : go('doc', 0)
      case 'vitayCard':
        return go('vitay', 0)
      case 'vitayPhone':
        return go('vitay', 2)
      case 'promo':
        return vitayBack()
      case 'payment':
        return applicable.length > 0
          ? go(
              'promo',
              promo ? applicable.indexOf(promo) : applicable.length,
            )
          : vitayBack()
      case 'cash':
      case 'card':
        return go('payment', step === 'card' ? 1 : 0)
      case 'done':
        return reset()
    }
  }

  // Dispenser cards on the main screen select a pump.
  const handleExternalPump = (pump: number) => {
    if (step === 'pump' || step === 'fuel' || step === 'liters') {
      selectPump(pump)
    } else {
      toast.info('Zakończ bieżącą transakcję', {
        description: 'Naciśnij ESC, aby wrócić do wcześniejszych kroków.',
      })
    }
  }
  useEffect(() => {
    selectPumpRef.current = handleExternalPump
  })

  // --- keyboard ----------------------------------------------------------

  const handleKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null
    // Dialogs (cancel, end of shift…) handle their own keys.
    if (target?.closest?.('[data-slot="dialog-content"]')) return
    if (saving) {
      if (e.key === 'Enter') e.preventDefault()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      back()
      return
    }
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'))
      return
    if (e.ctrlKey || e.metaKey || e.altKey) return

    const key = e.key.toLowerCase()
    const move = (count: number) => {
      if (['arrowright', 'arrowdown'].includes(key)) {
        e.preventDefault()
        setCursor((c) => (c + 1) % count)
        return true
      }
      if (['arrowleft', 'arrowup'].includes(key)) {
        e.preventDefault()
        setCursor((c) => (c - 1 + count) % count)
        return true
      }
      return false
    }
    const enter = key === 'enter' && !e.repeat
    if (key === 'enter') e.preventDefault()

    switch (step) {
      case 'pump': {
        if (move(PUMPS.length)) return
        const n = Number(e.key)
        if (n >= 1 && n <= PUMPS.length) return selectPump(n)
        if (enter) return selectPump(PUMPS[cursor])
        return
      }
      case 'fuel': {
        if (move(fuels.length)) return
        const n = Number(e.key)
        if (n >= 1 && n <= fuels.length) return selectFuel(fuels[n - 1].id)
        if (enter) return selectFuel(fuels[cursor].id)
        return
      }
      case 'doc':
        if (move(DOCS.length)) return
        if (key === 'p' || key === '1') return selectDoc('paragon')
        if (key === 'f' || key === '2') return selectDoc('faktura')
        if (enter) return selectDoc(DOCS[cursor].id)
        return
      case 'vitay':
        if (move(VITAY_OPTIONS.length)) return
        for (const [i, o] of VITAY_OPTIONS.entries()) {
          if (key === o.key.toLowerCase() || key === String(i + 1))
            return selectVitay(o.mode)
        }
        if (enter) return selectVitay(VITAY_OPTIONS[cursor].mode)
        return
      case 'promo': {
        const options = [...applicable.map((p) => p.id), null]
        if (move(options.length)) return
        const n = Number(e.key)
        if (n >= 1 && n <= applicable.length) return selectPromo(options[n - 1])
        if (key === '0') return selectPromo(null)
        if (enter) return selectPromo(options[cursor] ?? null)
        return
      }
      case 'payment':
        if (move(PAYMENTS.length)) return
        if (key === 'g' || key === '1') return selectPayment('gotowka')
        if (key === 'k' || key === '2') return selectPayment('karta')
        if (enter) return selectPayment(PAYMENTS[cursor].id)
        return
      case 'card':
        if (enter) finish(null)
        return
      case 'done':
        if (enter) return printAndReset()
        if (key === 'p' && finished) onPrint(finished)
        if (key === 'n') return reset()
        return
      default:
        // Typing a digit while the field lost focus brings focus back to it.
        if (/^[\d,.]$/.test(e.key)) fieldRef.current?.focus()
    }
  }
  const keyRef = useRef(handleKey)
  useEffect(() => {
    keyRef.current = handleKey
  })
  useEffect(() => {
    const listener = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  // --- view --------------------------------------------------------------

  const stage = STAGE_OF[step]

  return (
    <section
      aria-labelledby="register-title"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm"
    >
      <header className="flex items-center justify-between border-b px-5 py-3">
        <h2
          id="register-title"
          className="font-display text-2xl font-bold tracking-tight"
        >
          Rozliczenie tankowania
        </h2>
        <span className="rounded-md bg-foreground px-2 py-1 text-xs font-bold tracking-widest text-background uppercase">
          Kasa {registerCode}
        </span>
      </header>

      {/* Customer display */}
      <div className="mx-5 mt-4 rounded-xl bg-lcd p-4 font-mono text-lcd-foreground shadow-inner">
        <div className="flex justify-between text-xs tracking-wider text-lcd-foreground/60 uppercase">
          <span>Dystr. {draft.pump ?? '–'}</span>
          <span>{fuel ? fuel.short : 'Paliwo –'}</span>
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <span className="text-xs tracking-wider text-lcd-foreground/60 uppercase">
            Do zapłaty
          </span>
          <span className="text-4xl font-bold tabular-nums" aria-live="polite">
            {formatMoney(amount)}
            <span className="ml-1 text-lg text-lcd-foreground/70">zł</span>
          </span>
        </div>
        <div className="mt-1 flex justify-between text-sm text-lcd-foreground/80 tabular-nums">
          <span>{litersValid ? formatLiters(liters) : '0,00 l'}</span>
          <span>{fuel ? `${formatUnitPrice(fuel.price)} zł/l` : '—'}</span>
        </div>
        {discount > 0 && (
          <div className="mt-1 flex justify-between text-sm text-warning tabular-nums">
            <span className="truncate">Rabat: {promo?.title}</span>
            <span>-{formatMoney(discount)}</span>
          </div>
        )}
        {(step === 'cash' ||
          (finished?.payment === 'gotowka' && step === 'done')) && (
          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-lcd-foreground/15 pt-2 text-sm tabular-nums">
            <span>
              Przyjęto:{' '}
              <strong>
                {formatMoney(
                  finished?.cashGiven ??
                    (Number.isFinite(cashValue) ? cashValue : amount),
                )}
              </strong>
            </span>
            <span className="text-right">
              Reszta:{' '}
              <strong className="text-warning">
                {formatMoney(finished?.change ?? change ?? 0)}
              </strong>
            </span>
          </div>
        )}
      </div>

      {/* Progress */}
      <ol
        className="mx-5 mt-4 grid grid-cols-7 gap-1"
        aria-label="Etapy transakcji"
      >
        {STAGES.map((label, i) => (
          <li key={label} className="flex flex-col gap-1">
            <span
              className={cn(
                'h-1.5 rounded-full transition-colors motion-reduce:transition-none',
                i < stage
                  ? 'bg-primary'
                  : i === stage
                    ? 'bg-primary/50'
                    : 'bg-muted',
              )}
            />
            <span
              className={cn(
                'truncate text-[10px] font-semibold tracking-wide uppercase',
                i === stage ? 'text-primary' : 'text-muted-foreground',
              )}
              aria-current={i === stage ? 'step' : undefined}
            >
              {label}
            </span>
          </li>
        ))}
      </ol>

      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        {step === 'pump' && (
          <StepBlock
            title="Wybierz dystrybutor"
            hint="Cyfry 1–5 lub strzałki + ENTER"
          >
            <div className="grid grid-cols-5 gap-2">
              {PUMPS.map((p, i) => {
                const tx = pumps[p]
                return (
                  <Option
                    key={p}
                    selected={cursor === i}
                    onClick={() => selectPump(p)}
                    className="h-24 flex-col"
                  >
                    <span className="font-display text-4xl font-extrabold">
                      {p}
                    </span>
                    <span className="text-[10px] font-semibold uppercase opacity-80">
                      {!tx
                        ? 'wolny'
                        : tx.status === 'fueling'
                          ? 'tankuje'
                          : formatMoney(tx.amount)}
                    </span>
                  </Option>
                )
              })}
            </div>
          </StepBlock>
        )}

        {step === 'fuel' && (
          <StepBlock title="Rodzaj paliwa" hint="Cyfry 1–5 lub ↑ ↓ + ENTER">
            <div className="flex flex-col gap-2">
              {fuels.map((f, i) => (
                <Option
                  key={f.id}
                  selected={cursor === i}
                  onClick={() => selectFuel(f.id)}
                  className="justify-between px-4 py-3"
                >
                  <span className="flex items-center gap-3 text-left">
                    <Kbd>{i + 1}</Kbd>
                    <span className="leading-tight">
                      <span className="block font-semibold">{f.name}</span>
                      <span className="block text-xs opacity-75">
                        {f.group}
                      </span>
                    </span>
                  </span>
                  <span className="font-display text-xl font-bold tabular-nums">
                    {formatUnitPrice(f.price)}
                  </span>
                </Option>
              ))}
            </div>
          </StepBlock>
        )}

        {step === 'liters' && fuel && (
          <StepBlock
            title="Liczba litrów"
            hint={
              draft.txId
                ? 'Dane z dystrybutora – ENTER, aby potwierdzić'
                : 'Wpisz litry i naciśnij ENTER'
            }
          >
            <form
              onSubmit={(e) => {
                e.preventDefault()
                confirmLiters()
              }}
            >
              <NumberField
                ref={fieldRef}
                id="liters"
                label={`${fuel.name} · ${formatUnitPrice(fuel.price)} zł/l`}
                suffix="l"
                value={draft.liters}
                error={fieldError}
                onChange={(v) => {
                  setFieldError(null)
                  setDraft((d) => ({ ...d, liters: sanitizeDecimal(v, 3) }))
                }}
              />
              <p className="mt-3 flex justify-between rounded-lg bg-muted px-4 py-3 text-sm">
                <span className="text-muted-foreground">
                  Wartość tankowania
                </span>
                <strong className="font-display text-xl tabular-nums">
                  {formatPLN(gross)}
                </strong>
              </p>
            </form>
          </StepBlock>
        )}

        {step === 'doc' && (
          <StepBlock title="Rodzaj dokumentu" hint="P / F lub ← → + ENTER">
            <div className="grid grid-cols-2 gap-3">
              {DOCS.map((doc, i) => (
                <Option
                  key={doc.id}
                  selected={cursor === i}
                  onClick={() => selectDoc(doc.id)}
                  className="h-28 flex-col gap-2"
                >
                  {doc.id === 'paragon' ? (
                    <ReceiptIcon className="size-7" />
                  ) : (
                    <FileText className="size-7" />
                  )}
                  <span className="font-display text-xl font-bold">
                    {doc.label}
                  </span>
                  <Kbd>{doc.key}</Kbd>
                </Option>
              ))}
            </div>
          </StepBlock>
        )}

        {step === 'invoice' && (
          <StepBlock
            title="Dane nabywcy (do faktury)"
            hint="Po 10 cyfrach NIP kursor przechodzi dalej"
          >
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                confirmInvoice()
              }}
            >
              <NumberField
                ref={fieldRef}
                id="nip"
                label="NIP nabywcy"
                value={draft.nip}
                inputMode="numeric"
                onChange={(v) => {
                  const nip = v.replace(/\D/g, '').slice(0, 10)
                  setFieldError(null)
                  setDraft((d) => ({ ...d, nip }))
                  if (nip.length === 10) companyRef.current?.focus()
                }}
                onEnter={() =>
                  draft.nip.length === 10
                    ? companyRef.current?.focus()
                    : setFieldError('NIP musi mieć 10 cyfr')
                }
              />
              <div>
                <label htmlFor="company" className="text-sm font-semibold">
                  Nazwa nabywcy
                </label>
                <input
                  ref={companyRef}
                  id="company"
                  value={draft.company}
                  onChange={(e) => {
                    setFieldError(null)
                    setDraft((d) => ({ ...d, company: e.target.value }))
                  }}
                  autoComplete="off"
                  className="mt-1 h-12 w-full rounded-lg border-2 border-input bg-card px-3 text-lg outline-none focus:border-primary"
                />
              </div>
              {fieldError && (
                <p
                  className="text-sm font-semibold text-destructive"
                  role="alert"
                >
                  {fieldError}
                </p>
              )}
              <button type="submit" className="sr-only">
                Dalej
              </button>
            </form>
          </StepBlock>
        )}

        {(step === 'vitay' || step === 'payment') && (
          <StepBlock title="Metoda płatności" hint="G / K lub ← → + ENTER">
            <div className="grid grid-cols-2 gap-3">
              {PAYMENTS.map((p, i) => (
                <Option
                  key={p.id}
                  selected={step === 'payment' && cursor === i}
                  onClick={() => step === 'payment' && selectPayment(p.id)}
                  className="h-32 flex-col gap-2"
                >
                  {p.id === 'gotowka' ? (
                    <Banknote className="size-8" />
                  ) : (
                    <CreditCard className="size-8" />
                  )}
                  <span className="font-display text-2xl font-bold">
                    {p.label}
                  </span>
                  <Kbd>{p.key}</Kbd>
                </Option>
              ))}
            </div>
            {draft.vitayMode !== null && (
              <p className="mt-3 text-sm text-muted-foreground">
                VITAY:{' '}
                <strong className="text-foreground">
                  {draft.vitayMode === 'none'
                    ? 'NIE'
                    : draft.vitayMode === 'phone'
                      ? `telefon ${normalizePhone(draft.vitayPhone) ? maskPhone(normalizePhone(draft.vitayPhone)!) : ''}`
                      : maskCard(draft.vitayCard, draft.vitayTest)}
                </strong>
                {draft.vitayTest && (
                  <span className="ml-2 rounded bg-warning/20 px-1.5 py-0.5 text-xs font-bold">
                    TESTOWY
                  </span>
                )}
                {promo && (
                  <>
                    {' · '}Promocja:{' '}
                    <strong className="text-foreground">{promo.title}</strong>
                  </>
                )}
              </p>
            )}
          </StepBlock>
        )}

        {step === 'vitayCard' && (
          <StepBlock
            title="Numer karty ORLEN VITAY"
            hint="Wpisz numer i naciśnij ENTER"
          >
            <form
              onSubmit={(e) => {
                e.preventDefault()
                confirmCard()
              }}
            >
              <NumberField
                ref={fieldRef}
                id="vitay-card"
                label={
                  draft.vitayTest
                    ? 'Numer testowy (wygenerowany)'
                    : 'Numer karty z karty klienta'
                }
                inputMode="numeric"
                value={draft.vitayCard}
                error={fieldError}
                onChange={(v) => {
                  setFieldError(null)
                  setDraft((d) => ({
                    ...d,
                    vitayCard: v.replace(/\D/g, '').slice(0, 19),
                    vitayTest: false,
                  }))
                }}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={generateTestCard}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed py-2.5 text-sm font-semibold hover:border-primary hover:text-primary"
              >
                <FlaskConical className="size-4" />
                Generuj losowy numer testowy
              </button>
              {draft.vitayTest && (
                <p className="mt-3 rounded-lg border border-warning bg-warning/15 px-3 py-2 text-sm">
                  <strong>NUMER TESTOWY.</strong> To nie jest karta klienta.
                  Punkty i korzyści VITAY nie są przyznawane, a promocje
                  wymagające karty są niedostępne.
                </p>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Tryb testowy: system nie jest połączony z ORLEN VITAY i nie
                weryfikuje numeru. Zapisywane są tylko 4 ostatnie cyfry.
              </p>
            </form>
          </StepBlock>
        )}

        {step === 'vitayPhone' && (
          <StepBlock
            title="Identyfikacja po numerze telefonu"
            hint="Wpisz numer i naciśnij ENTER"
          >
            <form
              onSubmit={(e) => {
                e.preventDefault()
                confirmPhone()
              }}
            >
              <NumberField
                ref={fieldRef}
                id="vitay-phone"
                label="Numer telefonu komórkowego klienta"
                inputMode="tel"
                placeholder="600 100 200"
                value={draft.vitayPhone}
                error={fieldError}
                onChange={(v) => {
                  setFieldError(null)
                  setDraft((d) => ({
                    ...d,
                    vitayPhone: v.replace(/[^\d+\s-]/g, '').slice(0, 16),
                  }))
                }}
              />
              <p className="mt-3 text-xs text-muted-foreground">
                Numer nie jest weryfikowany w ORLEN VITAY (brak integracji).
                Na dokumentach i w raportach widać tylko 3 ostatnie cyfry,
                pełny numer nie jest zapisywany.
              </p>
            </form>
          </StepBlock>
        )}

        {step === 'promo' && (
          <StepBlock
            title="Promocja paliwowa"
            hint="Cyfry 1–9, 0 = bez promocji, ↑ ↓ + ENTER"
          >
            <div className="flex flex-col gap-2">
              {[...applicable, null].map((p, i) => (
                <Option
                  key={p?.id ?? 'none'}
                  selected={cursor === i}
                  onClick={() => selectPromo(p?.id ?? null)}
                  className="justify-between gap-3 px-4 py-3"
                >
                  <span className="flex min-w-0 items-center gap-3 text-left">
                    <Kbd>{p ? i + 1 : 0}</Kbd>
                    <span className="min-w-0 leading-tight">
                      <span className="block truncate font-semibold">
                        {p ? p.title : 'Bez promocji'}
                      </span>
                      {p?.conditions && (
                        <span className="block truncate text-xs opacity-75">
                          {p.conditions}
                        </span>
                      )}
                    </span>
                  </span>
                  {p && (
                    <span className="shrink-0 font-display text-lg font-bold tabular-nums">
                      {p.discountType === 'info'
                        ? 'informacyjna'
                        : `-${formatMoney(calcDiscount(p.discountType, p.discountValue, liters, gross))} zł`}
                    </span>
                  )}
                </Option>
              ))}
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Tag className="size-3.5" />
              Lista obejmuje promocje aktywne teraz dla tego paliwa i ilości.
            </p>
          </StepBlock>
        )}

        {step === 'cash' && (
          <StepBlock
            title="Płatność gotówką"
            hint="ENTER bez kwoty = odliczona kwota"
          >
            <form
              onSubmit={(e) => {
                e.preventDefault()
                confirmCash()
              }}
            >
              <NumberField
                ref={fieldRef}
                id="cash"
                label="Kwota przyjęta od klienta"
                suffix="zł"
                placeholder={formatMoney(amount)}
                value={draft.cash}
                error={fieldError}
                onChange={(v) => {
                  setFieldError(null)
                  setDraft((d) => ({ ...d, cash: sanitizeDecimal(v, 5) }))
                }}
              />
              <div className="mt-3 grid grid-cols-5 gap-2">
                {QUICK_CASH.filter((c) => c >= amount).map((c) => (
                  <button
                    key={c}
                    type="button"
                    tabIndex={-1}
                    onClick={() => {
                      setDraft((d) => ({ ...d, cash: String(c) }))
                      fieldRef.current?.focus()
                    }}
                    className="rounded-lg border-2 py-2 font-semibold tabular-nums hover:border-primary hover:text-primary"
                  >
                    {c} zł
                  </button>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between rounded-lg bg-accent px-4 py-3">
                <span className="font-semibold text-accent-foreground">
                  Reszta do wydania
                </span>
                <strong className="font-display text-3xl tabular-nums">
                  {change === null ? '—' : formatPLN(change)}
                </strong>
              </div>
            </form>
          </StepBlock>
        )}

        {step === 'card' && (
          <StepBlock
            title="Płatność kartą"
            hint="ENTER – płatność zaakceptowana"
          >
            <button
              type="button"
              tabIndex={-1}
              onClick={() => finish(null)}
              disabled={saving}
              className="flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed border-primary/40 bg-accent/50 py-8 text-center"
            >
              <CreditCard className="size-10 text-primary" />
              <span className="font-display text-xl font-bold">
                Przeprowadź płatność w terminalu płatniczym
              </span>
              <span className="max-w-sm text-sm text-muted-foreground">
                Kwota {formatPLN(amount)}. Gdy terminal potwierdzi płatność,
                naciśnij ENTER lub kliknij tutaj.
              </span>
            </button>
            <p className="mt-3 text-xs text-muted-foreground">
              System nie jest połączony z terminalem – potwierdzasz wynik
              płatności ręcznie.
            </p>
          </StepBlock>
        )}

        {step === 'done' && finished && (
          <div className="flex flex-col items-center gap-3">
            <p className="flex items-center gap-2 font-display text-xl font-bold text-success">
              <Check className="size-6" />
              Tankowanie zarejestrowane
            </p>
            <div className="max-h-72 overflow-auto rounded-md border shadow-sm">
              <Receipt sale={finished} />
            </div>
            <div className="grid w-full grid-cols-2 gap-2">
              <button
                type="button"
                tabIndex={-1}
                onClick={printAndReset}
                className="flex items-center justify-center gap-2 rounded-lg bg-primary py-3 font-semibold text-primary-foreground hover:bg-primary/90"
              >
                <Printer className="size-4" /> Drukuj i dalej{' '}
                <Kbd inverted>ENTER</Kbd>
              </button>
              <button
                type="button"
                tabIndex={-1}
                onClick={reset}
                className="flex items-center justify-center gap-2 rounded-lg border-2 py-3 font-semibold hover:border-primary"
              >
                Bez wydruku <Kbd>N</Kbd>
              </button>
            </div>
          </div>
        )}
      </div>

      {saving && (
        <p
          role="status"
          className="flex items-center justify-center gap-2 border-t bg-accent px-5 py-2 text-sm font-semibold text-accent-foreground"
        >
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
          Zapisywanie tankowania…
        </p>
      )}
      <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t bg-muted/50 px-5 py-2.5 text-xs text-muted-foreground">
        <span>
          <Kbd>ENTER</Kbd> zatwierdź
        </span>
        <span>
          <Kbd>ESC</Kbd> cofnij
        </span>
        <span>
          <Kbd>↑↓←→</Kbd> wybór
        </span>
        <span>
          <Kbd>0–9</Kbd> szybkie wpisywanie
        </span>
        <span>
          <Kbd>F10</Kbd> wyloguj
        </span>
      </footer>

      {step === 'vitay' && (
        <VitayPrompt
          cursor={cursor}
          amount={amount}
          onSelect={selectVitay}
          onHover={setCursor}
        />
      )}
    </section>
  )
}

function VitayPrompt({
  cursor,
  amount,
  onSelect,
  onHover,
}: {
  cursor: number
  amount: number
  onSelect: (mode: VitayMode) => void
  onHover: (index: number) => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="vitay-question"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-auto bg-primary px-6 py-24 text-primary-foreground animate-in fade-in duration-200 motion-reduce:animate-none"
    >
      <OrlenLogo inverted width={90} className="absolute top-6 left-8 h-20" />
      <p className="absolute top-10 right-8 font-display text-xl font-semibold text-white/80 tabular-nums">
        Do zapłaty: {formatPLN(amount)}
      </p>
      <p className="font-display text-lg font-semibold tracking-[0.35em] text-white/70 uppercase">
        Karta lojalnościowa
      </p>
      <h2
        id="vitay-question"
        className="mt-4 max-w-5xl text-center font-display text-5xl leading-tight font-extrabold md:text-7xl"
      >
        Czy klient posiada kartę ORLEN VITAY?
      </h2>
      <div className="mt-14 grid w-full max-w-5xl grid-cols-1 gap-6 sm:grid-cols-3">
        {VITAY_OPTIONS.map((o, i) => (
          <button
            key={o.mode}
            type="button"
            tabIndex={-1}
            onClick={() => onSelect(o.mode)}
            onMouseEnter={() => onHover(i)}
            className={cn(
              'flex h-44 flex-col items-center justify-center gap-2 rounded-3xl border-4 font-display font-extrabold transition-all motion-reduce:transition-none',
              o.label.length > 3 ? 'text-5xl' : 'text-7xl',
              cursor === i
                ? 'scale-105 border-white bg-white text-primary shadow-2xl'
                : 'border-white/40 bg-white/5 text-white hover:border-white/70',
            )}
            aria-pressed={cursor === i}
          >
            {o.label}
            <span className="font-sans text-base font-semibold opacity-80">
              {o.sub}
            </span>
            <span
              className={cn(
                'rounded-md border px-2 py-0.5 font-mono text-sm font-semibold',
                cursor === i ? 'border-primary/30' : 'border-white/40',
              )}
            >
              {o.key}
            </span>
          </button>
        ))}
      </div>
      <p className="mt-10 text-lg text-white/80">
        <Kbd inverted>← →</Kbd> wybierz · <Kbd inverted>ENTER</Kbd> zatwierdź ·{' '}
        <Kbd inverted>ESC</Kbd> wróć
      </p>
      <p className="mt-4 max-w-2xl text-center text-sm text-white/70">
        Tryb testowy VITAY: brak połączenia z systemem ORLEN VITAY. Numery kart
        i telefonów nie są weryfikowane, a punkty nie są naliczane.
      </p>
    </div>
  )
}

function StepBlock({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div className="animate-in fade-in slide-in-from-right-2 duration-200 motion-reduce:animate-none">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="font-display text-xl font-bold">{title}</h3>
        <span className="text-right text-xs text-muted-foreground">{hint}</span>
      </div>
      {children}
    </div>
  )
}

function Option({
  selected,
  onClick,
  className,
  children,
}: {
  selected: boolean
  onClick: () => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'flex items-center justify-center rounded-xl border-2 transition-colors motion-reduce:transition-none',
        selected
          ? 'border-primary bg-primary text-primary-foreground shadow-md'
          : 'border-border bg-card hover:border-primary/60',
        className,
      )}
    >
      {children}
    </button>
  )
}

function Kbd({
  children,
  inverted = false,
}: {
  children: React.ReactNode
  inverted?: boolean
}) {
  return (
    <kbd
      className={cn(
        'inline-flex min-w-6 items-center justify-center rounded border px-1.5 py-0.5 font-mono text-[11px] font-semibold',
        inverted
          ? 'border-white/40 text-inherit'
          : 'border-border bg-card text-foreground',
      )}
    >
      {children}
    </kbd>
  )
}

function NumberField({
  ref,
  id,
  label,
  value,
  onChange,
  onEnter,
  suffix,
  placeholder,
  error,
  inputMode = 'decimal',
}: {
  ref: React.Ref<HTMLInputElement>
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  onEnter?: () => void
  suffix?: string
  placeholder?: string
  error?: string | null
  inputMode?: 'decimal' | 'numeric' | 'tel'
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <div
        className={cn(
          'mt-1 flex items-center rounded-lg border-2 bg-card px-3 focus-within:border-primary',
          error ? 'border-destructive' : 'border-input',
        )}
      >
        <input
          ref={ref}
          id={id}
          value={value}
          inputMode={inputMode}
          autoComplete="off"
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (onEnter && e.key === 'Enter') {
              e.preventDefault()
              onEnter()
            }
          }}
          aria-invalid={!!error}
          className="h-16 w-full bg-transparent font-display text-4xl font-bold tabular-nums outline-none placeholder:text-muted-foreground/40"
        />
        {suffix && (
          <span className="font-display text-2xl font-semibold text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
      {error && onEnter === undefined && (
        <p
          className="mt-1.5 text-sm font-semibold text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  )
}
