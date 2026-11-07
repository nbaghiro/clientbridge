# Founding Engineer

## About Clientbridge

Clientbridge is one app for service businesses in Canada: pet groomers, salons, cleaners, personal trainers, tutors and home repair teams. It handles online booking with deposits, the calendar, client records, invoices and estimates, card payments online and with Tap to Pay, an online shop, packages, memberships and gift cards, staff pay, two-way messaging and Canadian sales tax. It runs on the web, iPhone and Android, and the schedule and client list keep working when the connection drops.

We're a small founding team getting ready to launch, and most of the product is already built.

## The role

You'll be the first engineer to join the founders. You'll work across the whole system, from the database to the mobile app, and take real features from an idea to production. You'll also help decide how we build as the team grows.

## What you'll work on

The stack is Python and FastAPI on PostgreSQL, React and Vite on the web, and React Native with Expo on mobile, all in one monorepo. A few parts of the design you'll get to know well:

- **Local-first sync.** Each device keeps its own copy of the business's data in SQLite, streamed from Postgres through PowerSync. Screens read from that local copy, which is why the calendar opens instantly and keeps working offline.
- **Five surfaces.** Every feature is exactly one of five things: a synced read, an offline command, a server command, a webhook or public page, or a background job. Anything that needs a server-only guarantee, such as invoice numbering, booking capacity or money, is a server command that runs atomically, is audited, and can be retried safely.
- **A real ledger.** Balances live only in a double-entry ledger. Every payment, refund, deposit and payout posts a balanced journal, so we never store a balance that can drift.
- **Payments.** Stripe Connect, with each business as its own merchant, card payments online and in person, pre-authorized debit and Tap to Pay on both phones.
- **One shared view-model.** Web and mobile share their data and form logic through one package, and each platform keeps its own idiomatic UI in a matching set of shared components.
- **Copy and formatting in one place.** Every interface string comes from a message catalog, and every amount, date and time goes through one formatter in the business's own time zone. A pseudo-locale in the test suite catches anything that slips through.
- **Infrastructure as code.** Google Cloud with Cloud SQL and Kubernetes, managed with Pulumi, and an Ory Kratos auth service.

The bar for quality is high and enforced by tools, not by review alone: strict pyright and TypeScript, integration tests against a real Postgres database, and 90% branch coverage in CI.

## What you'll do

- Build features end to end, from the schema and API to the web and mobile screens.
- Own parts of the system, such as payments, sync, scheduling or the public booking pages, and make them dependable.
- Ship, monitor and fix things in production as we onboard our first customers.
- Talk to customers with the sales and support team, and turn what you hear into product changes.
- Help set the engineering practices for the people who join after you.

## What you'll bring

- Several years of building and running production software.
- Strong Python and TypeScript, and comfort with React.
- A good grasp of relational databases, transactions and data modelling.
- Care for the details that make software trustworthy: tests, types, clear names and small, reviewable changes.
- The habit of finishing things, including the parts nobody asked for.

## Nice to have

- React Native or Expo experience.
- Payments, Stripe or accounting work.
- Offline sync or local-first apps.
- Experience at an early-stage startup.

## How we work

We keep the codebase small and consistent, write little ceremony and few comments, and put the effort into code that explains itself. You'll have a real say in the product and a meaningful share in the company.

## How to apply

Apply on LinkedIn with a short note about something you built that you're proud of, and what you'd want to own here.
