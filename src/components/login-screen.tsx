import { useEffect, useRef, useState } from 'react'
import { Delete, Lock } from 'lucide-react'

import { OrlenEagle, OrlenLogo } from '@/components/orlen-logo'
import { Clock } from '@/components/clock'
import { ACCESS_CODE, STATION } from '@/lib/station'
import { cn } from '@/lib/utils'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫']

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState(false)
  const [shakeKey, setShakeKey] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function submit(value: string) {
    if (value === ACCESS_CODE) {
      onSuccess()
      return
    }
    setError(true)
    setShakeKey((k) => k + 1)
    setCode('')
  }

  function update(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 4)
    setCode(digits)
    setError(false)
    if (digits.length === 4) submit(digits)
  }

  function press(key: string) {
    if (key === 'C') update('')
    else if (key === '⌫') update(code.slice(0, -1))
    else update(code + key)
    inputRef.current?.focus()
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-primary p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
        <OrlenEagle className="pointer-events-none absolute -right-24 -bottom-16 h-[34rem] w-auto text-white/10" />
        <OrlenLogo inverted className="text-5xl" />
        <div className="relative">
          <p className="font-display text-sm font-semibold tracking-[0.3em] text-white/70 uppercase">
            System obsługi stacji paliw
          </p>
          <h1 className="mt-3 font-display text-6xl leading-[0.95] font-extrabold">
            Kasa i dystrybutory
            <br />w jednym miejscu.
          </h1>
          <dl className="mt-10 grid max-w-md grid-cols-2 gap-x-8 gap-y-4 text-sm">
            <div>
              <dt className="text-white/60">Stacja</dt>
              <dd className="font-semibold">{STATION.name}</dd>
            </div>
            <div>
              <dt className="text-white/60">Numer</dt>
              <dd className="font-semibold tabular-nums">{STATION.number}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-white/60">Adres</dt>
              <dd className="font-semibold">
                {STATION.street}, {STATION.city}
              </dd>
            </div>
          </dl>
        </div>
        <Clock inverted />
      </section>

      <section className="flex flex-col items-center justify-center px-6 py-12">
        <OrlenLogo className="mb-10 text-4xl lg:hidden" />
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-accent text-primary">
              <Lock className="size-5" />
            </span>
            <h2 className="font-display text-3xl font-bold">
              Logowanie pracownika
            </h2>
            <p className="mt-1 text-muted-foreground">
              Wpisz 4-cyfrowy kod dostępu i naciśnij ENTER
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              submit(code)
            }}
          >
            <label htmlFor="access-code" className="sr-only">
              Kod dostępu
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                id="access-code"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={code}
                onChange={(e) => update(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') update('')
                }}
                className="peer absolute inset-0 opacity-0"
                aria-invalid={error}
                aria-describedby="code-hint"
              />
              <div
                key={shakeKey}
                className={cn(
                  shakeKey > 0 && 'animate-shake motion-reduce:animate-none',
                  'flex justify-center gap-4 rounded-xl border-2 bg-card py-6 transition-colors motion-reduce:transition-none',
                  error
                    ? 'border-destructive'
                    : 'border-input peer-focus:border-primary',
                )}
              >
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={cn(
                      'size-5 rounded-full border-2 transition-colors motion-reduce:transition-none',
                      i < code.length
                        ? 'border-primary bg-primary'
                        : 'border-input',
                    )}
                  />
                ))}
              </div>
            </div>
            <p
              id="code-hint"
              role="status"
              className={cn(
                'mt-3 h-5 text-center text-sm',
                error
                  ? 'font-semibold text-destructive'
                  : 'text-muted-foreground',
              )}
            >
              {error ? 'Nieprawidłowy kod. Spróbuj ponownie.' : 'ESC – wyczyść'}
            </p>
          </form>

          <div className="mt-6 grid grid-cols-3 gap-3">
            {KEYS.map((key) => (
              <button
                key={key}
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => press(key)}
                aria-label={
                  key === '⌫' ? 'Usuń cyfrę' : key === 'C' ? 'Wyczyść' : key
                }
                className={cn(
                  'flex h-16 items-center justify-center rounded-xl border bg-card font-display text-2xl font-bold shadow-xs transition-colors hover:border-primary hover:text-primary active:bg-accent motion-reduce:transition-none',
                  (key === 'C' || key === '⌫') && 'text-muted-foreground',
                )}
              >
                {key === '⌫' ? <Delete className="size-6" /> : key}
              </button>
            ))}
          </div>
          <p className="mt-10 text-center text-xs text-muted-foreground">
            {STATION.street}, {STATION.city} · {STATION.website}
          </p>
        </div>
      </section>
    </main>
  )
}
