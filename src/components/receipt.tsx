import { createPortal } from 'react-dom'
import { useEffect } from 'react'

import { OrlenLogo } from '@/components/orlen-logo'
import type { Fueling } from '@/lib/types'
import {
  STATION,
  SYSTEM_NOTICE,
  formatDate,
  formatMoney,
  formatTime,
  formatUnitPrice,
  fuelFullName,
  getFuel,
  vatOf,
} from '@/lib/station'

export const PAYMENT_LABEL = {
  gotowka: 'Gotówka',
  karta: 'Karta płatnicza',
} as const

function Row({
  label,
  value,
  bold = false,
}: {
  label: string
  value: string
  bold?: boolean
}) {
  return (
    <div
      className="flex justify-between gap-2"
      style={bold ? { fontWeight: 700 } : undefined}
    >
      <span>{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )
}

const Divider = () => (
  <div className="my-[1.6mm] border-t border-dashed border-black" />
)

export function vitayLabel(f: Fueling) {
  if (f.vitayMode === 'none') return 'NIE'
  if (f.vitayMode === 'phone') return `TEL. ${f.vitayPhoneMasked ?? ''}`
  return f.vitayCardMasked ?? 'TAK'
}

/**
 * 57 mm fill confirmation. Not a fiscal receipt: the fiscal document comes
 * from the station's certified fiscal printer. Sized in millimetres so the
 * screen preview and print match.
 */
export function Receipt({ sale }: { sale: Fueling }) {
  const fuel = getFuel(sale.fuelId)
  const vat = vatOf(sale.amount)
  const withBuyer = sale.docType === 'faktura'
  const cancelled = sale.status === 'cancelled'
  const issuedAt = Date.parse(sale.createdAt)

  return (
    <div
      className="bg-white font-mono text-black"
      style={{
        width: '57mm',
        padding: '3mm 3mm 5mm',
        fontSize: '7.6pt',
        lineHeight: 1.35,
      }}
    >
      <div className="flex flex-col items-center text-center">
        <OrlenLogo print className="mb-[1.5mm] h-[14mm]" />
        <div>Stacja paliw</div>
        <div>{STATION.street}</div>
        <div>{STATION.city}</div>
        <div>Numer: {STATION.number}</div>
        <div>{STATION.website}</div>
      </div>
      <Divider />
      <Row label={formatDate(issuedAt)} value={formatTime(issuedAt, true)} />
      <div className="text-center font-bold" style={{ fontSize: '9pt' }}>
        POTWIERDZENIE TANKOWANIA
      </div>
      <div className="text-center font-bold">DOKUMENT NIEFISKALNY</div>
      <div className="text-center">Nr {sale.docNumber}</div>
      {cancelled && (
        <div
          className="mt-[1mm] border border-black text-center font-bold"
          style={{ fontSize: '9pt' }}
        >
          ANULOWANE
        </div>
      )}
      <Row label="Kasa" value={sale.register.code} />
      <Row label="Obsługa" value={sale.employee.login} />
      {withBuyer && (
        <>
          <Divider />
          <div>Dane nabywcy (do faktury):</div>
          <div className="font-bold break-words">{sale.company}</div>
          <div>NIP: {sale.nip}</div>
        </>
      )}
      <Divider />
      <Row label="Dystrybutor" value={`nr ${sale.pump}`} />
      <div className="mt-[1mm] font-bold">{fuelFullName(fuel)}</div>
      <Row
        label={`${formatMoney(sale.liters)} l x ${formatUnitPrice(sale.pricePerLiter)}`}
        value={formatMoney(sale.grossAmount)}
      />
      <Row
        label="Cena za litr"
        value={`${formatUnitPrice(sale.pricePerLiter)} zł`}
      />
      <Row label="Liczba litrów" value={`${formatMoney(sale.liters)} l`} />
      {sale.promotion && (
        <>
          <div className="mt-[1mm]">Promocja: {sale.promotion.title}</div>
          <Row
            label="Rabat"
            value={`-${formatMoney(sale.discountAmount)}`}
          />
        </>
      )}
      <Divider />
      <div style={{ fontSize: '10.5pt' }}>
        <Row label="RAZEM PLN" value={formatMoney(sale.amount)} bold />
      </div>
      <Row label="w tym VAT 23%" value={formatMoney(vat)} />
      <Divider />
      <Row label="Płatność" value={PAYMENT_LABEL[sale.payment]} />
      {sale.payment === 'gotowka' &&
        sale.cashGiven !== null &&
        sale.change !== null && (
          <>
            <Row label="Przyjęto" value={formatMoney(sale.cashGiven)} />
            <Row label="Reszta" value={formatMoney(sale.change)} />
          </>
        )}
      <Divider />
      <Row label="ORLEN VITAY" value={vitayLabel(sale)} bold />
      {sale.vitayTest ? (
        <div>KARTA TESTOWA – bez punktów i korzyści VITAY</div>
      ) : sale.vitayMode !== 'none' ? (
        <div>Punkty VITAY nie są naliczane przez ten system</div>
      ) : null}
      <Divider />
      <div className="text-center" style={{ fontSize: '6.4pt' }}>
        {SYSTEM_NOTICE}
        <br />
        Dokument fiskalny wydaje kasa fiskalna stacji.
      </div>
      <Divider />
      <div className="text-center">
        Dziękujemy za tankowanie
        <br />i zapraszamy ponownie!
      </div>
    </div>
  )
}

/** Renders the confirmation outside the app root and opens the print dialog. */
export function PrintHost({
  job,
  onDone,
}: {
  job: { sale: Fueling; nonce: number } | null
  onDone: () => void
}) {
  useEffect(() => {
    if (!job) return
    const root = document.documentElement
    root.classList.add('printing-receipt')
    const finish = () => {
      root.classList.remove('printing-receipt')
      onDone()
    }
    // Wait for the logo so it is on the printout.
    const timer = window.setTimeout(async () => {
      const imgs = Array.from(
        document.querySelectorAll<HTMLImageElement>('.print-root img'),
      )
      await Promise.all(
        imgs.map((img) => (img.complete ? null : img.decode().catch(() => null))),
      )
      window.print()
    }, 60)
    window.addEventListener('afterprint', finish, { once: true })
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('afterprint', finish)
      root.classList.remove('printing-receipt')
    }
  }, [job, onDone])

  if (!job) return null
  return createPortal(
    <div className="print-root">
      <Receipt sale={job.sale} />
    </div>,
    document.body,
  )
}
