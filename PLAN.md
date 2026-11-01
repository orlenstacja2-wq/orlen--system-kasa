# Plan – system obsługi stacji ORLEN

## Gotowe
1. ✅ Dostarczone logo ORLEN (`public/img/orlen-logo.png`, przycięte marginesy, oryginalne proporcje) i komponent `OrlenLogo`.
2. ✅ Schemat bazy (Netlify Database + Drizzle) i migracja: pracownicy, sesje, kasy, zmiany, zmiany kasy, tankowania, promocje (+historia), komunikaty, ceny paliw, ustawienia.
3. ✅ Funkcje serwerowe: logowanie numerem + PIN (scrypt, blokada po 5 próbach, sesja w cookie httpOnly), pierwsza konfiguracja administratora, start/koniec zmiany z wyborem kasy, zmiana kasy z zatwierdzeniem kierownika, zapis tankowania (idempotentny `clientRef`, ceny i promocja kopiowane do rekordu), anulowanie z powodem, raport zmiany, lista zmian z filtrami (kasa/pracownik/data), panel admina (komunikaty, promocje, kasy, pracownicy, ceny, tryb szkoleniowy), publiczne komunikaty.
4. ✅ Kasa (`register.tsx`): VITAY z trzema opcjami (karta / brak / telefon), numer testowy wyraźnie oznaczony, maskowanie, krok promocji, zapis na serwer z blokadą podwójnego zapisu.
5. ✅ Potwierdzenie tankowania 57 mm z logo, „DOKUMENT NIEFISKALNY” i komunikatem o przeznaczeniu systemu.
6. ✅ Usunięty licznik „Następny klient za…”; symulacja dystrybutorów tylko w trybie szkoleniowym.

## Do zrobienia
7. Ekran logowania: zastąpić kod `2009` wywołaniami `getBootstrap` / `setupStation` / `login` / `logout` (`src/server/auth.functions.ts`), usunąć `ACCESS_CODE`.
8. `src/routes/index.tsx`: załadować `getPanelData`, wymusić wybór kasy i start zmiany przed kasą, podłączyć nowe propsy `Register`, `Dispensers`, `PriceList`, `SalesHistory` (anulowanie), `useStation(simulation, fuels)`, stały pasek z `SYSTEM_NOTICE`, panele komunikatów i promocji, logo w nagłówku, zakończenie zmiany z uwagami.
9. Trasa `/raporty`: lista zmian z filtrami + raport zmiany (A4, logo, druk/PDF, eksport CSV).
10. Trasa `/admin` (rola kierownik/admin): komunikaty, promocje z historią, kasy, pracownicy, ceny, otwarte zmiany, tryb szkoleniowy.
11. Trasa `/komunikaty` – publiczny ekran z `getPublicAnnouncements`.
12. Typecheck, lint, testy, przegląd w `netlify dev`; aktualizacja README i AGENTS.md.
13. Integracje do podłączenia później: ORLEN VITAY (weryfikacja kart/telefonu, punkty), drukarka fiskalna, terminal płatniczy, sterownik dystrybutorów.
