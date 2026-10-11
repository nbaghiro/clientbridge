# Localization foundation plan

Status: ready to execute on "go". No schema change is part of this plan.

This plan puts the full localization foundation in place with English (`en-CA`) as the only language. Every user-facing text in the web app, the iPhone and Android apps, Connect, the embed script, the marketing site, printed documents, notifications and exports will come from a message catalog, and every formatted value will go through one locale-aware formatter. The build will reject new text or formatting that bypasses either. Nothing is translated, and no language setting is added for businesses, users or clients; those belong to the later work of supporting a second language, described at the end. The [task queue](tasks.json) lists each task's dependencies, scope and acceptance criteria.

## Starting point

The current state was audited on 2026-10-10. Copy is already centralized: the frontend reads every UI string from `frontend/packages/app-core/src/strings.ts` (about 2,875 plain entries and 672 interpolation functions in 52 domains), and the `local/no-inline-ui-string` ESLint rule keeps inline text out of screens. The gaps this plan closes:

- There is no message format or catalog runtime. Plurals are 95 hand-written English checks, ordinals are an English array, and about 109 template literals in `domain/` and the apps join formatted parts in English order and punctuation, with 24 more list joins.
- About 30 `"en-CA"` literals sit outside tests, 13 of them as defaults in `datetime.ts`. `formatMoney` always prefixes `$` and ignores the currency (383 call sites), `parseCents` only reads English input, and about 74 sites format percentages and quantities with `toFixed`. The marketing site keeps its own copy of the money formatter.
- Staff apps and Connect show times in the device's time zone. The business time zone is stored as free text, is not validated, and is used in one place on the frontend.
- The backend has 38 notification builders returning English f-strings, four more emails in `services/auth.py` and `services/staff.py`, an English SMS opt-out line, a `_money` helper with no thousands separator and a sign bug for negative amounts, ISO-style dates in emails, hardcoded `CAD` in two messages, English tax names in `services/tax.py`, and English CSV export headers in `services/reports.py`.
- The marketing site prose is English TypeScript modules, the embed script hardcodes its dialog titles, `<html lang>` is fixed in every app, mobile permission prompts are inline in `app.config.ts`, and nothing tests another locale or time zone.
- `.docs/architecture.md` mentions a business locale that does not exist.

## Definition of done

1. Every user-facing text on every surface is read from a catalog: `frontend/packages/app-core/locales/en-CA.json` for the apps, Connect and the embed script, `frontend/apps/site/locales/en-CA.json` for the marketing site, `backend/src/clientbridge/locales/en_CA.po` for backend output, and per-locale native files for mobile permission prompts.
2. Every formatted money amount, number, percentage, date, time, range, list and duration goes through the formatter module, which takes its locale from one place and its currency and time zone explicitly.
3. Dates and times display in the business time zone on staff surfaces and Connect, and Connect labels the zone when the visitor's zone differs.
4. A run with the generated pseudo-locale (`en-XA`: accented, about 35% longer, bracketed) shows no unconverted text in web, mobile, Connect, the embed dialog, printed documents, emails, SMS, push and CSV exports, and the layouts survive the longer text. The pseudo-locale is a development and test tool only; it is never offered to users.
5. English output is unchanged everywhere except for the deliberate fixes listed in this plan (backend money and dates, time zone display).
6. The gate (`make check` and CI) fails on new inline copy, composed sentences outside the catalog, direct `Intl` or `toLocale*` use outside the formatter, locale literals, hand-written plurals, invalid catalog messages, user-facing backend strings outside the backend catalog, and stale generated files.

## Decisions

### Message format and library

The frontend uses ICU MessageFormat through FormatJS's core package, `intl-messageformat`, without `react-intl`. The catalog is read outside React (view-model hooks, the embed script, Connect's public clients), so a plain formatter fits better than a React-bound one. ICU is the format translation tools and translators already work with, and it covers plurals, `select` and `selectordinal`. i18next was considered; its own plural and interpolation syntax is less portable to translation tools, and it adds runtime features the catalog does not need.

The backend uses Babel with a gettext `.po` catalog. Babel also provides `format_currency`, `format_decimal`, `format_percent` and `format_datetime` with time zones, which replace the hand-written formatting in `services/notifications.py`. A shared ICU catalog for both sides was considered; Python ICU support needs the native ICU library (`pyicu`), which complicates the build, and the backend has about 50 messages compared with 3,500 on the frontend.

Formatted values are passed into messages as already-formatted strings from the formatter module. Messages handle plurals, `select` and word order; they do not format money or dates themselves. This keeps one formatting implementation and keeps catalog entries readable.

### Catalog shape and call sites

The English source moves to `frontend/packages/app-core/locales/en-CA.json`. Each entry has the ICU message, an optional description for future translators, and for interpolated entries the ordered argument names:

```json
"billing.overdueBy": {
    "message": "{days, plural, one {# day late} other {# days late}}",
    "args": ["days"],
    "description": "Detail line under an overdue invoice."
}
```

A generator (`make gen-strings`, covered by `codegen-check`) reads the source and writes a typed accessor, so `strings.<domain>.<key>` keeps its shape: plain entries stay strings and interpolated entries stay functions with the same positional arguments, typed from the ICU syntax (plural and number arguments are `number`, others are `string`). The 162 module-level aliases such as `const s = strings.billing` keep working, because each leaf is resolved against the active locale's compiled messages when it is read. The generator also writes `en-XA.json` from the English source.

Values computed once when a module loads, such as arrays of labels built at import time, would not follow a future locale change. These are converted to functions or getters, and a typed lint rule rejects new ones.

### Active locale

The locale is a single setting in app-core and in the backend's `core/locale.py`, fixed to `en-CA`, with the list of available locales derived from the catalog files present. App startup sets it once before the first render and sets `<html lang>` from it. The pseudo-locale can be switched on in development builds, the playground and tests through an environment flag. There is no user-facing language setting and no locale column in the database.

The functions that would later choose a locale per business, user, client or visitor exist as single entry points (`activeLocale()` on the frontend, `locale_for(...)` on the backend) that return `en-CA` today. Every surface reads the locale through them, so adding the settings later changes those functions and not the call sites.

### Time zones

Every displayed date and time on staff surfaces and Connect uses the business time zone, read from the replica on staff surfaces and from the public profile on Connect. The formatter takes the zone explicitly; device-zone getters (`getHours`, `getDate`) are removed from display and grouping code, including the SQL date expressions in app-core. The backend validates the time zone against IANA names, and the business screen offers a picker instead of free text. Hour cycle and week start come from the locale through the formatter, so English output stays 12-hour with a Monday-first week.

### Server errors

API error responses keep a stable `error` code; clients map codes and HTTP statuses to catalog messages, as they do today. The `message` field stays English, for logs and developers, and is never rendered. A lint rule rejects rendering an API error's message.

## Scope by surface

Frontend apps (web, mobile, Connect, playground): the catalog conversion, formatter and time zone work above, and `<html lang>` set from the active locale at startup.

Shared components (`@clientbridge/ui`): component copy already comes from `strings.ui`. Built-in formats (calendar headers, date and time fields, money input) use the formatter, and fixed widths and truncation are audited against the pseudo-locale.

Mobile native: iOS and Android permission prompts and the app's display name move from inline config into per-locale native files (English only), with `CFBundleLocalizations` and the Android locale config declaring `en`.

Documents (invoices, estimates, receipts, signed contracts): titles, page counters, tax registration labels and amounts come from the catalog and the formatter.

Backend output: notifications (email subject and body, SMS, push), auth and staff emails, the SMS opt-out line, CSV export headers, and tax labels rendered from the GST, HST, PST and QST codes through the catalog.

Connect embed script: `public/embed.js` is built from source with its strings taken from the catalog.

Marketing site: prose moves to `apps/site/locales/en-CA.json` with the same ICU format and generator; structural data (icons, photo names, routes) stays in TypeScript keyed by id. Its duplicate money formatter is removed in favour of the shared formatter.

## Enforcement

Frontend, in `pnpm lint`:

- `local/no-inline-ui-string` stays and also covers the embed source and site components.
- `local/no-raw-format` rejects `toLocaleString`, `toLocaleDateString`, `toLocaleTimeString`, `new Intl.*`, `toFixed` in display code and locale literals (`"en-CA"`, `"en-US"`) outside the formatter module.
- `local/no-composed-copy` rejects template literals and string concatenation whose static parts contain letters or separators (`·`, `,`, `:`) when the result reaches UI copy. SQL built through the `sql` helpers, URLs, class names and test ids are exempt; the heuristics and the false-positive count are settled in task F60.
- `local/no-module-scope-copy`, a typed rule, rejects reading a catalog leaf at module scope.
- `local/no-hand-plural` rejects `=== 1` and `!== 1` checks that choose between strings.
- `local/no-error-message-copy` rejects rendering the message of a caught API error.
- `check-catalogs.mjs` validates ICU syntax, checks that every `args` list matches the placeholders in its message, and fails on unused keys.
- `make codegen-check` fails when the generated accessor or `en-XA.json` is stale.

Backend, in `make lint`:

- `scripts/check_structure.py` rejects string literals and f-strings passed to the email, SMS and push senders, CSV writers and client-visible errors outside the catalog lookup.
- `pybabel extract` regenerates `messages.pot`; `codegen-check` fails when it or the generated `en_XA.po` is stale.

Tests:

- App-core tests run under `TZ=America/Vancouver`, `TZ=America/Halifax` and `TZ=Asia/Tokyo` in CI.
- Formatter tests cover `en-CA` and `en-XA` output for money in more than one currency, negative amounts, percentages, dates, times, ranges, lists and plurals.
- A playground and web e2e suite runs in `en-XA` and fails on visible text without pseudo-locale markers and on clipped text in the audited components.
- Backend tests render every notification builder and CSV export in `en_XA` and assert that no unconverted text remains.

Documentation: the Copy section in `CLAUDE.md` and `.docs/engineering.md` describe the catalog format, the formatter rule, the pseudo-locale and the gate. `.docs/architecture.md` describes the active-locale entry points and the time zone rule, and its incorrect mention of a business locale is corrected.

## Delivery order

| Stage | Tasks | Checkpoint |
|---|---|---|
| Baseline | F00 | Inventory and existing gate failures recorded. |
| Catalog foundation | F10 to F15 | English served from `en-CA.json` through the generated accessor; no hand plurals, composed copy or module-scope copy left; output unchanged. |
| Formatting and time zones | F20 to F25 | One formatter; no locale literal outside it; displays and grouping use the business time zone. |
| Backend | F30 to F36 | Every backend-rendered text comes from the `.po` catalog and Babel formatting; error contract in place. |
| Other surfaces | F40 to F43 | Documents, native prompts, embed script and marketing site read their catalogs. |
| Enforcement and acceptance | F60 to F66 | Gate rules active; pseudo-locale and time zone suites green; conventions updated. |

The catalog foundation runs first because the formatting and enforcement tasks edit the same call sites; doing it once avoids two passes over the 3,500 entries. Each stage ends with `make check`, the playground suite and a manual look at web, iOS and Android in `en-XA`.

## Later: adding a second language

These are deliberately left out and become a separate execution when a second language is chosen. They need no change to the foundation above.

- Schema changes, each needing approval: `businesses.locale`, `clients.preferred_language`, `users.locale`, and stable keys for subject attribute values that are also labels (pet temperaments).
- The bodies of `activeLocale()` and `locale_for(...)` resolving from those settings, the device language (`expo-localization`) and Connect's `?lang=` parameter, plus language pickers in settings, on the user profile and on client records.
- The translated catalog files, missing-key reporting for partial locales, French plural-category checks, store listings, `/fr` routes and `hreflang` on the site, and locale-aware hosted surfaces such as Stripe's `locale` parameter.
- Product decisions: whether an issued document keeps the language it was sent in, and whether Quebec businesses default to French.

## Execution rules

Work follows the same rules as the other executions: one worker per settled task, dependency order from the queue, focused verification per task, the full gate at each stage boundary, and progress with evidence in `progress.md`. Other sessions' uncommitted work in the checkout is preserved and not reformatted. Commits and pushes happen only when asked.
