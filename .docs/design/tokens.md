# Clientbridge — Design Tokens

Single source of truth for the visual system. Tokens are platform-agnostic; the three
consumers (CSS variables · Tailwind · React Native) below are generated from the same set.
Open `clientbridge-design-system.html` to see them applied.

> **Aesthetic POV:** *Engineered calm — structural warmth.* Bridge-engineering
> precision + the warmth of a craftsperson's studio. Pine = structure/trust, Honey = the
> human connection + CTA, Clay = craft warmth, Paper = warm neutrals.

---

## 1. Colour

| Token | Hex | Role |
|---|---|---|
| `pine.50` | `#EFF7F5` | tint backgrounds |
| `pine.100` | `#DCEEEA` | selected/info chips |
| `pine.400` | `#5BB0A1` | accents on dark |
| `pine.500` | `#2C8B7C` | info / success-ish |
| `pine.600` | `#1A6B5F` | hover primary |
| `pine.700` | `#115048` | **primary** |
| `pine.800` | `#0E3D36` | primary-dark / nav |
| `pine.900` | `#0B2E29` | deepest surfaces |
| `honey.100` | `#FCEBCF` | warning tint |
| `honey.500` | `#EFA23D` | **accent / primary CTA** |
| `honey.600` | `#D9871F` | CTA hover / "due" |
| `honey.800` | `#8A510C` | text on honey tint |
| `clay.500` | `#D67B57` | secondary warm / illustration |
| `clay.600` | `#C2613F` | secondary warm strong |
| `paper.100` | `#FBFAF6` | **app background** |
| `paper.200` | `#F4F1EA` | panel / muted surface |
| `paper.300` | `#ECE7DC` | sunken / track |
| `ink` | `#15201D` | primary text (warm near-black) |
| `fog.500` | `#6B7B75` | secondary text |
| `fog.700` | `#3A4843` | strong body text |
| `hair` | `#E4E7E1` | hairline borders |
| `success` | `#1F9D6B` | paid |
| `warn` | `#D9871F` | deposit/overdue-soon |
| `danger` | `#BE4A35` | overdue / destructive |

**Status → token map** (used everywhere a booking/invoice state renders):
`Confirmed`→pine.100/700 · `Deposit due`→honey.100/800 · `Paid`→#DDF3E9/#157A52 ·
`Overdue`→#F8E0DB/#A33A28 · `Pending`→paper.300/fog.600 · `Cancelled`→paper.200/fog.500.

**Brand-specific:** Interac chip = `#FFE600` bg / `#1A1A1A` fg (Interac yellow/black, the one
place we use a non-palette colour — it's a recognized rail mark).

---

## 2. Typography

| Token | Family | Use |
|---|---|---|
| `font.display` | **Fraunces** (opsz, 400–700, italic) | headings, hero, numbers-as-statement |
| `font.sans` | **Hanken Grotesk** (400–800) | all UI & body |
| `font.mono` | **DM Mono** (400–500) | money, invoice #s, codes — always `tabular-nums` |

Why: Fraunces carries warmth + excellent French diacritics (é, è, ç, ï) without feeling
corporate; Hanken is a clean, friendly grotesk (deliberately **not** Inter); DM Mono keeps
currency columns aligned.

**Scale** (1.25 modular): `display 40/700` · `h2 30/600` · `h3 22/600` · `body 16/400` ·
`small 14/400` · `overline 12/700 · tracking .14em uppercase`. Money figures: 28/500 mono.

---

## 3. Spacing · Radius · Elevation

- **Spacing** — 4px base: `1=4 2=8 3=12 4=16 5=20 6=24 8=32 10=40 12=48`.
- **Radius** — `sm 8 · md 12 · lg 16 · xl 24 · xl2 20 · xl3 28 · pill 9999`.
- **Elevation** —
  - `soft`: `0 1px 2px rgba(11,46,41,.04), 0 4px 16px rgba(11,46,41,.06)`
  - `lift`: `0 2px 4px rgba(11,46,41,.05), 0 12px 32px rgba(11,46,41,.10)`
  - `float`: `0 8px 24px rgba(11,46,41,.10), 0 24px 64px rgba(11,46,41,.14)`
- **Motion** — entrances `.7s cubic-bezier(.2,.7,.2,1)` staggered; hover lifts `-3px`.

---

## 4. Consumers

### CSS variables
```css
:root{
  --pine-700:#115048; --pine-800:#0E3D36; --pine-900:#0B2E29;
  --honey-500:#EFA23D; --honey-600:#D9871F; --clay-500:#D67B57;
  --paper-100:#FBFAF6; --paper-200:#F4F1EA; --ink:#15201D;
  --fog-500:#6B7B75; --hair:#E4E7E1;
  --success:#1F9D6B; --warn:#D9871F; --danger:#BE4A35;
  --r-sm:8px; --r-md:12px; --r-lg:16px; --r-xl:24px; --space:4px;
}
```

### Tailwind (`tailwind.config.js` → `theme.extend`)
```js
colors: {
  pine:{50:'#EFF7F5',100:'#DCEEEA',200:'#AFD8CF',300:'#7FBFB2',400:'#5BB0A1',
        500:'#2C8B7C',600:'#1A6B5F',700:'#115048',800:'#0E3D36',900:'#0B2E29',950:'#07201C'},
  honey:{100:'#FCEBCF',200:'#FAD9A6',300:'#F6C674',400:'#F4B65E',500:'#EFA23D',600:'#D9871F',700:'#B26A12',800:'#8A510C'},
  clay:{200:'#F0C7B6',300:'#E6A98F',500:'#D67B57',600:'#C2613F',700:'#9E4A2C'},
  paper:{100:'#FBFAF6',200:'#F4F1EA',300:'#ECE7DC'},
  ink:'#15201D', fog:{400:'#9AA7A1',500:'#6B7B75',600:'#4F5E58',700:'#3A4843'},
  hair:'#E4E7E1', success:'#1F9D6B', warn:'#D9871F', danger:'#BE4A35',
},
fontFamily:{ display:['Fraunces','serif'], sans:['"Hanken Grotesk"','sans-serif'], mono:['"DM Mono"','monospace'] }
```
Pairs cleanly with **shadcn/ui** — map `--primary`→pine.700, `--accent`→honey.500,
`--background`→paper.100, `--foreground`→ink, `--border`→hair, `--ring`→pine.400.

### React Native (theme object — shared with web via a `@clientbridge/tokens` package)
```ts
export const theme = {
  color: {
    pine: { 700:'#115048', 800:'#0E3D36', 900:'#0B2E29', 500:'#2C8B7C', 100:'#DCEEEA' },
    honey:{ 500:'#EFA23D', 600:'#D9871F', 100:'#FCEBCF' },
    clay: { 500:'#D67B57' },
    paper:{ 100:'#FBFAF6', 200:'#F4F1EA', 300:'#ECE7DC' },
    ink:'#15201D', fog:{ 500:'#6B7B75', 700:'#3A4843' }, hair:'#E4E7E1',
    success:'#1F9D6B', warn:'#D9871F', danger:'#BE4A35',
  },
  font:{ display:'Fraunces', sans:'HankenGrotesk', mono:'DMMono' },
  radius:{ sm:8, md:12, lg:16, xl:24, pill:9999 },
  space:(n:number)=>n*4,
} as const;
```

> **Cross-platform rule:** ship tokens as one JSON/TS package (`@clientbridge/tokens`)
> consumed by both the Tailwind config (web) and the RN theme (mobile). Never hardcode a
> hex in a component — reference the token so EN/FR, light/dark, and white-label theming
> stay centralized.

---

## 5. Bilingual (EN / FR) rules
- Every user-facing string is keyed (`i18n`), never hardcoded — the showcase demos this with
  `data-en` / `data-fr` swap and the **EN/FR** toggle.
- Reserve **+30–35% width** for French (it runs longer); buttons/labels must not truncate.
- Fraunces & Hanken both carry full Latin-Extended — diacritics render natively.
- Currency: always `CAD`, `$` symbol, `1,234.50` format, `fr-CA` → `1 234,50 $` (space
  separator, trailing symbol). Token `format.currency` handles locale.
