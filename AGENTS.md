# AGENTS.md

Guidance for AI agents and developers working on this codebase.

## Project Overview

A single-screen point-of-sale app for an ORLEN fuel station (Aleja Armii Krajowej 46, 35-307 Rzeszów). After a 4-digit employee code (`2009`) the operator sees 5 dispensers with simulated customers, a price list, a sales history and a fiscal-register panel. A sale ends in a printable 57 mm thermal receipt or invoice. The UI is in Polish and is meant to be driven entirely from the keyboard.

Everything runs client-side. There is no backend, database or auth service. Station state lives in React state for the lifetime of the tab.

### Tech Stack

TanStack Start + React 19, Tailwind CSS 4 (theme variables in `src/styles.css`), lucide-react icons, sonner toasts, deployed on Netlify via `@netlify/vite-plugin-tanstack-start`.

## Key Files

```
src/
├── routes/index.tsx            # Login gate + main layout; owns print jobs and F10 logout
├── hooks/use-station.ts        # Forecourt simulation reducer: arrivals, fueling, expiry, sales, doc numbering
├── hooks/use-now.ts            # Ticking timestamp (null until mounted, SSR-safe)
├── lib/station.ts              # Station data, access code, fuel price list, money/number formatting
├── components/register.tsx     # Register state machine, keyboard handling, VITAY full-screen prompt
├── components/dispensers.tsx   # Dispenser cards 1–5 with live fueling progress
├── components/station-panels.tsx # Price list and sales history
├── components/receipt.tsx      # 57 mm receipt (mm units) + PrintHost portal that calls window.print()
├── components/login-screen.tsx # Employee code screen
├── components/clock.tsx        # Clock and date
└── components/orlen-logo.tsx   # SVG eagle mark + wordmark (currentColor)
```

## Non-obvious Decisions

- **Timestamp-based simulation.** `useStation` ticks every second, but every transition is computed from absolute timestamps (`nextArrivalAt`, `startedAt + fuelingMs`, `awaitingSince`). This keeps it correct across midnight and when the browser throttles background tabs. The reducer stays pure: random seeds are generated outside it and passed in with each `tick`.
- **Locking.** When the register selects a dispenser with a pending fill, it calls `lock(pump, true)` so the 15-minute auto-expiry (paid at the pump terminal) can't remove it mid-sale.
- **Document numbers** (`0001` for receipts, `FV/DDNNN/MM/YYYY` for invoices) are assigned in `completeSale` from a ref counter that resets daily.
- **Register steps:** `pump → fuel → liters → doc → (invoice) → vitay → payment → cash|card → done`. A single window `keydown` listener handles selection steps. Steps with an input let the field's `<form onSubmit>` handle ENTER; ESC (go back) is handled globally in every step. Buttons use `tabIndex={-1}` so focus stays on the active field.
- **Dispenser cards → register** go through `selectPumpRef`, a callback ref the register fills, rather than through effect-driven props.
- **Printing.** `PrintHost` portals the receipt into `<body>` as `.print-root`. Print CSS in `styles.css` hides every other body child and sets `@page { size: 57mm auto; margin: 0 }`.
- Theme: ORLEN red is `--primary`. The customer-display colors are `--lcd` / `--lcd-foreground`. Fonts are Barlow and Barlow Condensed (display), with JetBrains Mono for the receipt.

## Conventions

- Components PascalCase, hooks/utilities camelCase, `@/` import alias.
- Prices and formatting come only from `src/lib/station.ts`. Don't hard-code prices in components.
- Read browser-only APIs (`window`, `document`) in effects or event handlers, never during render.
- TypeScript is strict with no unused locals/params.

## Possible Next Steps

If shift history needs to survive reloads or be shared between registers, store completed sales in Netlify Database and move access-code checking to the server.
