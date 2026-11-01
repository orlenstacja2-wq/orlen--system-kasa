# ORLEN – System obsługi stacji paliw

Webowa aplikacja kasowa dla stacji ORLEN przy Alei Armii Krajowej 46 w Rzeszowie. Działa w jednym oknie: logowanie pracownika, podgląd 5 dystrybutorów z transakcjami pojawiającymi się automatycznie, kasa fiskalna z płatnością gotówką lub kartą, pytanie o kartę ORLEN VITAY i wydruk paragonu lub faktury na drukarce termicznej 57 mm.

## Funkcje

- **Logowanie** kodem pracownika (`2009`). Kod można wpisać z klawiatury lub z klawiatury ekranowej.
- **Dystrybutory 1–5**: mniej więcej co 5 minut przyjeżdża nowy klient. Widać tankowanie na żywo (litry i kwota), potem stan „Do zapłaty”. Transakcja, której nikt nie rozliczy w kasie przez 15 minut, zamyka się jako opłacona w terminalu przy dystrybutorze.
- **Kasa**: dystrybutor → paliwo → litry → paragon/faktura (NIP, nabywca) → VITAY → gotówka/karta. Kwota liczy się automatycznie z cennika, a przy gotówce kasa pokazuje resztę.
- **ORLEN VITAY**: przed każdą płatnością na całym ekranie pojawia się pytanie TAK/NIE.
- **Paragon 57 mm** z logo, adresem, datą, dystrybutorem, paliwem, litrami, ceną, sumą, PTU, metodą płatności i informacją o VITAY. Każdy dokument z historii można wydrukować ponownie.
- **Zegar, data, cennik i historia transakcji** z sumą zmiany.

## Obsługa klawiaturą

| Klawisz        | Działanie                                         |
| -------------- | ------------------------------------------------- |
| `ENTER`        | zatwierdź / dalej                                 |
| `ESC`          | cofnij o krok                                     |
| Strzałki       | poruszanie się po opcjach                         |
| `1`–`5`        | szybki wybór dystrybutora lub paliwa              |
| `P` / `F`      | paragon / faktura                                 |
| `T` / `N`      | VITAY: tak / nie                                  |
| `G` / `K`      | gotówka / karta                                   |
| `ENTER` (puste pole gotówki) | klient płaci odliczoną kwotę        |
| `N` (po transakcji) | nowa transakcja bez wydruku                  |
| `F10`          | wyloguj                                           |

## Drukowanie

Paragon otwiera systemowe okno drukowania z formatem strony 57 mm × auto. W ustawieniach drukarki termicznej wybierz papier 57 mm i wyłącz marginesy oraz nagłówki i stopki przeglądarki.

## Technologie

TanStack Start (React 19), Tailwind CSS 4, lucide-react, sonner. Hosting na Netlify.

## Uruchomienie lokalne

```bash
pnpm install
pnpm dev            # http://localhost:3000
# lub z emulacją Netlify:
netlify dev
```

## Uwagi

- Stan stacji (dystrybutory, historia) jest przechowywany w pamięci przeglądarki na czas działania karty. Po odświeżeniu strony zmiana zaczyna się od nowa.
- Kod dostępu jest sprawdzany w przeglądarce. Zabezpiecza stanowisko przed przypadkowym użyciem, ale nie zastępuje prawdziwego uwierzytelniania.
- Wydruk jest symulacją paragonu fiskalnego. Prawnie ważne paragony wystawia certyfikowana drukarka fiskalna.
