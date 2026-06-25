# Clientbridge — Information Architecture & Key Screens

Companion to `clientbridge-design-system.html` (visual) and `tokens.md` (system). This is the
*structure*: navigation model, the key screens, their jobs, and the Canada-specific behaviour
baked into each. Built **horizontal** (vertical-pluggable) and **web + mobile in parallel**.

---

## Navigation model

Primary nav (6 destinations) — identical on web (left rail) and mobile (bottom tab + FAB):

| Nav | EN / FR | Job |
|---|---|---|
| **Today** | Today / Aujourd'hui | The daily cockpit — schedule, money snapshot, action items |
| **Calendar** | Calendar / Agenda | Manage availability & bookings (day/week/month) |
| **Clients** | Clients / Clients | The CRM — the "bridge" relationship hub |
| **Invoices** | Invoices / Factures | Billing, payments, GST/HST status |
| **Inbox** | Inbox / Messages | Unified client thread (SMS + email + chat), CASL-aware |
| **Catalog** | Catalog / Catalogue | Services, packages, subscriptions, intake forms |

Global **+ (FAB)** → quick-create: Booking · Invoice · Client · Payment request.
Persistent **EN/FR** toggle + tax/region context in account menu.

---

## Vertical-pluggable core

The same engine renders every vertical; a **vertical pack** only swaps presets — it never
forks the data model. A pack declares: default services & durations, intake-form templates,
contract templates, terminology overrides (e.g. "appointment" vs "session" vs "job"),
deposit/cancellation policy defaults, and the booking-flow shape (1:1 vs class vs multi-day).

```
Booking · Client · Invoice · Line · Payment · Item · Package · Schedule   ← universal entities
        └── VerticalPack { services, forms, contracts, copy, policies }   ← presets only
```
Beauty, wellness-solo, cleaning, trades, tutoring, pet care, photography = packs, not rebuilds.

---

## Key screens

### 1 · Today (dashboard) — "today on the bridge"
**Job:** answer "what's happening, who owes me, am I covered for tax" in one glance.
- Greeting + date (localized) · primary actions **New booking** / **Get paid**.
- Three stat cards: **Today's revenue**, **Awaiting payment**, **GST/HST set aside** (the
  Canada signature — auto-reserves remittance, shows next CRA filing date).
- Today's schedule list (time · client avatar · service · status pill).
- Empty state seeds the day with "Share your booking link" CTA.

### 2 · Calendar + bookings
**Job:** run the schedule. Day/week/month; drag to reschedule; availability blocks; buffer
times; class capacity. Each event opens a **Booking detail** sheet (client, service, deposit
status, payment, intake form, contract, message thread). Online-booking holds + no-show
protection (deposit / card-on-file) front-and-centre.

### 3 · Client hub — "the bridge"
**Job:** the relationship of record. This is the namesake screen.
- Header: avatar, contact, tags, **CASL consent state** (express/implied + timestamp).
- Bridge metric strip: **visits · lifetime value · amount owing**.
- Tabs: **Timeline** (unified events) · Bookings · Payments · Notes (+ custom fields,
  intake records, files). One-tap: book, invoice, message, request deposit.

### 4 · Invoice / Get paid
**Job:** bill correctly for Canada and collect fast.
- Line items → **automatic multi-jurisdiction tax**: GST/HST by province, **PST** (BC/SK/MB)
  or **QST** (QC) stacked correctly; business number shown; small-supplier (<$30k) mode hides
  tax until registered.
- Payment methods ranked **Interac e-Transfer (auto-matched, no fee)** → Card/tap → **EFT/PAD**
  (recurring) → Apple Pay. "Send payment request" pushes a pay link to the client thread.
- States: Draft · Sent · Awaiting · Partially paid · Paid · Overdue. Receipts bilingual.

### 5 · Public booking page (client-facing, mobile-first)
**Job:** the provider's storefront — convert a stranger into a booking.
- Branded header (logo, location, rating, **EN·FR** auto from browser/region).
- Choose service → time → details → **deposit/pay** (Interac/card) → confirm.
- Generates `clientbridge.ca/<handle>`; embeddable widget; CASL-compliant opt-in capture.

### Supporting screens (specced later)
Inbox (CASL-gated campaigns), Catalog (packages/subscriptions/intake), Contracts & e-sign,
Reports (income, tax, receivables; CRA T2125 export), Settings (tax setup, payout/Interac,
team/payees, white-label, Law 25 data controls).

---

## Canada-specific behaviour, by screen (the moat)

| Capability | Lives in | Note |
|---|---|---|
| GST/HST/PST/QST auto-calc | Invoice, Catalog | Per-province rules engine; QC stacks GST+QST |
| $30k small-supplier mode | Invoice, Settings | Tax hidden until registration threshold crossed |
| GST/HST set-aside + remittance | Today, Reports | Auto-reserve; surfaces CRA filing dates |
| Interac e-Transfer (auto-match) | Invoice, Booking, Public | Default rail; reconcile by reference |
| EFT / PAD | Invoice, Subscriptions | Pre-authorized debit for recurring |
| CASL consent + audit | Clients, Inbox | Express/implied state gates marketing sends |
| PIPEDA / Québec Law 25 | Settings, Client hub | Data-residency, export, delete controls |
| Bilingual EN/FR (Bill 96) | Everywhere | i18n keys; FR-first option for QC accounts |
| CRA reporting | Reports | T2125 / GST-HST return exports; T4A for payees |

---

## Build order (design → code)
1. **Token package** (`@clientbridge/tokens`) → web Tailwind + RN theme.
2. **Primitives** (buttons, inputs, status pills, money, tax line, payment chips, avatars).
3. **Today** + **Public booking** (highest-signal: provider value + acquisition loop).
4. **Client hub** + **Invoice/Get-paid** (the relationship + the revenue).
5. **Calendar**, then supporting screens.
