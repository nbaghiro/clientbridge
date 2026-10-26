# Finishing the e2e suite

This is the plan for taking PR #59 from 60 required cases to every audit family in [coverage.json](coverage.json) either verified or deferred with a reason Naib has approved. It replaces the "Remaining execution" list in the [README](README.md) once the shared test tier lands.

## Decisions

- **Done means** every one of the 302 families is `verified`, or `deferred` with a written reason that is reviewed before merge. Nothing stays partial without being listed.
- **Open product decisions** take the current behaviour, or the behaviour the findings 1 to 16 fixes chose. Each one is logged in [decisions.md](decisions.md) for review, and the case asserts that behaviour.
- **Schema changes** still need explicit approval of the exact change before any model or migration is touched.
- **Test infrastructure** is one shared, long-running tier. A run never starts its own containers.

## The shared test tier

`make test-tier` starts the `clientbridge-test` compose project, or checks that it's healthy. It runs apart from the dev stack, so tests never read or write dev data, and it holds:

| Service | Port | Shared how |
| --- | --- | --- |
| Postgres | 8760 | `clientbridge_e2e` for every browser, journey and native run; `clientbridge_test_<fingerprint>` templates for pytest; `auth` and `powersync_storage` |
| Redis | 8761 | One database index per run slot |
| rustfs | 8762 | One bucket per run |
| Mailpit | 8763 web, 8764 SMTP | Runs find mail by their own recipients |
| Kratos | 8765 public, 8766 admin | One instance; CORS and return URLs list every run slot's origins |
| PowerSync | 8767 | Replicates `clientbridge_e2e` |
| stripe-mock | 8768 | Contract tests |
| Auth mail relay | 8769 | Forwards each Kratos courier request to the API of the run that owns the recipient |

A run leases one of six slots. A slot fixes the run's web, pseudo-locale and admin origins (8770 to 8787), which Kratos must know in advance, and its Redis index. The API, worker, Connect and site take free ports. Only the code under test runs per run: the API, the worker, the Vite bundles and the browsers.

### Isolation

Each run has a four-character namespace. With `ID_NAMESPACE` set, `core/ids.new_id` writes the namespace into a fixed position of the ULID's random part, so every row the run's API creates, including businesses made through signup, carries it. Production leaves the setting unset.

The seed takes `--namespace` and writes the three core demo businesses with their IDs mapped into the namespace, and with run-specific slugs, emails, tokens, provider references and other globally unique values. Owners sign in as `hannah+<namespace>@birchbark.example` and so on, so tests read their identities from the run instead of hard-coding them. Accounts that tests create carry the namespace in their email too, which is how the relay routes their auth mail.

The run's worker sets `JOB_NAMESPACE`, and every scheduled job restricts its rows to businesses in that namespace through one helper next to `core/scoping`. A run therefore proves only its own worker's work.

Cleanup purges the namespace's businesses and users with the seed's `purge_businesses`, deletes their Kratos identities and the run's bucket, and flushes the slot's Redis index. A reaper clears namespaces whose run record shows no live process.

### Drift between branches

The tier records a fingerprint of the Alembic head, `sync-rules.yaml` and the Kratos configuration as a comment on `clientbridge_e2e`. A run whose checkout has a different fingerprint stops before seeding and names the difference. `make test-tier-reset` rebuilds the database and PowerSync storage for the current checkout.

### Backend pytest

`make test-backend` seeds a template database once per fingerprint of the migrations, the seed code and `FROZEN`, then gives each run a copy made with `CREATE DATABASE … TEMPLATE`, which takes a second or two. Each test still rolls back. Old templates are dropped when their fingerprint is no longer current.

### Suites on the tier

Every suite moves onto it: backend pytest and the Kratos tier, the contract tests, sync e2e (its key-rotation drill keeps a per-run key route through the relay), web, Connect, journeys, filings, pseudo-locale, Firefox and WebKit, the Stripe browser lane, native, flakes and mutations. CI jobs start the tier with the same `make test-tier` before their lane, so the local and hosted paths stay the same.

## Layout of the test code

Checks against the database are plain read-only SQL in the tests themselves: one `support/db.ts` connection on the run's tier URL, and each domain's queries beside its helpers in `apps/web/e2e/support/<domain>.ts`. They stay independent of the application because they read the tables directly. The harness and the setup actions live in a flat `backend/e2e/` package (`tier`, `relay`, `runner`, `namespace`, `results`, `mutations`, `stripe`, `actions`), so `backend/scripts/` holds only product and operations scripts. Stripe-side checks stay in Python with the provider lane.

## Where a test goes

E2e files follow the same one-name-per-concept rule as the rest of the code, so a developer finds the file from the concept they changed: the app-core domain file, the strings group, the service and the page share its name.

| What changed | File to extend |
| --- | --- |
| One concept's provider behaviour (rules, states, rejections) | `apps/web/e2e/<concept>.e2e.ts`, e.g. `clients`, `billing`, `pos`, `earnings`, `reports` |
| A public page | `apps/connect/e2e/<publicConcept>.e2e.ts`, e.g. `publicBooking`, `publicPay`, `publicShop` |
| A mobile-only screen or native behaviour | `apps/mobile/e2e/<concept>.yaml`; `shards.json` sets the order |
| Something whose consequences cross concepts, devices or the worker | the matching anchor journey in `apps/web/e2e/journeys/<flow>.journey.ts` (`visit`, `estimate`, `stock`, `client`, `documents`, `communication`, `entitlements`, `team`, `device`, `operations`) |
| A new concept | a new `<concept>.e2e.ts`; the structure check rejects a name that isn't a concept |

A few cross-cutting files keep their own names, as the backend's `test_flows_*` do: `auth`, `offline`, `sync`, `security`, `shell` (the page-and-dialog walk), `accessibility` and `pseudo`. Each new case also gets an ID registered in `results.py` and the audit families it covers in `coverage.json`; the runner fails a lane whose registry and files disagree.

`check-structure.mjs` enforces the names for web, Connect and native e2e files, and `.docs/engineering.md` holds this table for everyday use.

## Execution

1. **Integrate.** The platform and native branches are merged, and the work in progress from areas-a, areas-b, flows-a, flows-b and residuals is committed on this branch.
2. **Build the tier** and move every suite onto it, then move the observers into the tests and the harness into `backend/e2e/`, rename the e2e files to their concepts and add the structure check, with harness tests for the slot lease, namespacing, relay routing, job scoping, fingerprint checks and cleanup.
3. **Qualify the merged branch** on the tier: finish the work-in-progress cases, then run every lane strictly.
4. **Cover the families**, one category at a time with P0 first. Each family gets a case written to its full audit assertions, a strict run and an independent review before it moves to `verified`. Product defects a case finds are reproduced and fixed with backend tests.
5. **Close the known boundaries:** Connect showing paid before the payment event, hard-kill and browser-phase recovery, iOS and release-build qualification, and hosted runs of the flake and mutation workflows.
6. **Requalify** every lane on the final commit, run `make check` and hosted CI, and rewrite the README, history and coverage summary.
