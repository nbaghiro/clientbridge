# Clientbridge — Testing Strategy

Tests are the **primary feedback loop** until manual QA — and the goal is for green tests to *remove
the need for manual QA at intermediate backend steps*. So we optimize for **meaningful** coverage:
tests that fail when behavior, contracts, or security regress — not line-count theater.

## Shape: integration-first
- **Integration tests dominate** — `httpx.AsyncClient` → the real FastAPI app → real Postgres. They
  cover the true HTTP contract + auth + DB constraints — the closest thing to a manual tester. One
  test file per router/domain.
- **Unit tests** only for pure logic with many cases (JWT encode/verify, password hashing, tax math,
  RRULE expansion). No DB, no HTTP.
- We **don't mock our own code.** The DB is real; our services run for real.

## Isolation: transactional rollback (locked)
Every test runs inside a transaction that is **rolled back** at the end:
- A fixture opens a connection + outer transaction; an
  `AsyncSession(bind=conn, join_transaction_mode="create_savepoint")` is shared by the test AND the
  app (via `app.dependency_overrides[get_session]`).
- The app's `commit()`s become savepoints inside the outer transaction; the fixture's final
  `rollback()` erases everything.
- Tests start from the **committed seed baseline** (Birchbark), create/modify freely, and leave
  **zero residue** — repeatable, parallel-safe, no accumulation.
- All tests share one **session-scoped event loop** so the async engine pool stays valid.

## External boundaries: adapters + recording fakes
Third parties are never called in tests. Each is an **interface** injected as a dependency:

| Boundary | Interface | Prod impl | Test fake |
|---|---|---|---|
| Email | `EmailSender` | SES/Postmark | `FakeEmailSender` — records `.sent` |
| OAuth | `OAuthVerifier` | Google certs | `FakeOAuthVerifier` — fixed profile |
| SMS (P7) | `SmsSender` | Twilio | records |
| Payments (P6) | `PaymentGateway` | Stripe | `FakePaymentGateway` + the Stripe tiers ↓ |

A test asserts on the fake — *"one reset email to alice@x, with a token that then resets the
password"* — fully exercising our logic up to the wire. The real provider is verified once in a
sandbox smoke (the only step tests can't own).

## Stripe: verifying the adapter itself
The fake covers our *logic*; it can't prove the real `StripeGateway` maps correctly to Stripe (the
fake encodes our *assumptions*). Three tiers close that, layered by cost — the first two need no
Stripe account:

| Tier | Run | Validates | Marker |
|---|---|---|---|
| **Contract** | `make test-contract` | real gateway vs **stripe-mock** (OpenAPI mock, `:8708`) — every request shape + response parse against the live spec | `contract` |
| **Webhook** | default suite | real `verify_webhook` with a genuine HMAC signature + golden event fixtures (`tests/fixtures/stripe/`) | — |
| **E2E** | `make test-e2e` | real test mode — KYC transitions, declines/3DS, subscription periods at the *current* API version | `e2e` |

- `contract`/`e2e` are out of the default run (`-m "not contract and not e2e"`) and **auto-skip** when
  their backing service / keys are absent — so `make test` stays hermetic.
- **stripe-mock is stateless and pins a spec version**: it checks shapes, not behavior, and won't catch
  fields that moved in newer API versions. Only the E2E tier covers that; it stays dormant until
  `STRIPE_TEST_SECRET_KEY` is set.
- The webhook tier already earned its keep — it caught two stripe-v15 breakages in `verify_webhook`
  (the SDK's `StripeObject` is not a dict, so `.get()` and `dict()` both fail).

## The coverage bar (the real standard)
A feature isn't "done" until its tests clear this matrix:
1. **Happy path** — intended outcome + response shape.
2. **Every error path** — each 4xx with the right code/message.
3. **Security invariants** — tenant isolation (can't touch another business), role gates (403), token
   tamper/expiry/audience, no user-enumeration leaks.
4. **Idempotency / edges** — double-submit, duplicate-unique, expired/used token, empty/oversized input.

## Coverage gate (the floor)
- CI runs `pytest --cov=clientbridge --cov-branch --cov-fail-under=90` (migrations excluded).
- The % is a **floor that surfaces untested code** — the matrix above is the bar. Don't chase the
  number with trivial tests.

## Reusable fixtures (built in P1.0)
- **Auth clients:** `as_owner` · `as_admin` · `as_staff` · `as_client` · `unauth` — an `httpx` client
  pre-authenticated as that principal. Later phases run domain tests under realistic identities for free.
- **Factories:** `make_business` · `make_user` · `make_staff` · `make_client` · … — valid, scoped rows
  for arranging state.

## What tests can / can't replace
- ✅ Replace manual QA for backend **logic, contracts, authorization, data integrity**.
- ❌ Don't cover: real third-party calls (→ sandbox smoke) and frontend **visual/UX** (separate track).
