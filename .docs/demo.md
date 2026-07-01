# Clientbridge — Demo / QA Account

`make seed` loads a complete, realistic demo business for local QA and demos. **Idempotent** —
TRUNCATEs every table, then re-inserts (re-run anytime to reset). The owner is the dev user
**`us_dev`**, so the web/mobile apps stream *this* business via the dev sync token (`/sync/token`).

**Login (dev = passwordless):** `POST /auth/login` with `{"email": "hannah@birchbarkpets.ca"}` (owner) —
or `diego@`/`priya@birchbarkpets.ca` to switch users. No password needed in dev (seeded users have
none); prod accounts require one. Returns an app JWT, exchanged at `/sync/token`.

## 🐾 Birchbark Pet Studio (Victoria, BC)
Pet grooming & daycare. **GST 5% + PST 7%** (exercises line-level multi-jurisdiction tax). **268 rows across all
37 tables.** Script: `backend/scripts/seed_demo.py`.

| Area | What's seeded |
|---|---|
| **Team** | Hannah Wong (owner, `us_dev`), Diego Ramirez (senior groomer, payee), Priya Patel (bather/desk) + 1 pending invite |
| **Clients** | 12 — avatars, tags (vip/regular/new/churn-risk), consents |
| **Pets (subjects)** | 13 dogs/cats — breed, weight, temperament, photos |
| **Catalog** | 12 items: grooming services, puppy class, monthly daycare (subscription), 5-bath package, retail products, gift card |
| **Schedule** | 21 sessions / 21 bookings spanning past (completed) → today → +14d, incl. a no-show and a cancellation; availability + a recurring puppy class |
| **Money** | 11 invoices (paid / partial / overdue), 14 lines, 9 payments (card + Interac), 3 payouts, 8 staff payout-splits, 2 estimates, gift cards, packages, subscriptions, payment methods |
| **Engagement** | 5 inbox threads / 10 messages, 3 broadcasts, 8 reviews (with owner replies), 10 review requests |
| **Documents** | New-Pet-Intake form (14 typed fields) + Satisfaction form, 4 responses; grooming waiver + 6 signatures |
| **Platform** | files (pet photos / waivers), audit logs, webhook events |
| **Photos** | pravatar (people), picsum (pets / products / logo) — stable stock URLs |

## Run it
```
make up && make install
make migrate        # apply schema
make seed           # load / reset the demo  (idempotent)
```

## How we know the data is correct
- **Structural integrity** (FKs · enum CHECKs · uniqueness · NOT NULL) is enforced by Postgres — a
  successful `make seed` *is* the proof; a bad row can't be inserted.
- **Behaviour + business rules** are covered by the backend test suite (`backend/tests/`, ~95% branch
  coverage), which runs against this seed as its baseline. Invoice/tax math gets verified by the
  invoice + tax services' own tests once those land (P3/P5) — where the seed will compute totals via
  them, correct by construction.

## QA notes
- **Readable IDs** for easy debugging: `bz_birchbark`, `us_dev`, `cl_amelie`, `sj_bella`, `inv_1001`.
- **Relative dates** — sessions/invoices are anchored to *now*, so there's always recent + upcoming activity.
- This account is the standing **demo + manual-QA fixture**; keep it realistic as the schema evolves.
