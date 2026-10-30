# Launch readiness

The launch QA plan: a pass across every product surface, as 11 areas and 62 tickets. Most of the product is built, so the work is to test each area, fix what comes up and move on. Each ticket is one outcome a business can rely on, and it passes when its QA steps pass on the platforms it names. Each lists the e2e cases that prove it, the cases still to write and what can only be checked by hand.

Linear tracks status: the [Launch QA initiative](https://linear.app/clientbridgeca/initiative/launch-qa-2ad161486768) in the `clientbridgeca` workspace, team Engineering (key `CB`). Each area is a project, each ticket an issue whose description is the ticket's text below, and each dependency a `blocks` relation. The [Launch board](https://linear.app/clientbridgeca/view/e48dd1630428) is the one place to work from. Its columns are the dev flow: Backlog, Selected for dev, In progress, Ready for review, In staging and Done. Its rows are the areas in the order below, so work from the top row down. The first ten areas are the product, each a group of functionality that can be walked end to end; the last, Platform and launch, holds the work around the product. Two of its tickets come first even so: the staging build (CB-61) and staging setup (CB-69), because most product tickets can't pass on staging without them.

**Bookmarks:** [Launch board](https://linear.app/clientbridgeca/view/e48dd1630428) for daily work, [Launch QA initiative](https://linear.app/clientbridgeca/initiative/launch-qa-2ad161486768) for progress by area, [My issues](https://linear.app/clientbridgeca/my-issues) and [All issues](https://linear.app/clientbridgeca/team/CB/all) (including Duplicate and Not doing). Each area below links its Linear project.

## How tickets work

- **This file and Linear are the plan.** Don't create a ticket for every piece of work. Work on a capability belongs to the ticket that already covers it: update that ticket's steps, Automated by or To automate lines rather than opening a new one.
- **A new ticket is a new user outcome** that no ticket covers and that can be tested on its own in one QA session. Small fixes, follow-ups and e2e cases are not tickets; they go on the ticket they serve. Agree a new ticket before creating it.
- **A ticket moves through the dev flow.** Selected for dev, then In progress (run its steps locally and fix what comes up), Ready for review (the fixes' pull request), In staging (merged and deployed; run its steps on staging) and Done once they pass there. A ticket with nothing to fix skips Ready for review.
- **A failure stays on its ticket.** Record what failed on the ticket and move it back to In progress. Only open a separate issue for a bug that blocks other tickets.
- **An area is done when its tickets are Done and its walk passes on staging.** Each area below ends its outcome with a walk: one pass through the area's functionality as a business would use it. Run it once its tickets are Done, then mark the Linear project Completed. A failure goes back on the ticket that covers it.
- **This file comes first.** Change a ticket's text here, then copy it to the Linear description so the two match word for word. Status lives only in Linear: Backlog, Selected for dev, In progress, Ready for review, In staging and Done (and Not doing for anything dropped).
- **Dependencies are rare.** QA runs on the demo businesses, which already have clients, a catalog, staff, hours, Stripe and tax set up, so a ticket depends on another only when its setup needs something that ticket's flow creates and demo data can't supply: a brand-new account or business, or the store builds. Dependencies only suggest an order; everything else can be tested in any order.
- **Done stays done through automation.** A ticket's Automated by cases run in CI on every pull request, so a change that breaks a Done ticket fails CI before it merges. Retest a Done ticket by hand only when a change touches its By hand only steps; closing its To automate list is what removes that need.
- **Every ticket uses one layout:** Covers, Before you start, Where to test (one line each for local and staging), QA steps (each with its expected result), Done when, By hand only (when needed), Automated by, To automate and Depends on. Each one carries an Automation label in Linear (Automated, Partly automated or Manual).
- **Linear changes go through its API:** `linear --workspace clientbridgeca api '<query>' --variables-json '<json>'`. A dependency is `issueRelationCreate` with type `blocks`, from the prerequisite (`issueId`) to the ticket that waits on it (`relatedIssueId`). Priority isn't used.

| Area | Ticket | Linear | Automation |
| --- | --- | --- | --- |
| 1. Get set up | Sign up, sign in safely and recover access on every platform | [CB-1](https://linear.app/clientbridgeca/issue/CB-1) | Partly automated |
| 1. Get set up | Onboard a business and see its brand on every client page | [CB-3](https://linear.app/clientbridgeca/issue/CB-3) | Partly automated |
| 1. Get set up | Invite the team and hold every role to its list | [CB-4](https://linear.app/clientbridgeca/issue/CB-4) | Partly automated |
| 1. Get set up | Remove a team member: their work moves and their devices lose access | [CB-23](https://linear.app/clientbridgeca/issue/CB-23) | Partly automated |
| 1. Get set up | Connect Stripe and know when payments and payouts work | [CB-5](https://linear.app/clientbridgeca/issue/CB-5) | Partly automated |
| 1. Get set up | Run the trial, buy a plan, bill seats and go read-only | [CB-6](https://linear.app/clientbridgeca/issue/CB-6) | Partly automated |
| 1. Get set up | Charge the right sales tax in every province | [CB-7](https://linear.app/clientbridgeca/issue/CB-7) | Partly automated |
| 2. Clients and catalog | Keep a client record up to date from any device | [CB-8](https://linear.app/clientbridgeca/issue/CB-8) | Partly automated |
| 2. Clients and catalog | Record what each client books for | [CB-9](https://linear.app/clientbridgeca/issue/CB-9) | Partly automated |
| 2. Clients and catalog | Keep notes, photos and the client's story in one place | [CB-10](https://linear.app/clientbridgeca/issue/CB-10) | Partly automated |
| 2. Clients and catalog | Tag clients and merge duplicates without losing anything | [CB-11](https://linear.app/clientbridgeca/issue/CB-11) | Partly automated |
| 2. Clients and catalog | Set up services, classes and shared resources that book the way they read | [CB-13](https://linear.app/clientbridgeca/issue/CB-13) | Partly automated |
| 2. Clients and catalog | Set up products and keep stock true to the shelf | [CB-14](https://linear.app/clientbridgeca/issue/CB-14) | Automated |
| 3. Run the day | See the day on Today | [CB-44](https://linear.app/clientbridgeca/issue/CB-44) | Partly automated |
| 3. Run the day | Set hours, time off and closures that decide open times | [CB-16](https://linear.app/clientbridgeca/issue/CB-16) | Partly automated |
| 3. Run the day | Book, move and cancel visits from the calendar | [CB-17](https://linear.app/clientbridgeca/issue/CB-17) | Partly automated |
| 3. Run the day | Run a visit from On my way to checkout | [CB-18](https://linear.app/clientbridgeca/issue/CB-18) | Manual |
| 3. Run the day | Book and manage repeat visits | [CB-19](https://linear.app/clientbridgeca/issue/CB-19) | Manual |
| 3. Run the day | Run classes, waitlists and programs | [CB-20](https://linear.app/clientbridgeca/issue/CB-20) | Automated |
| 3. Run the day | Work a job with a crew, visit records and photos | [CB-21](https://linear.app/clientbridgeca/issue/CB-21) | Manual |
| 3. Run the day | Remind clients before each visit | [CB-22](https://linear.app/clientbridgeca/issue/CB-22) | Manual |
| 4. Book online | Take a booking online with a deposit | [CB-24](https://linear.app/clientbridgeca/issue/CB-24) | Partly automated |
| 4. Book online | Let returning clients book as themselves | [CB-25](https://linear.app/clientbridgeca/issue/CB-25) | Automated |
| 4. Book online | Add products to a booking and bill them once | [CB-26](https://linear.app/clientbridgeca/issue/CB-26) | Automated |
| 4. Book online | Let clients reschedule or cancel from their link | [CB-27](https://linear.app/clientbridgeca/issue/CB-27) | Partly automated |
| 4. Book online | Put the business page and booking on the business's own site | [CB-28](https://linear.app/clientbridgeca/issue/CB-28) | Automated |
| 5. Sell at the desk and online | Ring up a sale at the desk and send the receipt | [CB-29](https://linear.app/clientbridgeca/issue/CB-29) | Partly automated |
| 5. Sell at the desk and online | Take card payments at the desk | [CB-30](https://linear.app/clientbridgeca/issue/CB-30) | Partly automated |
| 5. Sell at the desk and online | Take Tap to Pay on real phones | [CB-31](https://linear.app/clientbridgeca/issue/CB-31) | Manual |
| 5. Sell at the desk and online | Add tips and discounts that add up by hand | [CB-32](https://linear.app/clientbridgeca/issue/CB-32) | Partly automated |
| 5. Sell at the desk and online | Save a client's card or bank account and charge it | [CB-12](https://linear.app/clientbridgeca/issue/CB-12) | Partly automated |
| 5. Sell at the desk and online | Fill online shop orders from cart to pickup | [CB-41](https://linear.app/clientbridgeca/issue/CB-41) | Partly automated |
| 6. Invoice and get paid | Quote with an estimate and turn it into an invoice | [CB-33](https://linear.app/clientbridgeca/issue/CB-33) | Automated |
| 6. Invoice and get paid | Invoice, send by text and get paid by link, card or by hand | [CB-34](https://linear.app/clientbridgeca/issue/CB-34) | Partly automated |
| 6. Invoice and get paid | Print or share invoices, estimates, receipts and statements | [CB-36](https://linear.app/clientbridgeca/issue/CB-36) | Manual |
| 6. Invoice and get paid | Take deposits and apply them to the bill | [CB-37](https://linear.app/clientbridgeca/issue/CB-37) | Partly automated |
| 7. Gift cards, packages and memberships | Set up packages, memberships and gift card items | [CB-15](https://linear.app/clientbridgeca/issue/CB-15) | Manual |
| 7. Gift cards, packages and memberships | Sell and redeem gift cards | [CB-38](https://linear.app/clientbridgeca/issue/CB-38) | Partly automated |
| 7. Gift cards, packages and memberships | Sell, use and expire packages | [CB-39](https://linear.app/clientbridgeca/issue/CB-39) | Partly automated |
| 7. Gift cards, packages and memberships | Run memberships through renewals and failures | [CB-40](https://linear.app/clientbridgeca/issue/CB-40) | Partly automated |
| 8. Refunds and the books | Refund correctly and unwind what the sale created | [CB-42](https://linear.app/clientbridgeca/issue/CB-42) | Automated |
| 8. Refunds and the books | Handle chargebacks to their outcome | [CB-43](https://linear.app/clientbridgeca/issue/CB-43) | Automated |
| 8. Refunds and the books | Hand the bookkeeper reports that add up | [CB-45](https://linear.app/clientbridgeca/issue/CB-45) | Partly automated |
| 8. Refunds and the books | Record filed GST/HST returns | [CB-46](https://linear.app/clientbridgeca/issue/CB-46) | Automated |
| 8. Refunds and the books | Match payouts and fees with Stripe | [CB-47](https://linear.app/clientbridgeca/issue/CB-47) | Partly automated |
| 8. Refunds and the books | Pay the team | [CB-48](https://linear.app/clientbridgeca/issue/CB-48) | Partly automated |
| 9. Talk to clients | Text clients from one inbox, on the business's own number | [CB-49](https://linear.app/clientbridgeca/issue/CB-49) | Automated |
| 9. Talk to clients | Honour STOP and consent everywhere | [CB-50](https://linear.app/clientbridgeca/issue/CB-50) | Automated |
| 9. Talk to clients | Send broadcasts only to clients who agreed | [CB-51](https://linear.app/clientbridgeca/issue/CB-51) | Partly automated |
| 9. Talk to clients | Collect intake forms before the first visit | [CB-53](https://linear.app/clientbridgeca/issue/CB-53) | Partly automated |
| 9. Talk to clients | Send contracts and keep what was signed | [CB-54](https://linear.app/clientbridgeca/issue/CB-54) | Automated |
| 9. Talk to clients | Ask for Google reviews after visits | [CB-55](https://linear.app/clientbridgeca/issue/CB-55) | Partly automated |
| 10. Work anywhere | Keep working offline and come back cleanly | [CB-56](https://linear.app/clientbridgeca/issue/CB-56) | Automated |
| 10. Work anywhere | Keep tabs and devices in step | [CB-57](https://linear.app/clientbridgeca/issue/CB-57) | Automated |
| 10. Work anywhere | Notify staff on their phones | [CB-59](https://linear.app/clientbridgeca/issue/CB-59) | Partly automated |
| 10. Work anywhere | Use the app on iPhone, Android and iPad | [CB-60](https://linear.app/clientbridgeca/issue/CB-60) | Partly automated |
| 11. Platform and launch | Make staging run every QA step | [CB-69](https://linear.app/clientbridgeca/issue/CB-69) | Manual |
| 11. Platform and launch | Ship store builds staff can install | [CB-61](https://linear.app/clientbridgeca/issue/CB-61) | Manual |
| 11. Platform and launch | Run the business live in production | [CB-64](https://linear.app/clientbridgeca/issue/CB-64) | Manual |
| 11. Platform and launch | Operate the platform from the admin console | [CB-65](https://linear.app/clientbridgeca/issue/CB-65) | Partly automated |
| 11. Platform and launch | Launch a marketing site that makes no claim the product can't back | [CB-66](https://linear.app/clientbridgeca/issue/CB-66) | Partly automated |
| 11. Platform and launch | Run a full business day end to end | [CB-68](https://linear.app/clientbridgeca/issue/CB-68) | Manual |

---

## 1. Get set up

A new owner signs up, sets up the business, brings in the team, connects Stripe, picks a plan and charges the right tax.

**Linear project:** [1. Get set up](https://linear.app/clientbridgeca/project/1-get-set-up-c5ac21ce18c7)

**Walk on staging:** Sign up as a new owner, set up the business with its brand, invite a staff member who signs in on a phone, connect Stripe, start the plan and ring up a taxed sale.

### Sign up, sign in safely and recover access on every platform (CB-1)

**Covers:** Web Login and Setup > Sign-in & security, mobile Login and Sign-in & security, the auth service, Mailpit or real email on staging
**Before you start:** A fresh email address you can read; a Google account on the same address; an authenticator app; a security key or platform passkey on a laptop; web, an iPhone and an Android phone with the staging build

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile`. Open web at [http://localhost:8700](<http://localhost:8700>) and mobile in the iOS simulator. Email lands in Mailpit at [http://localhost:8715](<http://localhost:8715>).
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Mobile waits on a staging build (CB-61). Mail to the demo's `.example` addresses isn't sent, so use an address you can read.

**QA steps**

 1. From the marketing site, click Start free.
    **Expect:** the browser lands on `/signup`, not the sign-in page.
 2. Sign up with the new email and enter a wrong code, then the mailed code.
    **Expect:** the wrong code is refused with a plain message; the right one opens onboarding.
 3. Reload while confirming.
    **Expect:** you stay signed in and are not sent back to confirm again.
 4. Sign out and back in on web, iPhone and Android.
    **Expect:** each lands on Today; on mobile, killing and reopening the app keeps you signed in.
 5. Reset the password with the emailed code on web.
    **Expect:** you are signed in on that device only; the old password fails.
 6. Change the password in Setup > Sign-in & security.
    **Expect:** the other devices are signed out at their next request.
 7. Sign in with Google on the same address.
    **Expect:** the same account and business open; on mobile the Google button shows the unavailable state.
 8. Try a wrong password five times.
    **Expect:** the same error each time and no detail about whether the account exists.
 9. Turn on an authenticator app on web, then sign out and in with a wrong code and the right one.
    **Expect:** a QR code and a code check; backup codes are shown once; the wrong code is refused and the right one signs in.
10. Sign in with a code on iPhone and Android.
    **Expect:** both accept the authenticator code.
11. Sign in with one backup code, then try it again.
    **Expect:** the first use works, the second is refused.
12. On web, add a security key, sign in with password and key, then remove it.
    **Expect:** the removed key no longer signs in. Keys are web only: on mobile, an account whose only second factor is a key is asked to add an authenticator or backup codes on the web.

**Done when:** Every step passes on web, iPhone and Android with no workaround, each second factor can be added, used and removed, and a used backup code never works twice.

**By hand only**

* Google sign-in with a real Google account (consent screen, callback on the staging host).
* Proxy rate limiting on `/auth/self-service/*`, which only exists on the deployed gateway.
* Native passkeys are not built; check only the mobile fallback message.

**Automated by**

* `XB-E2E-01 (web)`
* `XB-E2E-02 (web)`
* `XB-E2E-03 (web)`
* `NATIVE-IOS-01 (native-ios, native-android)`
* `web: auth.e2e.ts › signup has its own entry link and invites explain a missing token`
* `web: auth.e2e.ts › reloading while confirming the email keeps the new account signed in`
* `web: auth.e2e.ts › an account whose identity was recreated confirms its email instead of looping`
* `web: auth.e2e.ts › auth errors offer a clean return to sign in`
* `web: auth.e2e.ts › sign-in, signup and reset validation at <width>px`
* `mobile: auth.recovery.yaml (recovery end to end, unregistered)`
* `mobile: staff.yaml (sign-in entry and Google unavailable, unregistered)`
* `XB-E2E-04 (web)`

**To automate**

* `ID-E2E-02` in `apps/web/e2e/auth.e2e.ts`: Wrong then right verification code, then sign-in from a second context reaches the same business (family ID01).
* `ID-E2E-03` in `apps/web/e2e/auth.e2e.ts`: An old session is refused on its next business action after recovery (ID03).
* `NATIVE-AUTH-01` in `apps/mobile/e2e/auth.session.yaml`: Register NATIVE-IOS-01's Android run and add sign-in after a password change elsewhere.
* `ID-E2E-04` in `apps/web/e2e/auth.e2e.ts`: Backup codes: use, reuse refused, regenerate, old code refused (ID04).
* `ID-E2E-05` in `apps/web/e2e/auth.e2e.ts`: Security key with Playwright's virtual authenticator: register, sign in, remove, removed key refused (ID05).

**Depends on:** Nothing

### Onboard a business and see its brand on every client page (CB-3)

**Covers:** Web and mobile Onboarding, Setup > Business, Get set up, Connect business, booking, pay and shop pages
**Before you start:** A new account from CB-1 with no business

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile dev-connect`. Open web at [http://localhost:8700](<http://localhost:8700>), mobile in the iOS simulator and Connect at `book.`, `shop.`, `pay.` and `<slug>.localhost:8709`.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>) and Connect at `book.`, `shop.`, `pay.` and `<slug>.staging.clientbridge.ca`, with the same logins. Mobile waits on a staging build (CB-61).

**QA steps**

1. Onboard a Nova Scotia pet groomer.
   **Expect:** Today opens; Setup shows the Atlantic zone, HST registration off and pets as the subject.
2. Onboard a home cleaning business and a client-only salon on other accounts.
   **Expect:** the cleaner records properties; the salon shows no subject fields anywhere.
3. Set colour, tagline, logo and cover on web, then change the logo from a phone.
   **Expect:** the business page, booking page, pay page and shop all show the new brand and favicon.
4. Open Today, Schedule, Clients, Payments and Inbox with no data.
   **Expect:** each explains what to add first; the Get set up checklist ticks items as they are done.
5. Try to change the province after onboarding.
   **Expect:** it is locked, with a reason.

**Done when:** A new business looks like itself on every Connect page within five minutes of signing up, and each industry gets the right subject.

**By hand only**

* Logo taken with the phone camera (native image picker).

**Automated by**

* `ID-E2E-01 (web)`
* `XB-E2E-01 (web)`
* `connect: publicLanding.e2e.ts › business favicon follows the homepage and booking branding`
* `connect: publicLanding.e2e.ts › empty businesses do not advertise unavailable services or products`
* `web: auth.e2e.ts › existing business never flashes onboarding during sign-in or a slow reload`

**To automate**

* `CFG-E2E-05` in `apps/web/e2e/business.e2e.ts`: Brand colour, logo and cover set in Setup reach the booking, pay and shop pages (CFG08).
* `CFG-E2E-06` in `apps/web/e2e/business.e2e.ts`: Province is locked after onboarding (CFG07); client-only industry shows no subject fields.

**Depends on:** CB-1

### Invite the team and hold every role to its list (CB-4)

**Covers:** Setup > Team & hours, accept-invite page, role gates on every screen and endpoint, web and mobile
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234; two fresh email addresses for invitees

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile`. Open web at [http://localhost:8700](<http://localhost:8700>) and mobile in the iOS simulator. Email lands in Mailpit at [http://localhost:8715](<http://localhost:8715>).
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Mobile waits on a staging build (CB-61). Mail to the demo's `.example` addresses isn't sent, so use an address you can read.

**QA steps**

1. Invite a staff member and an admin; accept each in another browser (accepting is web only).
   **Expect:** each joins with the invited, verified address; an account with another email is refused.
2. Resend one invite and revoke another, then open the revoked link.
   **Expect:** the revoked link explains it is no longer valid.
3. As staff on web, iPhone and Android: open every destination.
   **Expect:** own bookings and hours only, Payments > Sales and My pay only, Inbox > Messages only, Setup > Team & hours and Sign-in & security only.
4. As staff, try a refund, a void, a restock and editing another member's hours.
   **Expect:** each is refused with a worded reason.
5. As admin: open owner-only settings (Plan).
   **Expect:** everything else is reachable; Plan is not.
6. Set a member's title, colour, photo and the services they offer.
   **Expect:** the schedule and booking page reflect them.
7. Downgrade the admin to staff while they have the app open on two devices.
   **Expect:** finance screens disappear on both.
8. Downgrade an admin to staff while their phone and browser are open.
   **Expect:** finance screens and data disappear from both without a sign-out.
9. Invite the owner of another demo business as staff and accept.
   **Expect:** they can switch between both businesses on web and mobile, and each shows only its own data.

**Done when:** Each role sees and can do exactly its list on web, iPhone and Android, and the server refuses the rest.

**Automated by**

* `SEC-E2E-01 (web)`
* `SEC-E2E-02 (web)`
* `SYN-E2E-02 (web)`
* `FLOW-08-A (journeys)`
* `MSG-E2E-13 (web)`
* `SALE-E2E-11 (web)`
* `PLN-E2E-01 (web)`
* `web: auth.e2e.ts › an invite joins the account that signs up with the invited email`
* `web: auth.e2e.ts › an invite refuses an account with a different email`
* `web: auth.e2e.ts › an invitee who skipped confirming the email verifies, then joins`
* `web: shell.e2e.ts › staff: payments, inbox and setup show only what staff can use`
* `mobile: staff.yaml (reduced Payments, Inbox and Setup, unregistered)`
* `sync: revocation.e2e.ts › live renames reach the replica; downgrade, deletion and removal purge its data`

**To automate**

* `TEAM-E2E-01` in `apps/web/e2e/staff.e2e.ts`: Invite lifecycle: two simultaneous accepts, revoke then old URL, resend, expiry (ID07, CFG18).
* `TEAM-E2E-02` in `apps/web/e2e/staff.e2e.ts`: Admin sees everything but Plan; contractor matches staff (CFG12).

**Depends on:** Nothing

### Remove a team member: their work moves and their devices lose access (CB-23)

**Covers:** Setup > Team & hours removal dialog, schedule, Connect, the removed member's devices
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile dev-connect`. Open web at [http://localhost:8700](<http://localhost:8700>), mobile in the iOS simulator and Connect at `book.`, `shop.`, `pay.` and `<slug>.localhost:8709`.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>) and Connect at `book.`, `shop.`, `pay.` and `<slug>.staging.clientbridge.ca`, with the same logins. Mobile waits on a staging build (CB-61).

**QA steps**

1. Remove a member with future visits, a series and a class schedule, choosing reassign.
   **Expect:** the summary lists what moved; each visit lands on a member who offers the service.
2. Remove another, choosing cancel.
   **Expect:** their visits are cancelled and clients told.
3. Remove a member when no one can take a schedule.
   **Expect:** refused, naming the schedule and day.
4. Open Staff pay.
   **Expect:** the removed member is still listed while owed.
5. Remove a member whose phone is offline, then bring it back online.
   **Expect:** the business and its data disappear from their phone.

**Done when:** Removing someone never leaves a visit without a member or a seat without a teacher, and their devices keep nothing from the business.

**Automated by**

* `FLOW-08-A (journeys)`
* `SCH-E2E-06 (journeys)`
* `SYN-E2E-30 (sync)`

**To automate**

* `TEAM-E2E-03` in `apps/web/e2e/journeys/team.journey.ts`: Removal with reassignment of a series and a class schedule, and the refused case (CFG10, CFG11).
* `NATIVE-SYN-01` in `apps/mobile/e2e/offline.yaml`: A removed member's phone purges the business on relaunch.

**Depends on:** Nothing

### Connect Stripe and know when payments and payouts work (CB-5)

**Covers:** Setup > Getting paid on web and mobile, Stripe embedded onboarding and account management
**Before you start:** Staging with Stripe in test mode; a new business from CB-3 with no Stripe account

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile`. Open web at [http://localhost:8700](<http://localhost:8700>) and mobile in the iOS simulator. Run `make stripe-setup` once and keep `make stripe-listen` running for card steps.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Mobile waits on a staging build (CB-61). Card steps use the Stripe sandbox; the demos are linked but their Stripe onboarding isn't finished (CB-69).

**QA steps**

1. Start onboarding and complete Stripe's test identity.
   **Expect:** back in the app, Getting paid reads ready for payments and payouts.
2. On another business, leave a requirement unfinished.
   **Expect:** the app names exactly what is missing in plain words, with Stripe's reason when it rejected a detail.
3. Put payouts on hold in the Stripe sandbox and press Check again.
   **Expect:** Getting paid shows payouts paused while cards still work.
4. Open bank details in account management.
   **Expect:** Stripe asks for its own sign-in code before showing them.
5. Take a $10 test card payment once ready (card 4242).
   **Expect:** the payment is recorded and appears in Payments.

**Done when:** An owner can tell at a glance whether they can take payments and receive payouts, and why not.

**By hand only**

* Completing Stripe-hosted identity verification as a person.

**Automated by**

* `STR-E09 (stripe)`
* `STR-E13 (stripe)`
* `web: payouts.e2e.ts › payment account entrypoints preserve navigation when payment tools are offline`
* `connect: smoke/staff.smoke.ts › signs in to today and reads the payment account`

**To automate**

* `STR-E14` in `apps/connect/e2e/stripe/account.stripe.ts`: A new Accounts v2 merchant with one requirement due shows its wording, then ready after the requirement is met (PAY-E16).

**Depends on:** CB-3

### Run the trial, buy a plan, bill seats and go read-only (CB-6)

**Covers:** Setup > Plan on web (mobile shows the plan read-only), Stripe Checkout and Billing Portal, shell notices, the read-only gate on API and Connect
**Before you start:** Staging with Stripe in test mode; a new business on its trial; Cedar Coast Pet Care for an existing trial; Stripe test clocks

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile dev-connect`. Open web at [http://localhost:8700](<http://localhost:8700>), mobile in the iOS simulator and Connect at `book.`, `shop.`, `pay.` and `<slug>.localhost:8709`. Run `make stripe-setup` once and keep `make stripe-listen` running for card steps.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>) and Connect at `book.`, `shop.`, `pay.` and `<slug>.staging.clientbridge.ca`, with the same logins. Mobile waits on a staging build (CB-61). Card steps use the Stripe sandbox; the demos are linked but their Stripe onboarding isn't finished (CB-69).

**QA steps**

1. Open Plan on a new business.
   **Expect:** 14 days of trial, no card asked for.
2. Subscribe to Premium yearly during the trial.
   **Expect:** Checkout shows the remaining trial and the tax line; the plan page shows the yearly price after returning.
3. Invite a staff member on Premium.
   **Expect:** the seat quantity in Stripe rises by one; the last free seat on a trial fills once and the next invite is refused.
4. Open the Billing Portal and change the card.
   **Expect:** the return lands on Setup > Plan.
5. Advance a test clock past a failed renewal.
   **Expect:** past due, then read-only after cancellation; records stay readable and exportable.
6. While read-only, try a booking from Connect and a new invoice.
   **Expect:** both are refused in words; the owner can still revoke invites, cancel broadcasts and settle money.
7. Check the trial reminder text near day 14.
   **Expect:** one reminder at 09:00 local.
8. Let a trial lapse on a business with an active client membership.
   **Expect:** the owner gets one email saying the memberships still charge.

**Done when:** Every business is trialing, paying through Stripe or read-only, and the owner can see which and why.

**By hand only**

* Stripe Tax registrations and Smart Retries settings in the live Dashboard.

**Automated by**

* `PLN-E2E-01 (web)`
* `PLN-E2E-02 (web)`
* `PLN-E2E-03 (web)`
* `FLOW-08-B (journeys)`
* `SYN-E2E-25 (sync)`
* `OPS-E2E-02 (web)`

**To automate**

* `PLN-E2E-04` in `apps/connect/e2e/stripe/plans.stripe.ts`: Premium monthly Checkout on a test clock, renewal, failed payment to past due to lapsed (PLN01, PLN13, PLN14).
* `PLN-E2E-05` in `apps/connect/e2e/stripe/plans.stripe.ts`: Yearly plan with the monthly seat item; seat quantity follows invites (PLN04).
* `PLN-E2E-06` in `apps/web/e2e/plans.e2e.ts`: Portal return and plan change with a lost response (PLN05, PLN07).

**Depends on:** CB-3

### Charge the right sales tax in every province (CB-7)

**Covers:** Setup > Sales tax on web and mobile, item tax class, invoice and sale tax lines
**Before you start:** Maple and Main Hair Studio (ON, HST), Birchbark (BC, GST + PST), Clearcoat Mobile Detailing (QC, GST + QST), a new Nova Scotia business

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile`. Open web at [http://localhost:8700](<http://localhost:8700>) and mobile in the iOS simulator.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Mobile waits on a staging build (CB-61).

**QA steps**

1. Ontario, tax on: invoice a $100 service.
   **Expect:** $13 HST.
2. BC: a service set to GST only and a product set to standard on one invoice.
   **Expect:** GST on both, PST only on the product.
3. Mark one line exempt.
   **Expect:** no tax on it.
4. Quebec: invoice a $100 service.
   **Expect:** GST and QST as separate lines.
5. Nova Scotia: invoice dated after 2025-04-01.
   **Expect:** 14% HST.
6. Turn tax registration off.
   **Expect:** nothing is charged anywhere, including the shop and booking deposits.
7. Change a tax setting after issuing an invoice.
   **Expect:** the issued invoice keeps its tax.

**Done when:** Every taxed figure matches a hand calculation for the province.

**Automated by**

* `ID-E2E-01 (web)`
* `BILL-DOC-01 (web)`

**To automate**

* `BILL-DOC-21` in `apps/web/e2e/billing.e2e.ts`: Golden tax matrix for ON, BC, QC and NS with exempt and GST-only lines, plus tax off (FIN02, FIN03).

**Depends on:** Nothing

## 2. Clients and catalog

The business loads its clients, what they book for, and the services and products it sells.

**Linear project:** [2. Clients and catalog](https://linear.app/clientbridgeca/project/2-clients-and-catalog-662d8a53883f)

**Walk on staging:** Add a client with a pet and a note, tag them and merge a duplicate, then add a service and a product with stock and see both on the booking page and in Sales.

### Keep a client record up to date from any device (CB-8)

**Covers:** Clients on web and mobile, the command palette and mobile Search, booking pickers
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile`. Open web at [http://localhost:8700](<http://localhost:8700>) and mobile in the iOS simulator.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Mobile waits on a staging build (CB-61).

**QA steps**

1. Add a client on a phone.
   **Expect:** they appear on web within seconds; a phone number another client already has is refused, with a button to open that client.
2. Find them by phone number in the web directory and the command palette.
   **Expect:** both find them.
3. Edit their name on web.
   **Expect:** the phone shows the change.
4. Archive them.
   **Expect:** gone from search and booking pickers; their invoices remain; restore brings them back.
5. Archive two clients in bulk, then restore one.
   **Expect:** each ends in the state chosen.
6. As owner, then as staff, open a client.
   **Expect:** lifetime value shows only for the owner and admin.

**Done when:** A client record reads the same on web, iPhone and Android after every change.

**Automated by**

* `CRM-E2E-01 (web)`
* `CRM-E2E-15 (web)`
* `NATIVE-CRM-01 (native-ios, native-android)`
* `CRM-E2E-06 (journeys)`
* `FLOW-04-A (journeys)`
* `mobile: clients.record.yaml (walk, unregistered)`

**To automate**

* `CRM-E2E-09` in `apps/web/e2e/clients.e2e.ts`: Directory and command palette search by name, phone and subject, and staff without lifetime value (CRM-E18).

**Depends on:** Nothing

### Record what each client books for (CB-9)

**Covers:** Client record subjects on web and mobile, booking composer, Connect details step
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234; Brightwater Home Cleaning (properties); Lakeside Learning Studio (students); Northlight Security (sites); Clearcoat (vehicles)

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile dev-connect`. Open web at [http://localhost:8700](<http://localhost:8700>), mobile in the iOS simulator and Connect at `book.`, `shop.`, `pay.` and `<slug>.localhost:8709`.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>) and Connect at `book.`, `shop.`, `pay.` and `<slug>.staging.clientbridge.ca`, with the same logins. Mobile waits on a staging build (CB-61).

**QA steps**

1. Add a dog with breed, weight and temperament.
   **Expect:** it shows on the record on web and mobile.
2. Book the dog.
   **Expect:** the groomer sees the dog on the booking on their phone.
3. At Brightwater, book online with a new property name and address.
   **Expect:** the property and address appear on the client record.
4. At Lakeside, add a student with grade and school, and set who may collect them with one must-not-collect person.
   **Expect:** the composer offers the student; the alert shows on their visits.
5. At Northlight, add equipment to a site.
   **Expect:** model, serial and warranty end are kept.
6. In the admin console, change Birchbark's edition to properties.
   **Expect:** existing pets still show with their details.
7. Remove a subject that has past visits.
   **Expect:** the history still names it.

**Done when:** Staff always know which pet, student, property, site or vehicle a visit is for.

**Automated by**

* `CRM-E2E-03 (web)`
* `CRM-E2E-08 (web)`
* `CRM-E2E-05 (journeys)`
* `OPS-E2E-02 (web)`

**To automate**

* `CRM-E2E-10` in `apps/web/e2e/clients.e2e.ts`: Pickup permissions and the must-not-collect alert on a student's visit.
* `CRM-E2E-11` in `apps/web/e2e/journeys/client.journey.ts`: Connect booking with a new property address matched to the client's existing place (CRM-E10, CRM-E11).

**Depends on:** Nothing

### Keep notes, photos and the client's story in one place (CB-10)

**Covers:** Client notes, booking notes, photos, client history on web and mobile
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234; a client with a year of history

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile`. Open web at [http://localhost:8700](<http://localhost:8700>) and mobile in the iOS simulator.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Mobile waits on a staging build (CB-61).

**QA steps**

1. Add a note on a phone and pin it on web.
   **Expect:** both devices show it pinned.
2. Delete the note after the confirm.
   **Expect:** it is gone on both devices.
3. Add a note to a booking.
   **Expect:** it shows on the booking panel for staff.
4. Upload a client photo on web.
   **Expect:** it appears on mobile and Connect avatars only after the upload is confirmed.
5. After a visit, open the timeline.
   **Expect:** booking, invoice, payment and message, newest first.
6. Scroll past the device's history window.
   **Expect:** older items load from the server without gaps or duplicates.

**Done when:** The full story of a client fits on one screen and agrees across devices.

**Automated by**

* `CRM-E2E-02 (web)`
* `FILES-E2E-01 (web)`
* `FLOW-04-A (journeys)`
* `SYN-E2E-29 (sync)`
* `web: sync.e2e.ts › history older than the device window is read from the API`

**To automate**

* `CRM-E2E-12` in `apps/web/e2e/journeys/client.journey.ts`: Timeline order after a visit: booking, invoice, payment and message (CRM-E19).

**Depends on:** Nothing

### Tag clients and merge duplicates without losing anything (CB-11)

**Covers:** Client tags, merge dialog on web and mobile
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234; a seeded duplicate client

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile`. Open web at [http://localhost:8700](<http://localhost:8700>) and mobile in the iOS simulator.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Mobile waits on a staging build (CB-61).

**QA steps**

1. Tag two clients from the directory.
   **Expect:** the tag shows on both records and as a broadcast audience.
2. Merge the duplicate into the kept record.
   **Expect:** pets, notes and visits move to the kept record; note history survives.
3. Try to merge a record that has payments into another.
   **Expect:** refused with a reason; nothing moves.

**Done when:** Duplicates can be cleaned up without losing a subject, note or visit, and money is never moved by a merge.

**Automated by**

* `CRM-E2E-04 (web)`
* `FLOW-04-B (journeys)`

**To automate**

* `CRM-E2E-13` in `apps/web/e2e/clients.e2e.ts`: Set and remove tags in bulk; the broadcast audience count follows (CRM-E05).

**Depends on:** Nothing

### Set up services, classes and shared resources that book the way they read (CB-13)

**Covers:** Services & products editor on web and mobile, Setup > Resources, booking page
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234; Ridgeline Strength Studio (Studio and Turf); Riverbend Driving School (three cars)

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile`. Open web at [http://localhost:8700](<http://localhost:8700>) and mobile in the iOS simulator.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Mobile waits on a staging build (CB-61).

**QA steps**

1. Create a 60-minute service with a 10-minute buffer and a 25% deposit, offered by two members.
   **Expect:** the booking page offers only those members, with the right times, price and deposit.
2. Create a class of 6 and a three-day program.
   **Expect:** both appear on the booking page; the program books every day at once.
3. Give a service a pool of two rooms and book both at one time.
   **Expect:** a third overlapping booking is refused in the calendar and hidden on Connect.
4. Edit the price.
   **Expect:** the booking page shows the new price.
5. Enter a price in another currency through the API.
   **Expect:** refused with the catalog copy and nothing saved.
6. Remove a member from a service.
   **Expect:** they stop being offered on Connect and in the calendar.

**Done when:** What the owner sets on a service, class or resource is exactly what clients and staff can book.

**Automated by**

* `SCH-E2E-05 (journeys)`
* `SCH-E2E-06 (journeys)`
* `STR-E10 (web)`
* `CLS-E2E-02 (journeys)`

**To automate**

* `CFG-E2E-07` in `apps/web/e2e/catalog.e2e.ts`: Buffers and deposit percentage on a service match the slots and deposit Connect offers (CFG05, CFG03).

**Depends on:** Nothing

### Set up products and keep stock true to the shelf (CB-14)

**Covers:** Item editor and Stock on web and mobile, Sales, invoice editor, shop
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile`. Open web at [http://localhost:8700](<http://localhost:8700>) and mobile in the iOS simulator.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Mobile waits on a staging build (CB-61).

**QA steps**

1. Add a shampoo with SKU, cost, price, a photo taken on the phone, stock 3 and low at 1.
   **Expect:** it shows in Sales, the invoice editor and the shop with its image.
2. Reuse its SKU on another product.
   **Expect:** refused as taken.
3. Sell 2 at the desk.
   **Expect:** 1 left and flagged low.
4. Refund one.
   **Expect:** 2 left. Restock 5: 7 left, no longer low.
5. Lose the network while saving opening stock, then retry.
   **Expect:** one product and one stock movement.
6. Archive the product.
   **Expect:** it leaves every selling screen; restore brings it back.

**Done when:** A product is set up once, sells the same way everywhere, and the count matches the shelf after a day of sales.

**By hand only**

* Photo from the phone camera.

**Automated by**

* `CFG-E2E-01 (web)`
* `CFG-E2E-02 (web)`
* `CFG-E2E-03 (web)`
* `CFG-E2E-04 (web)`
* `SALE-E2E-01 (web)`
* `SALE-E2E-10 (web)`
* `FLOW-03-A (journeys)`
* `FLOW-03-B (journeys)`

**To automate**

* `CFG-E2E-08` in `apps/web/e2e/catalog.e2e.ts`: Archive and restore a product: it leaves Sales, invoices, the shop and add-ons (CFG04).

**Depends on:** Nothing

## 3. Run the day

Staff open Today, set hours, book, run each visit from arrival to checkout, and nothing is left open.

**Linear project:** [3. Run the day](https://linear.app/clientbridgeca/project/3-run-the-day-58b5822a4801)

**Walk on staging:** From Today, set a member's hours, book a visit and a repeat visit, run one visit from On my way to checkout, fill a class, and end the day with nothing left open.

### See the day on Today (CB-44)

**Covers:** Today on web and mobile, owner and staff
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile`. Open web at [http://localhost:8700](<http://localhost:8700>) and mobile in the iOS simulator.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Mobile waits on a staging build (CB-61).

**QA steps**

1. Take a payment.
   **Expect:** Today updates on web and phones within seconds.
2. Compare revenue, awaiting payment and tax set aside to the day's income and GST/HST reports.
   **Expect:** equal to the cent.
3. Check the agenda, team day and attention items.
   **Expect:** overdue invoices and open visits are listed with actions.
4. Check the next filing date.
   **Expect:** shown when it is 30 days away or less.
5. Sign in as staff.
   **Expect:** their own day only, no money.

**Done when:** Today answers how the day is going without opening a report.

**Automated by**

* `XB-E2E-08 (web), walk`
* `web: shell.e2e.ts › staff: today, schedule and clients`
* `mobile: today.yaml (walk, unregistered)`

**To automate**

* `FIN-REPORT-11` in `apps/web/e2e/reports.e2e.ts`: Today's figures equal the income and GST/HST report for the same day after sales and a refund (FIN16).

**Depends on:** Nothing

### Set hours, time off and closures that decide open times (CB-16)

**Covers:** Setup > Team & hours on web and mobile, time off and closures, Connect open times
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile dev-connect`. Open web at [http://localhost:8700](<http://localhost:8700>), mobile in the iOS simulator and Connect at `book.`, `shop.`, `pay.` and `<slug>.localhost:8709`.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>) and Connect at `book.`, `shop.`, `pay.` and `<slug>.staging.clientbridge.ca`, with the same logins. Mobile waits on a staging build (CB-61).

**QA steps**

1. Set a member to Tuesday to Saturday, 10 to 4.
   **Expect:** Connect offers nothing on Monday for them.
2. Add a day off next week.
   **Expect:** no times that day for them; others unaffected.
3. Close the business on a holiday.
   **Expect:** no one is bookable that day; the closed day stays reachable on the schedule.
4. As staff, edit your own hours offline, reload, reconnect.
   **Expect:** the week is sent exactly once.
5. Edit the same week in two browsers.
   **Expect:** one conflict, repaired explicitly without losing either edit.
6. Change hours so a future visit falls outside them.
   **Expect:** the visit is listed for review.

**Done when:** Open times always match when people are actually working.

**Automated by**

* `OFF-E2E-01 (web)`
* `OFF-E2E-02 (web)`
* `OFF-E2E-03 (web)`
* `OFF-E2E-04 (web)`
* `SYN-E2E-08 (web)`
* `SYN-E2E-24 (sync)`
* `SYN-E2E-34 (sync)`
* `sync: hours.e2e.ts (five unregistered hours outbox tests)`
* `web: shell.e2e.ts › owner: a closed day stays reachable, open times read in the business zone and reschedule changes weeks`
* `mobile: offline.hours.yaml (unregistered)`

**To automate**

* `SCH-E2E-08` in `apps/web/e2e/hours.e2e.ts`: Time off and a closure set from the UI remove those times on Connect (SCH19, CFG14).

**Depends on:** Nothing

### Book, move and cancel visits from the calendar (CB-17)

**Covers:** Schedule on web (day, week, month, staff, agenda) and mobile (day and agenda), booking composer and panel
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile`. Open web at [http://localhost:8700](<http://localhost:8700>) and mobile in the iOS simulator.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Mobile waits on a staging build (CB-61).

**QA steps**

1. Book from the composer.
   **Expect:** a draft follows the form on the calendar, then the visit appears on web and the member's phone.
2. Try to double-book the same member.
   **Expect:** refused, naming the clash.
3. Drag the visit to a new time and resize it.
   **Expect:** the move check passes and both devices show the new time.
4. Move into a slot where the room is taken.
   **Expect:** refused with free alternatives named.
5. Cancel the visit.
   **Expect:** the slot opens on Connect.
6. Open each view on web and both views on mobile.
   **Expect:** the same visits in the business zone, even from a laptop in another zone.

**Done when:** Every booking change made on one device shows the same on every other.

**By hand only**

* Drag on a phone and a tablet.

**Automated by**

* `SCH-PILOT-01 (web)`
* `SCH-E2E-05 (journeys)`
* `web: shell.e2e.ts › owner: schedule, booking panel, classes and repeat visits`
* `web: shell.e2e.ts › owner: a closed day stays reachable…`
* `mobile: today.yaml (walk, unregistered)`

**To automate**

* `SCH-E2E-09` in `apps/web/e2e/bookings.e2e.ts`: Resize and reassign across replicas with the move check's problem and alternatives (SCH01, SCH04).

**Depends on:** Nothing

### Run a visit from On my way to checkout (CB-18)

**Covers:** Today and the booking panel on web and mobile, check-in sheet, Complete and No-show, auto-complete job
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234; Northlight Security for On my way; a visit with a form and a deposit outstanding

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile worker`. Open web at [http://localhost:8700](<http://localhost:8700>) and mobile in the iOS simulator.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Mobile waits on a staging build (CB-61).

**QA steps**

1. Tap On my way on a house call.
   **Expect:** the preview shows the text; the client gets it; Today shows the member on the way.
2. Check the client in.
   **Expect:** the sheet lists what the visit still needs (form, contract, deposit) with links to finish each; undo restores the visit.
3. Open checkout from the visit.
   **Expect:** the ticket opens with the visit on it.
4. Mark one visit Completed and another No-show.
   **Expect:** both refused before start; after start, the no-show keeps its deposit.
5. Leave a third visit open past midnight.
   **Expect:** it is completed the next morning; a never-approved request is cancelled.

**Done when:** Every visit ends in the right state from any device, and none is left open overnight.

**Automated by**

* `STR-E04 (stripe), forfeited deposit only`

**To automate**

* `SCH-E2E-10` in `apps/web/e2e/journeys/visit.journey.ts`: On my way, check-in with needs, undo, checkout with the visit on the ticket (SCH12, SCH13).
* `SCH-E2E-11` in `apps/web/e2e/journeys/visit.journey.ts`: No-show forfeits the deposit; complete and no-show refused before start (SCH11).
* `SCH-E2E-12` in `apps/web/e2e/journeys/visit.journey.ts`: The worker completes past visits and cancels stale requests overnight (SCH17).

**Depends on:** Nothing

### Book and manage repeat visits (CB-19)

**Covers:** Series composer and Repeat visits on web and mobile
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile`. Open web at [http://localhost:8700](<http://localhost:8700>) and mobile in the iOS simulator.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Mobile waits on a staging build (CB-61).

**QA steps**

1. Create a weekly series of 6 across a daylight-saving change.
   **Expect:** every visit keeps its local time.
2. Create a series of 61.
   **Expect:** refused at 60, with an end date offered instead.
3. Change one visit, then this and following, then all.
   **Expect:** each scope changes only the visits it names.
4. Move the series to another weekday, then cancel it from one visit.
   **Expect:** every future visit is cancelled; past ones stay.
5. Create a series where one date clashes.
   **Expect:** the clash is named with suggestions.

**Done when:** A regular client's series can be managed in one action and never drifts across DST.

**Automated by**

* `web: shell.e2e.ts › owner: schedule, booking panel, classes and repeat visits (walk only)`

**To automate**

* `SCH-E2E-13` in `apps/web/e2e/bookings.e2e.ts`: Weekly series across DST, change following, cancel all (SCH14, SCH22).
* `SCH-E2E-14` in `apps/web/e2e/bookings.e2e.ts`: Series retry notices and a clashing date (SCH15).

**Depends on:** Nothing

### Run classes, waitlists and programs (CB-20)

**Covers:** Classes and program board on web and mobile (creating a program is web only), Connect class and program booking, seat notices, class messages
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234 (puppy class); Lakeside Learning Studio (Fall Coding Camp); Ridgeline (full class)

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile dev-connect worker`. Open web at [http://localhost:8700](<http://localhost:8700>), mobile in the iOS simulator and Connect at `book.`, `shop.`, `pay.` and `<slug>.localhost:8709`. Texts land in Mailpit at [http://localhost:8715](<http://localhost:8715>).
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>) and Connect at `book.`, `shop.`, `pay.` and `<slug>.staging.clientbridge.ca`, with the same logins. Mobile waits on a staging build (CB-61). Texts to demo clients show as sent and go nowhere; real texts wait on the staging Twilio numbers (CB-69).

**QA steps**

1. Fill a class of 6 online.
   **Expect:** the 7th joins the waitlist; the roster lists all six.
2. Cancel one seat.
   **Expect:** the first person waiting is promoted and texted once.
3. Reply STOP from the waiting client before the notice goes.
   **Expect:** no notice is sent.
4. Enrol a family in the camp on Connect with a card deposit.
   **Expect:** every day is booked, one invoice for the whole camp, the deposit part-pays it.
5. Cancel the enrolment.
   **Expect:** every day ahead is cancelled, the invoice voided and the deposit refunded.
6. Text everyone booked in a session.
   **Expect:** each booked client gets it once, except anyone who sent STOP.

**Done when:** Classes and programs run without touching the database, and every seat and invoice agrees.

**Automated by**

* `CLS-E2E-01 (journeys)`
* `CLS-E2E-02 (journeys)`
* `FLOW-06-A (journeys)`
* `MSG-E2E-14 (journeys)`
* `FIN-DEPOSIT-10 (stripe)`

**To automate**

* `CLS-E2E-03` in `apps/web/e2e/journeys/entitlements.journey.ts`: Cancel a program enrolment: days cancelled, invoice voided, deposit refunded (SCH07).

**Depends on:** Nothing

### Work a job with a crew, visit records and photos (CB-21)

**Covers:** Booking panel crew, visit records, job photos on web and mobile, insurance receipt
**Before you start:** Northlight Security (two-person install); Harbourside Massage and Wellness (SOAP notes); Foothills Lawn and Garden (photos)

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile`. Open web at [http://localhost:8700](<http://localhost:8700>) and mobile in the iOS simulator.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Mobile waits on a staging build (CB-61).

**QA steps**

1. Add a helper to an install.
   **Expect:** the helper's calendar is blocked for the visit; a busy helper is refused.
2. Move the install.
   **Expect:** the helper's block moves with it, or the move is refused if they can't follow.
3. Pay the install.
   **Expect:** the line's earning is shared evenly between lead and helper at their own rates.
4. Write a SOAP note on a Harbourside visit, then amend it.
   **Expect:** both versions are kept with author and time.
5. Open the insurance receipt for a paid visit as staff and from the client's manage page.
   **Expect:** practitioner, registration and lines are right.
6. Add before and after photos and share them.
   **Expect:** the client sees them on their manage page.

**Done when:** A job's crew, records and photos are correct on every device and on the client's page.

**Automated by**

* No e2e case yet

**To automate**

* `SCH-E2E-15` in `apps/web/e2e/journeys/visit.journey.ts`: Crew block follows a move, refuses a busy helper, splits the earning (SCH01, FIN07).
* `SCH-E2E-16` in `apps/web/e2e/bookings.e2e.ts`: Visit record create and amend, then the insurance receipt on Connect.
* `DOC-E2E-07` in `apps/web/e2e/files.e2e.ts`: Job photos shared to the manage page and revoked (DOC17).

**Depends on:** Nothing

### Remind clients before each visit (CB-22)

**Covers:** Setup > Reminders on web and mobile, reminder texts
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234; a client with a real phone on staging

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile worker`. Open web at [http://localhost:8700](<http://localhost:8700>) and mobile in the iOS simulator. Texts land in Mailpit at [http://localhost:8715](<http://localhost:8715>).
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Mobile waits on a staging build (CB-61). Texts to demo clients show as sent and go nowhere; real texts wait on the staging Twilio numbers (CB-69).

**QA steps**

1. Open Setup > Reminders.
   **Expect:** the next visit's reminder shows word for word with its send time.
2. Book a visit for tomorrow.
   **Expect:** the reminder arrives the day before with the right time, address and manage link.
3. Turn the manage link off.
   **Expect:** the next reminder carries no link.
4. Move the visit after the reminder went.
   **Expect:** no second reminder for the old time; the client gets the rescheduled text.
5. Open a reminder's preview, then cancel.
   **Expect:** the preview shows the text the client gets, and cancelling sends nothing.

**Done when:** No visit is forgotten by the client, and the reminder says exactly what the preview showed.

**By hand only**

* Delivery to a real handset.

**Automated by**

* `web: previews.e2e.ts › a reminder shows the message before it goes out, and cancelling sends nothing`

**To automate**

* `MSG-E2E-17` in `apps/web/e2e/journeys/communication.journey.ts`: The worker sends one reminder matching the preview, and none after a reschedule (SCH18).

**Depends on:** Nothing

## 4. Book online

Clients find the business, book and pay a deposit, and change their plans without calling.

**Linear project:** [4. Book online](https://linear.app/clientbridgeca/project/4-book-online-216ab0a93dc7)

**Walk on staging:** As a new client, book a visit with a deposit from the business's own site, come back as that client by SMS code, add a product, then reschedule from the link.

### Take a booking online with a deposit (CB-24)

**Covers:** Connect booking page, Setup > Online booking, approvals on the schedule, the reaper job
**Before you start:** Staging with Stripe in test mode; Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234 (approval for new clients); Cedar Coast (no approval)

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-connect worker`. Open web at [http://localhost:8700](<http://localhost:8700>) and Connect at `book.`, `shop.`, `pay.` and `<slug>.localhost:8709`. Run `make stripe-setup` once and keep `make stripe-listen` running for card steps.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>) and Connect at `book.`, `shop.`, `pay.` and `<slug>.staging.clientbridge.ca`, with the same logins. Card steps use the Stripe sandbox; the demos are linked but their Stripe onboarding isn't finished (CB-69).

**QA steps**

1. As a new client on a phone, book a service with a deposit and pay with card 4242.
   **Expect:** Birchbark shows a request waiting for approval; the deposit is collected.
2. Approve the request on the schedule.
   **Expect:** the client is told; the visit shows on web and the member's phone with the deposit.
3. At Cedar Coast, book a 30-minute walk.
   **Expect:** confirmed at once.
4. Change lead time, horizon and start step in Setup.
   **Expect:** Connect offers only times inside them.
5. Two browsers race for the last time.
   **Expect:** one wins; the loser sees the time taken and nothing else is created.
6. Start a deposit and abandon it.
   **Expect:** the reaper cancels the booking and frees the time.
7. Reload half way through.
   **Expect:** the contact details are restored, for that business only.
8. Add the confirmed visit to a calendar from the confirmation.
   **Expect:** the event has the visit's time in the business time zone.

**Done when:** A client can book and pay a deposit without contacting the business, and staff see exactly what was booked and paid.

**Automated by**

* `SCH-E2E-03 (journeys)`
* `SCH-E2E-04 (journeys)`
* `XB-E2E-12 (connect)`
* `FIN-DEPOSIT-04 (stripe)`
* `connect: publicBooking.e2e.ts › a new client's online booking waits for approval and opens the manage link`
* `connect: publicBooking.e2e.ts › a client books a confirmed visit where new clients need no approval`
* `connect: publicBooking.e2e.ts › anyone books with any member, and a refused or unreachable booking reads as such`

**To automate**

* `STR-E17` in `apps/connect/e2e/stripe/deposit.stripe.ts`: New client pays a booking deposit with a real card; owner approves; deposit applied on the invoice (SCH08, SCH02).
* `SCH-E2E-17` in `apps/web/e2e/journeys/visit.journey.ts`: Payment versus reaper race on an unpaid deposit (SCH10).

**Depends on:** Nothing

### Let returning clients book as themselves (CB-25)

**Covers:** Connect returning-client verification by SMS code
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234; a client with a pet and a real phone on staging

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-connect`. Open Connect at `book.`, `shop.`, `pay.` and `<slug>.localhost:8709`. Texts land in Mailpit at [http://localhost:8715](<http://localhost:8715>).
* **Staging:** Connect at `book.`, `shop.`, `pay.` and `<slug>.staging.clientbridge.ca`. Texts to demo clients show as sent and go nowhere; real texts wait on the staging Twilio numbers (CB-69).

**QA steps**

1. Book as a returning client and verify the texted code.
   **Expect:** the existing pet is offered and the stored contact is kept.
2. Edit the contact details after verifying.
   **Expect:** the proof is cleared and nothing is written until confirmed.
3. Archive the client, then try to book with the old proof.
   **Expect:** refused.
4. Enter wrong codes past the limit.
   **Expect:** verification locks with a plain message.

**Done when:** A returning client books their own pet without retyping it, and nobody else can.

**By hand only**

* The code arriving on a real phone.

**Automated by**

* `CRM-E2E-05 (journeys)`
* `CRM-E2E-06 (journeys)`
* `CRM-E2E-07 (journeys)`

**To automate**

* `CRM-E2E-14` in `apps/web/e2e/journeys/client.journey.ts`: Verification threshold and two concurrent verifications (CRM-E15).

**Depends on:** Nothing

### Add products to a booking and bill them once (CB-26)

**Covers:** Connect extras step, booking panel add-ons, invoice from booking
**Before you start:** Brightwater Home Cleaning (add-ons that lengthen the visit); Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-connect`. Open web at [http://localhost:8700](<http://localhost:8700>) and Connect at `book.`, `shop.`, `pay.` and `<slug>.localhost:8709`.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>) and Connect at `book.`, `shop.`, `pay.` and `<slug>.staging.clientbridge.ca`, with the same logins.

**QA steps**

1. Book an oven clean add-on online.
   **Expect:** only times long enough are offered; the visit is longer by the add-on's minutes.
2. As staff, add another add-on where the time after is taken.
   **Expect:** refused as no room.
3. Remove one add-on.
   **Expect:** the visit shortens, never below the service length.
4. Create the invoice from the booking.
   **Expect:** each add-on is a line, counted toward the member's earning, and the deposit reduces the balance.

**Done when:** Add-ons always reach the invoice, are charged once and keep the visit's length right.

**Automated by**

* `SCH-E2E-07 (journeys)`
* `BILL-DOC-03 (web)`

**To automate**

* `SCH-E2E-18` in `apps/web/e2e/journeys/visit.journey.ts`: Staff add-on refused with visit_no_room; removal never shortens below the service (CFG15).

**Depends on:** Nothing

### Let clients reschedule or cancel from their link (CB-27)

**Covers:** Connect manage page `/m/<token>`
**Before you start:** Staging with Stripe in test mode; Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-connect`. Open Connect at `book.`, `shop.`, `pay.` and `<slug>.localhost:8709`. Texts land in Mailpit at [http://localhost:8715](<http://localhost:8715>).
* **Staging:** Connect at `book.`, `shop.`, `pay.` and `<slug>.staging.clientbridge.ca`. Texts to demo clients show as sent and go nowhere; real texts wait on the staging Twilio numbers (CB-69).

**QA steps**

1. From the confirmation link, move a booking to another open time.
   **Expect:** staff see the new time; the move limit counts down.
2. Cancel inside the cut-off.
   **Expect:** refused with the reason.
3. Cancel outside it.
   **Expect:** the slot opens and a paid deposit is refunded.
4. On a booking with a deposit due, pay it from the link.
   **Expect:** the deposit is collected once even with two tabs.
5. Open the receipt and shared photos, and send the business a message.
   **Expect:** the message lands in the Inbox thread.

**Done when:** Clients change their plans without staff, and the business's rules are enforced on the server.

**Automated by**

* `XB-E2E-14 (connect)`
* `connect: publicManage.e2e.ts › a client opens the manage link and the move picker`
* `connect: publicBooking.e2e.ts › cancel through the manage link (inside two tests)`

**To automate**

* `SCH-E2E-19` in `apps/connect/e2e/publicManage.e2e.ts`: Reschedule to a new time, cancel inside the cut-off refused, cancel outside it refunds (SCH05, SCH09).
* `STR-E18` in `apps/connect/e2e/stripe/deposit.stripe.ts`: Pay a pending deposit from the manage link with a real card.

**Depends on:** Nothing

### Put the business page and booking on the business's own site (CB-28)

**Covers:** Connect business page, embed script and widgets, host routing (the embed code and QR are web only)
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234; a scratch HTML page on another origin

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-connect`. Open web at [http://localhost:8700](<http://localhost:8700>) and Connect at `book.`, `shop.`, `pay.` and `<slug>.localhost:8709`.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>) and Connect at `book.`, `shop.`, `pay.` and `<slug>.staging.clientbridge.ca`, with the same logins.

**QA steps**

1. Open `<slug>.D` on a phone.
   **Expect:** cover, logo, services and links to booking and the shop on their own hosts.
2. Paste the embed snippet into the scratch page.
   **Expect:** the drawer opens and closes with focus restored; an inline widget below the fold sizes itself.
3. Book a visit inside the embedded page.
   **Expect:** the booking completes and shows on the schedule.
4. Post a message to the widget from another window.
   **Expect:** ignored; the brand renders as text.
5. Open a booking link on the wrong host and an invalid token.
   **Expect:** not found or a plain explanation, never a transaction.

**Done when:** A business can send clients to its page or embed booking on its own site, and each works on a phone.

**Automated by**

* `EMBED-E2E-01 (connect)`
* `OPS-E2E-06 (connect)`
* `XB-E2E-09 (connect)`
* `connect: embed.e2e.ts › the single-script booking drawer opens, closes and restores focus`
* `connect: shell.e2e.ts › every client page explains an invalid link without offering a transaction`
* `connect: smoke/connect.smoke.ts (hosts, framing, widgets)`

**To automate**

* `EMBED-E2E-02` in `apps/connect/e2e/embed.e2e.ts`: A booking completed inside the embed reaches the staff schedule (OPS15).

**Depends on:** Nothing

## 5. Sell at the desk and online

Every sale, at the desk or from the online shop, takes the right payment, tip and discount and ends with the right receipt and stock.

**Linear project:** [5. Sell at the desk and online](https://linear.app/clientbridgeca/project/5-sell-at-the-desk-and-online-3b3e608dced5)

**Walk on staging:** Ring up a visit and a product with a tip and a discount, pay one sale by saved card and one by cash, then place an online shop order and hand it over at pickup.

### Ring up a sale at the desk and send the receipt (CB-29)

**Covers:** Sales on web and mobile: ticket, held tickets, cash, receipts by text
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile`. Open web at [http://localhost:8700](<http://localhost:8700>) and mobile in the iOS simulator. Texts land in Mailpit at [http://localhost:8715](<http://localhost:8715>).
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Mobile waits on a staging build (CB-61). Texts to demo clients show as sent and go nowhere; real texts wait on the staging Twilio numbers (CB-69).

**QA steps**

1. Ring up a groom and a shampoo for a client.
   **Expect:** totals and tax by line.
2. Ring up a walk-in with no client and pay $50 cash on a $43 total.
   **Expect:** $7 change, sale Paid.
3. Hold a ticket on web and resume it on a phone.
   **Expect:** the same lines, then paid once.
4. Lose the response after paying cash and retry.
   **Expect:** one payment and one stock movement.
5. Text the receipt to a phone number.
   **Expect:** the receipt lists each line, tax and total.
6. As front-desk staff, sell past zero stock.
   **Expect:** allowed; void and restock are refused.

**Done when:** Any sale can be rung up in under a minute and is recorded once with tax.

**Automated by**

* `SALE-E2E-01 (web)`
* `SALE-E2E-02 (web)`
* `SALE-E2E-11 (web)`
* `mobile: payments.yaml (walk, unregistered)`

**To automate**

* `SALE-E2E-13` in `apps/web/e2e/pos.e2e.ts`: Hold a ticket, resume on a second device, pay once (SALE07).
* `SALE-E2E-14` in `apps/web/e2e/pos.e2e.ts`: Walk-in receipt by text matches the sale, with a failed send retried (SALE21).

**Depends on:** Nothing

### Take card payments at the desk (CB-30)

**Covers:** Sales card checkout on web, saved card, gift card and package tender
**Before you start:** Staging with Stripe in test mode; Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web`. Open web at [http://localhost:8700](<http://localhost:8700>). Run `make stripe-setup` once and keep `make stripe-listen` running for card steps.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Card steps use the Stripe sandbox; the demos are linked but their Stripe onboarding isn't finished (CB-69).

**QA steps**

1. Pay a sale with card 4242.
   **Expect:** Paid on web and phones.
2. Try the declined card 4000 0000 0000 0002.
   **Expect:** the sale stays open with a clear message.
3. Start a card checkout, cancel it and pay cash.
   **Expect:** Stripe shows the intent cancelled; the sale is paid once in cash.
4. Charge a client's saved card.
   **Expect:** Paid without the card form.
5. Pay part with a gift card and the rest in cash.
   **Expect:** both tenders on the receipt; the gift balance drops.

**Done when:** Every way of paying at the desk except Tap to Pay ends in a paid sale and a correct receipt.

**Automated by**

* `STR-E05 (stripe)`
* `STRIPE-BROWSER-02 (stripe), invoice decline`

**To automate**

* `STR-E19` in `apps/connect/e2e/stripe/desk.stripe.ts`: Desk card checkout with 4242 and with a decline, then saved-card charge (SALE01, PAY-E02).
* `SALE-E2E-15` in `apps/web/e2e/pos.e2e.ts`: Gift card part tender with cash remainder (SALE06, ENT06).

**Depends on:** Nothing

### Take Tap to Pay on real phones (CB-31)

**Covers:** Mobile Sales and invoice payment with Stripe Terminal
**Before you start:** Staging with Stripe in test mode; an NFC iPhone and an NFC Android phone with the store builds; Stripe test cards for Terminal

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-mobile` with a development build on a real iPhone or Android phone, since Tap to Pay needs NFC. Run `make stripe-setup` once and keep `make stripe-listen` running.
* **Staging:** The staging store builds (CB-61) on real phones, against the Stripe sandbox.

**QA steps**

1. On iPhone, ring up a product and pay with Tap to Pay.
   **Expect:** Paid; receipt sent.
2. On Android, take Tap to Pay on an invoice.
   **Expect:** Paid on web too.
3. Cancel mid-tap.
   **Expect:** the sale can be edited or paid in cash.
4. Tap an Interac-only debit card.
   **Expect:** today it cannot pay (only `card_present`); record the behaviour.

**Done when:** Tap to Pay works on both platforms, and an interrupted tap never leaves a stuck sale.

**By hand only**

* All of it: Tap to Pay needs real NFC hardware and the store-signed app.
* Interac debit on Tap to Pay is not built (doc CLI-31).

**Automated by**

* No e2e case yet

**Depends on:** CB-61

### Add tips and discounts that add up by hand (CB-32)

**Covers:** Sales, invoice and estimate editors, pay link tip, Tap to Pay tip, member perk
**Before you start:** Staging with Stripe in test mode; Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234; a client with a membership that has a product perk

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web`. Open web at [http://localhost:8700](<http://localhost:8700>). Run `make stripe-setup` once and keep `make stripe-listen` running for card steps.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Card steps use the Stripe sandbox; the demos are linked but their Stripe onboarding isn't finished (CB-69).

**QA steps**

1. Ring up a $100 groom with a 15% tip.
   **Expect:** $15 tip, no tax on it.
2. Discount one line 10% and the sale $5.
   **Expect:** totals and tax match a hand calculation.
3. As staff, discount a sale 50%.
   **Expect:** applied without approval.
4. Pay an invoice on the pay link with a custom tip.
   **Expect:** the tip shows on the receipt and under the member in Staff pay.
5. Sell a product to the member.
   **Expect:** the perk discount applies.
6. Tip a crew visit.
   **Expect:** the tip follows the crew's shares.

**Done when:** Every discounted total and tax matches a hand calculation, and every tip reaches the right person untaxed.

**By hand only**

* Tip on Tap to Pay (hardware).

**Automated by**

* `BILL-DOC-01 (web), discounts`
* `DOC-E2E-06 (connect), discounted estimate`
* `FLOW-02-A (journeys), discount carried through conversion`

**To automate**

* `SALE-E2E-16` in `apps/web/e2e/pos.e2e.ts`: Line and sale discounts with a percent tip, exact cents and tax (SALE01).
* `PAY-E2E-04` in `apps/web/e2e/earnings.e2e.ts`: Tips from desk and pay link land on the right member and outside sales (FIN12).
* `STR-E20` in `apps/connect/e2e/stripe/provider.stripe.ts`: Pay link with a tip settles one charge (BILL17).

**Depends on:** Nothing

### Save a client's card or bank account and charge it (CB-12)

**Covers:** Client wallet on web and mobile, Connect payment setup page, Stripe SetupIntents and PAD mandates
**Before you start:** Staging with Stripe in test mode; Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile dev-connect`. Open web at [http://localhost:8700](<http://localhost:8700>), mobile in the iOS simulator and Connect at `book.`, `shop.`, `pay.` and `<slug>.localhost:8709`. Run `make stripe-setup` once and keep `make stripe-listen` running for card steps.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>) and Connect at `book.`, `shop.`, `pay.` and `<slug>.staging.clientbridge.ca`, with the same logins. Mobile waits on a staging build (CB-61). Card steps use the Stripe sandbox; the demos are linked but their Stripe onboarding isn't finished (CB-69).

**QA steps**

1. Save card 4242 on a phone and make it default.
   **Expect:** it shows as default on web.
2. Send a payment setup link and add a bank account from it.
   **Expect:** the mandate shows active; provider secrets are gone from the address bar.
3. Open the setup link with a missing token.
   **Expect:** a plain explanation and no form.
4. Remove the older card.
   **Expect:** it can no longer be charged or chosen as default.
5. On mobile, try to add a bank account.
   **Expect:** the app says to add it on the web.

**Done when:** Saved methods can be managed from any device and only chargeable ones can be default.

**By hand only**

* A real Canadian PAD debit clearing, which takes business days.

**Automated by**

* `XB-E2E-13 (connect)`

**To automate**

* `STR-E15` in `apps/connect/e2e/stripe/wallet.stripe.ts`: Save a card with a real SetupIntent, make it default, charge it on an invoice, detach it (PAY-E11, PAY-E12).
* `STR-E16` in `apps/connect/e2e/stripe/wallet.stripe.ts`: PAD mandate through the setup page, debit settles after processing (PAY-E13, PAY-E15).

**Depends on:** Nothing

### Fill online shop orders from cart to pickup (CB-41)

**Covers:** Connect shop and order page, Sales > Orders on web and mobile, pickup reminder job
**Before you start:** Staging with Stripe in test mode; Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile dev-connect worker`. Open web at [http://localhost:8700](<http://localhost:8700>), mobile in the iOS simulator and Connect at `book.`, `shop.`, `pay.` and `<slug>.localhost:8709`. Run `make stripe-setup` once and keep `make stripe-listen` running for card steps. Texts land in Mailpit at [http://localhost:8715](<http://localhost:8715>).
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>) and Connect at `book.`, `shop.`, `pay.` and `<slug>.staging.clientbridge.ca`, with the same logins. Mobile waits on a staging build (CB-61). Card steps use the Stripe sandbox; the demos are linked but their Stripe onboarding isn't finished (CB-69). Texts to demo clients show as sent and go nowhere; real texts wait on the staging Twilio numbers (CB-69).

**QA steps**

1. On a phone, order a shampoo and a brush and pay with card 4242.
   **Expect:** the owner is notified; the order waits for pickup.
2. Order more than the stock.
   **Expect:** refused.
3. Mark ready.
   **Expect:** the client gets the message; the order page shows ready.
4. Mark picked up, then try to move it back.
   **Expect:** refused.
5. Lose the order response and reload.
   **Expect:** the order resumes with one key.
6. Leave a ready order uncollected.
   **Expect:** one pickup reminder at 09:00 local.

**Done when:** Online orders are paid, prepared and collected without a phone call, and stock drops once.

**Automated by**

* `SALE-E2E-03 (connect)`
* `SALE-E2E-12 (journeys)`
* `FLOW-03-A (journeys)`
* `FLOW-03-B (journeys)`
* `XB-E2E-10 (connect)`
* `connect: publicShop.e2e.ts (four unregistered tests)`

**To automate**

* `STR-E22` in `apps/connect/e2e/stripe/shop.stripe.ts`: Shop order paid with a real card, ready and picked up (SALE02).
* `SALE-E2E-17` in `apps/web/e2e/journeys/stock.journey.ts`: Final-unit race between two online checkouts (SALE03).

**Depends on:** Nothing

## 6. Invoice and get paid

Estimates become invoices, invoices are paid by link, saved card or by hand, and deposits are applied to the bill.

**Linear project:** [6. Invoice and get paid](https://linear.app/clientbridgeca/project/6-invoice-and-get-paid-60b52fcc26c0)

**Walk on staging:** Send an estimate, accept it from the link, turn it into an invoice with the visit's deposit applied, get it paid partly by hand and the rest by link, then print the receipt.

### Quote with an estimate and turn it into an invoice (CB-33)

**Covers:** Estimate editor on web and mobile, Connect estimate page, convert, book from estimate
**Before you start:** Northlight Security (estimates with optional lines)

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile dev-connect`. Open web at [http://localhost:8700](<http://localhost:8700>), mobile in the iOS simulator and Connect at `book.`, `shop.`, `pay.` and `<slug>.localhost:8709`. Texts land in Mailpit at [http://localhost:8715](<http://localhost:8715>).
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>) and Connect at `book.`, `shop.`, `pay.` and `<slug>.staging.clientbridge.ca`, with the same logins. Mobile waits on a staging build (CB-61). Texts to demo clients show as sent and go nowhere; real texts wait on the staging Twilio numbers (CB-69).

**QA steps**

1. Write an estimate on a phone with an optional line and send it.
   **Expect:** the preview shows the text; the client gets it.
2. As the client, tick the optional line and accept.
   **Expect:** the same discounted total is accepted.
3. Convert it.
   **Expect:** one draft invoice with the accepted lines, discount and tax.
4. Decline another estimate.
   **Expect:** it cannot be converted.
5. Lose the send response.
   **Expect:** the estimate reads unconfirmed, then sent, and texts once.
6. Book the job from the accepted estimate.
   **Expect:** the booking links to it and the estimate books once.
7. Open the send preview, then cancel.
   **Expect:** the preview shows word for word the text the client gets, and cancelling sends nothing.

**Done when:** A quote becomes a bill without retyping anything.

**Automated by**

* `BILL-DOC-02 (web)`
* `BILL-DOC-20 (web)`
* `DOC-E2E-06 (connect)`
* `FLOW-02-A (journeys)`
* `connect: publicEstimate.e2e.ts › a client reads an estimate and a receipt`
* `mobile: billing.yaml (walk, unregistered)`

**To automate**

* `BILL-DOC-22` in `apps/web/e2e/billing.e2e.ts`: Decline refuses conversion; late public answer after conversion (BILL10).

**Depends on:** Nothing

### Invoice, send by text and get paid by link, card or by hand (CB-34)

**Covers:** Invoice editor and record payment on web and mobile, Connect pay and receipt pages, overdue sweep
**Before you start:** Staging with Stripe in test mode; Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234; a client with a saved card

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile dev-connect worker`. Open web at [http://localhost:8700](<http://localhost:8700>), mobile in the iOS simulator and Connect at `book.`, `shop.`, `pay.` and `<slug>.localhost:8709`. Run `make stripe-setup` once and keep `make stripe-listen` running for card steps. Texts land in Mailpit at [http://localhost:8715](<http://localhost:8715>).
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>) and Connect at `book.`, `shop.`, `pay.` and `<slug>.staging.clientbridge.ca`, with the same logins. Mobile waits on a staging build (CB-61). Card steps use the Stripe sandbox; the demos are linked but their Stripe onboarding isn't finished (CB-69). Texts to demo clients show as sent and go nowhere; real texts wait on the staging Twilio numbers (CB-69).

**QA steps**

 1. Create an invoice from a completed booking and send it.
    **Expect:** the preview matches the text that arrives.
 2. Pay through the link in a private window with card 4242.
    **Expect:** Paid on web and phones, receipt texted.
 3. Pay another with a 3DS card, then close the challenge on a third.
    **Expect:** settles only after authentication; the closed one stays unpaid after reload.
 4. Open one invoice in two tabs; decline in the first, pay in both.
    **Expect:** one charge.
 5. Void an unpaid invoice; try to void one with a payment in progress.
    **Expect:** the second is refused.
 6. Leave an invoice past due.
    **Expect:** overdue on Today at 07:00 local; the reminder preview matches what is sent.
 7. Pay a sent invoice through the link with the declined card 4000 0000 0000 0002.
    **Expect:** the page says the card was declined, the client gets one payment-failed text and the invoice stays unpaid.
 8. Record $20 cash on a $50 invoice, then charge the rest to the saved card.
    **Expect:** Partial, then Paid.
 9. Record an e-Transfer and a cheque on two others.
    **Expect:** each shows its method on the receipt and in reports, and Today and the income report count each once.
10. Lose the response after recording cash and retry.
    **Expect:** one payment.
11. Open the send preview, then cancel.
    **Expect:** the preview shows word for word the text the client gets, and cancelling sends nothing.

**Done when:** Invoices move from draft to paid or void with the right status everywhere, and every way a client actually pays is recorded once.

**Automated by**

* `BILL-DOC-01 (web)`
* `BILL-DOC-03 (web)`
* `BILL-DOC-04 (web)`
* `STRIPE-BROWSER-01 (stripe)`
* `STRIPE-BROWSER-02 (stripe)`
* `STRIPE-BROWSER-03 (stripe)`
* `STRIPE-BROWSER-04 (stripe)`
* `STRIPE-BROWSER-05 (stripe)`
* `STRIPE-BROWSER-06 (stripe)`
* `STR-E06 (stripe)`
* `connect: publicPay.e2e.ts › a client opens an invoice and sees how to pay it`
* `web: previews.e2e.ts › a reminder shows the message before it goes out, and cancelling sends nothing`
* `BILL-PILOT-01 (web)`
* `BILL-PILOT-02 (web)`
* `FLOW-02-B (journeys)`
* `web: sync.e2e.ts › a recorded payment holds the invoice until its new balance reaches this device`

**To automate**

* `BILL-DOC-23` in `apps/web/e2e/billing.e2e.ts`: Void refused while a payment is in progress (BILL12); the overdue sweep runs once (BILL16).
* `STR-E21` in `apps/connect/e2e/stripe/provider.stripe.ts`: Charge the remainder to a saved card from Record payment (PAY-E05).

**Depends on:** Nothing

### Print or share invoices, estimates, receipts and statements (CB-36)

**Covers:** Printed document view on web, share on mobile, Connect pages
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile dev-connect`. Open web at [http://localhost:8700](<http://localhost:8700>), mobile in the iOS simulator and Connect at `book.`, `shop.`, `pay.` and `<slug>.localhost:8709`.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>) and Connect at `book.`, `shop.`, `pay.` and `<slug>.staging.clientbridge.ca`, with the same logins. Mobile waits on a staging build (CB-61).

**QA steps**

1. Print an invoice, an estimate and a receipt from web.
   **Expect:** logo, address, GST/HST number, lines, taxes and totals match the record.
2. Share the same from a phone.
   **Expect:** the client can open it.
3. Decide whether a downloadable PDF is still a launch requirement.
   **Expect:** a written decision on this ticket.

**Done when:** Every printed document matches its record, and the PDF question is decided.

**By hand only**

* Physical print output.

**Automated by**

* No e2e case yet

**To automate**

* `BILL-DOC-24` in `apps/web/e2e/billing.e2e.ts`: Printed invoice content matches the record (BILL18).

**Depends on:** Nothing

### Take deposits and apply them to the bill (CB-37)

**Covers:** Deposit on booking, invoice from booking, no-show and cancel paths
**Before you start:** Staging with Stripe in test mode; Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web`. Open web at [http://localhost:8700](<http://localhost:8700>). Run `make stripe-setup` once and keep `make stripe-listen` running for card steps.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Card steps use the Stripe sandbox; the demos are linked but their Stripe onboarding isn't finished (CB-69).

**QA steps**

1. Book with a $25 deposit and invoice the visit.
   **Expect:** the invoice's balance is reduced by $25.
2. Cancel an allowed booking with a paid deposit.
   **Expect:** refunded in full.
3. Mark a deposit visit a no-show.
   **Expect:** the deposit is kept as revenue.
4. Refund a deposit already applied to an issued invoice.
   **Expect:** the invoice reopens for that amount.

**Done when:** Every deposit ends applied, refunded or kept, and the books agree.

**Automated by**

* `BILL-DOC-03 (web)`
* `FIN-DEPOSIT-04 (stripe)`
* `FIN-DEPOSIT-10 (stripe)`
* `STR-E04 (stripe)`

**To automate**

* `FIN-DEPOSIT-14` in `apps/connect/e2e/stripe/deposit.stripe.ts`: Deposit before and after the invoice is issued, and the no-show forfeit (BILL12, SCH11, FIN05).

**Depends on:** Nothing

## 7. Gift cards, packages and memberships

The business sells gift cards, packages and memberships, and each is used, renewed and expires with the right balance.

**Linear project:** [7. Gift cards, packages and memberships](https://linear.app/clientbridgeca/project/7-gift-cards-packages-and-memberships-9904eea0bce4)

**Walk on staging:** Sell a gift card, a package and a membership, redeem and use each at the desk, renew the membership once and let a package expire.

### Set up packages, memberships and gift card items (CB-15)

**Covers:** Item editor for entitlement kinds on web and mobile, Sales tiles
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile`. Open web at [http://localhost:8700](<http://localhost:8700>) and mobile in the iOS simulator.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Mobile waits on a staging build (CB-61).

**QA steps**

1. Create a 5-visit package valid for a year for one pet.
   **Expect:** saved with sessions, validity and the subject rule.
2. Create a monthly membership covering one service, with a 10% member perk on products.
   **Expect:** saved; the editor explains existing members keep their price.
3. Create an open-amount gift card with suggested amounts.
   **Expect:** saved.
4. Open Sales.
   **Expect:** each opens its own checkout and none can be added as a plain cart line.

**Done when:** Each entitlement kind can be set up without touching the database.

**Automated by**

* No e2e case yet

**To automate**

* `ENT-E2E-04` in `apps/web/e2e/entitlements.e2e.ts`: Create each entitlement kind in the editor and check it refuses plain cart lines (ENT21).

**Depends on:** Nothing

### Sell and redeem gift cards (CB-38)

**Covers:** Gift cards on web and mobile, gift card checkout, redemption at the desk
**Before you start:** Staging with Stripe in test mode; Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile`. Open web at [http://localhost:8700](<http://localhost:8700>) and mobile in the iOS simulator. Run `make stripe-setup` once and keep `make stripe-listen` running for card steps.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Mobile waits on a staging build (CB-61). Card steps use the Stripe sandbox; the demos are linked but their Stripe onboarding isn't finished (CB-69).

**QA steps**

1. Sell a $100 gift card for cash to a recipient.
   **Expect:** active with a code.
2. Sell one by card.
   **Expect:** active only after the payment settles.
3. Redeem $40, then try to spend $70.
   **Expect:** $60 remains; overspend refused.
4. Spend the rest exactly.
   **Expect:** balance $0 and exhausted.

**Done when:** Every gift card balance matches what was sold and spent.

**Automated by**

* `ENT-E2E-01 (web)`

**To automate**

* `ENT-E2E-05` in `apps/connect/e2e/stripe/entitlements.stripe.ts`: Card gift card purchase pending to active, decline retry (ENT02, ENT03).
* `ENT-E2E-06` in `apps/web/e2e/entitlements.e2e.ts`: Last balance race between two desks (ENT05).

**Depends on:** Nothing

### Sell, use and expire packages (CB-39)

**Covers:** Package checkout, cover at the desk and on invoices, expiry job
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234 (5-bath pack for one pet)

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web worker`. Open web at [http://localhost:8700](<http://localhost:8700>). Run `make stripe-setup` once and keep `make stripe-listen` running for card steps.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Card steps use the Stripe sandbox; the demos are linked but their Stripe onboarding isn't finished (CB-69).

**QA steps**

1. Sell a 5-visit package for one pet; use two visits.
   **Expect:** 3 remain.
2. Try to cover the sibling's visit.
   **Expect:** refused in words.
3. Use the final session from two desks at once.
   **Expect:** settled once.
4. Change the item's price after selling.
   **Expect:** the sold package keeps its benefits.
5. Run the expiry job on an expired package and an expired gift card.
   **Expect:** their unused balances move to revenue.

**Done when:** Every package balance matches what was sold and used, and expiry books the rest once.

**Automated by**

* `ENT-E2E-02 (web)`
* `ENT-E2E-03 (web)`
* `FLOW-07-A (journeys)`
* `FLOW-07-B (journeys)`

**To automate**

* `ENT-E2E-07` in `apps/web/e2e/entitlements.e2e.ts`: Expiry boundary before and after the sweep for a package and a gift card (ENT13).

**Depends on:** Nothing

### Run memberships through renewals and failures (CB-40)

**Covers:** Membership checkout, Stripe subscriptions, client panel, covered visits
**Before you start:** Staging with Stripe in test mode; Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234; Stripe test clocks

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web worker`. Open web at [http://localhost:8700](<http://localhost:8700>). Run `make stripe-setup` once and keep `make stripe-listen` running for card steps.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Card steps use the Stripe sandbox; the demos are linked but their Stripe onboarding isn't finished (CB-69).

**QA steps**

1. Start a monthly membership on a saved card.
   **Expect:** active with the first invoice Paid.
2. Advance the test clock a month.
   **Expect:** the second invoice is Paid and taxed at the current registration.
3. Fail a renewal.
   **Expect:** past due and exactly one notice per failed invoice.
4. Book a covered service.
   **Expect:** it is covered at the desk.
5. Cancel, then sell the same membership again.
   **Expect:** one active subscription.
6. Archive the client.
   **Expect:** the membership ends at period end.

**Done when:** Every membership balance matches what Stripe charged, and failures are told once.

**By hand only**

* Pause is not built; record whether it is still a launch need.

**Automated by**

* `STR-E07 (stripe)`

**To automate**

* `ENT-E2E-08` in `apps/connect/e2e/stripe/memberships.stripe.ts`: Cancel and resell, lost cancel response, covered visit (ENT18, ENT19, ENT20).

**Depends on:** Nothing

## 8. Refunds and the books

Money goes back correctly, every figure agrees with Stripe and the bank, tax is filed and the team is paid.

**Linear project:** [8. Refunds and the books](https://linear.app/clientbridgeca/project/8-refunds-and-the-books-9f95738b3e99)

**Walk on staging:** Refund a sale paid partly by gift card, lose a test dispute, then check that Today, the reports, the payouts and the GST/HST return agree to the cent, and pay the team.

### Refund correctly and unwind what the sale created (CB-42)

**Covers:** Refund panel on web and mobile, credit notes, Stripe refunds
**Before you start:** Staging with Stripe in test mode; Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile`. Open web at [http://localhost:8700](<http://localhost:8700>) and mobile in the iOS simulator. Run `make stripe-setup` once and keep `make stripe-listen` running for card steps.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Mobile waits on a staging build (CB-61). Card steps use the Stripe sandbox; the demos are linked but their Stripe onboarding isn't finished (CB-69).

**QA steps**

1. Refund $10 of a $50 payment, then the rest.
   **Expect:** credit notes with exact tax; invoice reads Refunded; tax set aside drops.
2. Refund part of a desk sale, then the rest.
   **Expect:** stock returns once, on the final refund only.
3. Refund an unused package in full.
   **Expect:** cancelled on both devices and no longer usable.
4. Refund a gift card purchase.
   **Expect:** it can no longer be redeemed.
5. Refund a paid groom after staff pay was paid.
   **Expect:** a clawback appears for the next run.
6. Refund in the Stripe dashboard.
   **Expect:** recorded in the app; a refund that later fails is reversed.

**Done when:** Money, stock, entitlements and staff pay agree after every refund.

**Automated by**

* `REF-E2E-01 (web)`
* `SALE-E2E-10 (web)`
* `FLOW-02-B (journeys)`
* `FLOW-03-B (journeys)`
* `FLOW-07-B (journeys)`
* `FIN-DEPOSIT-04 (stripe)`
* `PAY-E2E-02 (web)`

**To automate**

* `STR-E23` in `apps/connect/e2e/stripe/refunds.stripe.ts`: Pending refund that fails later is reversed; dashboard refund recorded (PAY-E07).
* `ENT-E2E-09` in `apps/web/e2e/entitlements.e2e.ts`: Refunded gift card can't be redeemed (ENT08).

**Depends on:** Nothing

### Handle chargebacks to their outcome (CB-43)

**Covers:** Disputes in Payments, Stripe test disputes (answering a dispute is web only)
**Before you start:** Staging with Stripe in test mode; Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web`. Open web at [http://localhost:8700](<http://localhost:8700>). Run `make stripe-setup` once and keep `make stripe-listen` running for card steps.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Card steps use the Stripe sandbox; the demos are linked but their Stripe onboarding isn't finished (CB-69).

**QA steps**

1. Open a test inquiry.
   **Expect:** staff are alerted; no money moves.
2. Escalate to a dispute and lose it.
   **Expect:** the sale is unwound once; the document reads refunded; a part refund made during the inquiry fails.
3. Lose a dispute on a part-used gift card.
   **Expect:** only what it still holds is taken back; the rest is a loss.
4. Win a dispute.
   **Expect:** funds and fee reversed; the document stays paid.
5. Try to refund a payment under dispute.
   **Expect:** refused.

**Done when:** Money and the client's entitlements agree after every dispute outcome.

**By hand only**

* Suspending a disputed package or gift card while open is not built (doc CLI-39 to do).

**Automated by**

* `STR-E02 (stripe)`
* `STR-E03 (stripe)`
* `STR-E04 (stripe)`

**To automate**

* `STR-E24` in `apps/connect/e2e/stripe/disputes.stripe.ts`: A won dispute reverses funds and fee (PAY-E19).

**Depends on:** Nothing

### Hand the bookkeeper reports that add up (CB-45)

**Covers:** Payments > Reports on web and mobile, CSV downloads, bookkeeper ZIP
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234 after a test week of sales, refunds and pay

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile`. Open web at [http://localhost:8700](<http://localhost:8700>) and mobile in the iOS simulator.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Mobile waits on a staging build (CB-61).

**QA steps**

1. Run income, sales by item, GST/HST, PST, T4A, payouts and staff pay for the week.
   **Expect:** totals match the sales and payments made.
2. Download each CSV and the bookkeeper ZIP and open them in a spreadsheet.
   **Expect:** the same cents as on screen; empty periods disable export.
3. Run the reports from a laptop in another time zone.
   **Expect:** the same day boundaries, in the business zone.
4. As staff, open Reports.
   **Expect:** not available.

**Done when:** A bookkeeper can work from the downloads without questions.

**Automated by**

* `FIN-REPORT-01 (web)`
* `FIN-EXPORT-02 (web)`

**To automate**

* `FIN-REPORT-12` in `apps/web/e2e/reports.e2e.ts`: Sales by item, GST/HST with PST apart and T4A CSVs against hand totals (FIN17, FIN11).

**Depends on:** Nothing

### Record filed GST/HST returns (CB-46)

**Covers:** Payments > Tax returns on web and mobile
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234 with a completed quarter

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile`. Open web at [http://localhost:8700](<http://localhost:8700>) and mobile in the iOS simulator.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Mobile waits on a staging build (CB-61).

**QA steps**

1. Download the quarter's GST/HST report on web (the worksheet and CSV are web only) and record the return.
   **Expect:** tax set aside drops by the amount filed.
2. Record the same period again.
   **Expect:** refused.
3. Record an unfinished period.
   **Expect:** refused.
4. Record both federal and provincial returns.
   **Expect:** each clears its own tax.

**Done when:** Tax set aside always equals what is still owed.

**Automated by**

* `FIN-RETURN-03 (filings)`

**To automate**

* `FIN-RETURN-13` in `apps/web/e2e/remittances.filing.ts`: Overlap and partial-range rejection matrix (FIN14, FIN15).

**Depends on:** Nothing

### Match payouts and fees with Stripe (CB-47)

**Covers:** Payments > Payouts on web and mobile (bank details and the payout schedule are web only), Stripe dashboard, reconciliation job, admin drift
**Before you start:** Staging with Stripe in test mode; Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234 linked to the Stripe sandbox

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile worker`. Open web at [http://localhost:8700](<http://localhost:8700>) and mobile in the iOS simulator. Run `make stripe-setup` once and keep `make stripe-listen` running for card steps.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Mobile waits on a staging build (CB-61). Card steps use the Stripe sandbox; the demos are linked but their Stripe onboarding isn't finished (CB-69).

**QA steps**

1. After test payments, compare each fee to Stripe's dashboard.
   **Expect:** equal.
2. Change the automatic payout schedule.
   **Expect:** saved in Stripe; staff cannot.
3. Create a manual payout.
   **Expect:** in transit, left out of Deposited until paid, then under Bank deposits.
4. Page through payout history and a payout's contents.
   **Expect:** older pages load and return to newest.
5. Withhold a payment event and let the replay job apply it.
   **Expect:** no duplicate entries.
6. After the hourly reconciliation, open the admin drift page.
   **Expect:** no unexplained difference for the run.
7. Start a card payment at the desk and leave it, and open a pay link and leave it.
   **Expect:** the pay link's payment is cancelled after an hour and the desk one after a day, and both can still be paid again.

**Done when:** Our figures and Stripe's agree to the cent.

**By hand only**

* A real bank deposit arriving.

**Automated by**

* `STR-E01 (stripe)`
* `STR-E08 (stripe, needs_decision)`
* `STR-E12 (stripe)`
* `FLOW-10-A (journeys)`
* `web: payouts.e2e.ts › payout contents paginate and clear when switching to a manual payout`
* `web: payouts.e2e.ts › payout history reaches older pages and returns to the newest page`

**To automate**

* `STR-E25` in `apps/connect/e2e/stripe/reconciliation.stripe.ts`: Withheld webhook replayed once and reconciled (PAY-E10, FIN19).

**Depends on:** Nothing

### Pay the team (CB-48)

**Covers:** Payments > Staff pay and My pay on web and mobile, statements, T4A
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234 (Diego on commission)

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile`. Open web at [http://localhost:8700](<http://localhost:8700>) and mobile in the iOS simulator.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Mobile waits on a staging build (CB-61).

**QA steps**

1. Set 40% on services and 10% on retail.
   **Expect:** saved per member.
2. A $100 groom and a $30 product.
   **Expect:** earnings $40 and $3.
3. Refund half the groom after paying it.
   **Expect:** a $20 clawback; the next pay settles it.
4. Approve and pay, undo the payment, pay again.
   **Expect:** the T4A counts the net once.
5. Pay everything done through yesterday.
   **Expect:** today's work waits.
6. Add a bonus adjustment.
   **Expect:** it shows in the run and the statement.
7. Sign in as the groomer.
   **Expect:** My pay shows the same rows and statements, read-only.

**Done when:** Earnings match the rates by hand and the T4A adds up.

**By hand only**

* iPad layout of Staff pay (doc CLI-44 to do).

**Automated by**

* `PAY-E2E-01 (web)`
* `PAY-E2E-02 (web)`
* `PAY-E2E-03 (web)`
* `mobile: earnings.yaml (walk, unregistered)`

**To automate**

* `PAY-E2E-05` in `apps/web/e2e/earnings.e2e.ts`: Rate matrix (percent, fixed per visit, hourly, retail) and a pay-through-date cut-off (FIN07, FIN09).
* `PAY-E2E-06` in `apps/web/e2e/earnings.e2e.ts`: T4A after pay, undo and repay, owner left out (FIN11).

**Depends on:** Nothing

## 9. Talk to clients

The business texts clients from one inbox, respects consent, and sends forms, contracts and review requests.

**Linear project:** [9. Talk to clients](https://linear.app/clientbridgeca/project/9-talk-to-clients-9c108b7b046b)

**Walk on staging:** Text a client and get the reply, broadcast to a tag that includes a STOP client, send a form and a contract before a visit, and ask for a review after it.

### Text clients from one inbox, on the business's own number (CB-49)

**Covers:** Inbox on web and mobile, Twilio inbound webhook, admin SMS assignment
**Before you start:** Staging with Stripe in test mode with Twilio; two businesses with their own numbers; a real phone

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile`. Open web at [http://localhost:8700](<http://localhost:8700>) and mobile in the iOS simulator. Texts land in Mailpit at [http://localhost:8715](<http://localhost:8715>).
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Mobile waits on a staging build (CB-61). Texts to demo clients show as sent and go nowhere; real texts wait on the staging Twilio numbers (CB-69).

**QA steps**

1. Text a client and reply from their phone.
   **Expect:** the reply lands in the same thread on web and mobile.
2. Text the same phone from both businesses.
   **Expect:** each reply reaches only the business whose number it answers.
3. Send an unsigned or repeated inbound webhook.
   **Expect:** nothing changes.
4. Make the provider refuse a message.
   **Expect:** the draft is kept; retry sends it once.
5. As staff, message a client.
   **Expect:** allowed; broadcasts and exports stay closed.
6. Make the SMS provider fail once on a send.
   **Expect:** the text is retried and arrives once.

**Done when:** No reply can reach the wrong business, and nothing is sent twice.

**By hand only**

* A real handset reply through Twilio and carrier delivery.

**Automated by**

* `MSG-E2E-01 (web)`
* `MSG-E2E-02 (web)`
* `MSG-E2E-03 (web)`
* `MSG-E2E-10 (web)`
* `MSG-E2E-11 (web)`
* `MSG-E2E-13 (web)`
* `mobile: messaging.yaml, messaging.navigation.yaml (walks, unregistered)`

**To automate**

* `MSG-E2E-18` in `apps/web/e2e/messaging.e2e.ts`: First-thread contention from two devices (MSG05).
* `MSG-E2E-22` in `apps/web/e2e/previews.e2e.ts`: Previews for ready, departed, rescheduled, form, contract and review match the delivered text (MSG17).
* `MSG-E2E-23` in `apps/web/e2e/messaging.e2e.ts`: Delivery retry classification (MSG15).

**Depends on:** Nothing

### Honour STOP and consent everywhere (CB-50)

**Covers:** Client record consent, inbound STOP and START, staff toggle, consent export
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web`. Open web at [http://localhost:8700](<http://localhost:8700>). Texts land in Mailpit at [http://localhost:8715](<http://localhost:8715>).
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Texts to demo clients show as sent and go nowhere; real texts wait on the staging Twilio numbers (CB-69).

**QA steps**

1. Reply STOP from a client's phone.
   **Expect:** every device shows texts off for that client; queued notices to the number are not sent.
2. Turn texts back on from the staff toggle.
   **Expect:** refused until the number replies START.
3. Change the client's phone to another number.
   **Expect:** texts to the new number work; the old number stays stopped.
4. Record a no to offers for another client.
   **Expect:** shown on the record with the date.
5. Export consents.
   **Expect:** a CSV with each client's state and dates.

**Done when:** A number that replied STOP can't be texted by the business, except what the law allows, until it replies START.

**Automated by**

* `FLOW-06-A (journeys)`
* `MSG-E2E-14 (journeys)`
* `MSG-E2E-15 (journeys)`

**To automate**

* `MSG-E2E-19` in `apps/web/e2e/messaging.e2e.ts`: Consent export and a staff-recorded no to offers (MSG20).

**Depends on:** Nothing

### Send broadcasts only to clients who agreed (CB-51)

**Covers:** Inbox > Broadcasts on web and mobile (the results table is web only), broadcast job
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile worker`. Open web at [http://localhost:8700](<http://localhost:8700>) and mobile in the iOS simulator. Texts land in Mailpit at [http://localhost:8715](<http://localhost:8715>).
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Mobile waits on a staging build (CB-61). Texts to demo clients show as sent and go nowhere; real texts wait on the staging Twilio numbers (CB-69).

**QA steps**

1. Broadcast to a tag that includes a STOP client and a no-to-offers client.
   **Expect:** neither receives it; the rest do.
2. Check the audience count before sending.
   **Expect:** it excludes both.
3. Schedule one inside quiet hours.
   **Expect:** held until 09:00 local.
4. Cancel a scheduled broadcast.
   **Expect:** nobody is messaged.
5. Try a broadcast on a business with no legal address.
   **Expect:** refused with a reason.

**Done when:** An opted-out client never receives a broadcast.

**Automated by**

* `MSG-E2E-16 (web)`
* `PLN-E2E-03 (web)`

**To automate**

* `MSG-E2E-20` in `apps/web/e2e/journeys/communication.journey.ts`: Broadcast to a tag skips STOP and no-offers clients; quiet hours hold (MSG11, MSG12, MSG13).
* `MSG-E2E-21` in `apps/web/e2e/journeys/communication.journey.ts`: Consent changes during fan-out (MSG09).

**Depends on:** Nothing

### Collect intake forms before the first visit (CB-53)

**Covers:** Forms on web and mobile, Connect form page, intake job
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile dev-connect worker`. Open web at [http://localhost:8700](<http://localhost:8700>), mobile in the iOS simulator and Connect at `book.`, `shop.`, `pay.` and `<slug>.localhost:8709`. Texts land in Mailpit at [http://localhost:8715](<http://localhost:8715>).
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>) and Connect at `book.`, `shop.`, `pay.` and `<slug>.staging.clientbridge.ca`, with the same logins. Mobile waits on a staging build (CB-61). Texts to demo clients show as sent and go nowhere; real texts wait on the staging Twilio numbers (CB-69).

**QA steps**

1. Build a form with text, choice and a file upload on mobile.
   **Expect:** saved and shown on web.
2. Book as a new client.
   **Expect:** the form is texted by the intake job once.
3. Fill it on a phone with a PDF and an oversized file.
   **Expect:** the PDF uploads; the oversized file is refused.
4. Submit twice.
   **Expect:** one response, with consent recorded.
5. Edit the form while the client has it open.
   **Expect:** their answers keep the questions they saw; the next send asks the new ones.
6. Open the answers on web and mobile.
   **Expect:** on the client's record.

**Done when:** The business has every new client's answers before the visit.

**Automated by**

* `DOC-E2E-01 (connect)`
* `FLOW-05-B (journeys)`
* `connect: publicForm.e2e.ts › a client starts a form and a contract`
* `mobile: messaging.yaml (form editor walk, unregistered)`

**To automate**

* `DOC-E2E-08` in `apps/connect/e2e/publicForm.e2e.ts`: Real file upload and the size and type matrix (DOC05, DOC06).
* `DOC-E2E-09` in `apps/web/e2e/journeys/documents.journey.ts`: Intake job sends once to a new client (DOC10).

**Depends on:** Nothing

### Send contracts and keep what was signed (CB-54)

**Covers:** Contracts on web and mobile, Connect contract page
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile dev-connect`. Open web at [http://localhost:8700](<http://localhost:8700>), mobile in the iOS simulator and Connect at `book.`, `shop.`, `pay.` and `<slug>.localhost:8709`. Texts land in Mailpit at [http://localhost:8715](<http://localhost:8715>).
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>) and Connect at `book.`, `shop.`, `pay.` and `<slug>.staging.clientbridge.ca`, with the same logins. Mobile waits on a staging build (CB-61). Texts to demo clients show as sent and go nowhere; real texts wait on the staging Twilio numbers (CB-69).

**QA steps**

1. Send a contract and sign it with a typed name on a phone.
   **Expect:** signature, time and IP kept with the text as signed.
2. Sign another by drawing, clear and redraw.
   **Expect:** only the final stroke is kept.
3. Decline one, then try to sign it from a stale tab.
   **Expect:** refused.
4. Publish new terms while a contract is open.
   **Expect:** the client must review and consent again; earlier signatures keep their version.
5. Download a signed copy.
   **Expect:** today there is no signed PDF; record whether one is needed for launch.

**Done when:** A signed contract can be produced on request with its version, time and IP.

**By hand only**

* Signed PDF output is not built.

**Automated by**

* `DOC-E2E-02 (connect)`
* `DOC-E2E-03 (connect)`
* `DOC-E2E-04 (connect)`
* `DOC-E2E-05 (connect)`
* `FLOW-05-A (journeys)`

**To automate**

* `DOC-E2E-10` in `apps/web/e2e/journeys/documents.journey.ts`: Contract create, publish and resend with a lost response (DOC14).

**Depends on:** Nothing

### Ask for Google reviews after visits (CB-55)

**Covers:** Inbox > Reviews on web and mobile, review request job, Google Business Profile connection
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234; a Google review link; after Google approval, a test Business Profile

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile worker`. Open web at [http://localhost:8700](<http://localhost:8700>) and mobile in the iOS simulator. Texts land in Mailpit at [http://localhost:8715](<http://localhost:8715>).
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins. Mobile waits on a staging build (CB-61). Texts to demo clients show as sent and go nowhere; real texts wait on the staging Twilio numbers (CB-69). The Google review link waits on Business Profile API access.

**QA steps**

1. Save the Google review link.
   **Expect:** requests are allowed only with a link and for managers.
2. Request a review after a completed visit.
   **Expect:** the text links straight to Google and the history shows the client and booking.
3. Request again for the same booking.
   **Expect:** refused; the job asks each client at most once in 30 days.
4. Open Reviews without a connection.
   **Expect:** the unavailable, unlinked and empty states read clearly.
5. After Google approval, connect a profile, read reviews and reply.
   **Expect:** the reply appears on Google.

**Done when:** Clients get neutral invitations straight to Google, and the owner can reply once Google approves access.

**By hand only**

* Real Google OAuth and replies, blocked on Business Profile API approval.

**Automated by**

* `web: shell.e2e.ts › Google Reviews distinguishes unavailable, unlinked and empty profiles`

**To automate**

* `REV-E2E-01` in `apps/web/e2e/reviews.e2e.ts`: Manual invitation, duplicate booking refused, history (REV07, REV08).
* `REV-E2E-02` in `apps/web/e2e/reviews.e2e.ts`: Connect and select a profile against a recording Google fake (REV01, REV05).

**Depends on:** Nothing

## 10. Work anywhere

Staff run their day on any phone, tablet or browser tab, online or not, and every device agrees.

**Linear project:** [10. Work anywhere](https://linear.app/clientbridgeca/project/10-work-anywhere-d78e4046f5ab)

**Walk on staging:** Run part of a day on a phone and a tablet with the network off for an hour and web open in two tabs, and see every device agree, with a push for each new booking.

### Keep working offline and come back cleanly (CB-56)

**Covers:** Web production build with its service worker, mobile release build
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234; a release build on a phone; a production web build

**Where to test**

* **Local:** `make up migrate seed`, then `make up-app` for the production web build with its service worker at [http://localhost:8751](<http://localhost:8751>). Mobile needs a release build.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>) and the staging store builds (CB-61).

**QA steps**

1. Open the web app offline after a visit.
   **Expect:** the shell and replica load.
2. Edit hours offline, close the tab, reopen online.
   **Expect:** the week replays once.
3. Try an online-only action offline (a refund).
   **Expect:** the app says a connection is needed.
4. Let the session expire while offline, then reconnect.
   **Expect:** asked to sign in; the unsent week is kept.
5. Relaunch the phone app with no server reachable.
   **Expect:** Today and a client record open from the device.

**Done when:** Nothing written offline is lost or sent twice, and the app is honest about what needs a connection.

**By hand only**

* Airplane mode on a real phone (the lane cuts services instead).

**Automated by**

* `OFF-E2E-01 (web)`
* `OFF-E2E-04 (web)`
* `XB-E2E-05 (web)`
* `FLOW-09-A (journeys)`
* `NATIVE-IOS-02 (native-ios, native-android)`
* `SYN-E2E-27 (sync)`

**To automate**

* `NATIVE-OFF-01` in `apps/mobile/e2e/offline.hours.yaml`: Edit hours offline on the phone and see them reach web after reconnect (register the flow).

**Depends on:** Nothing

### Keep tabs and devices in step (CB-57)

**Covers:** Web tabs on OPFS and IndexedDB, sign-out, account switch, sync health and debug panel
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234; Chrome, Safari and Firefox

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web`. Open web at [http://localhost:8700](<http://localhost:8700>).
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), with the same logins.

**QA steps**

1. Open three tabs, close the one syncing.
   **Expect:** another takes over; all stay current.
2. Sign out in one tab.
   **Expect:** every tab stops; the replica files are removed once both close.
3. Sign in as another account on the same browser.
   **Expect:** a new replica; nothing from the first account.
4. Use a private window.
   **Expect:** the replica lives in IndexedDB and reopens after reload.
5. Fill storage past quota.
   **Expect:** the app says storage is full.
6. Make the same change on web and a phone at once.
   **Expect:** both end the same.

**Done when:** Every tab and device shows the same data, and an account's data never leaks to the next account.

**By hand only**

* Sync health and the debug panel are read by eye.

**Automated by**

* `SYN-E2E-20 (sync)`
* `SYN-E2E-21 (sync)`
* `SYN-E2E-22 (sync)`
* `SYN-E2E-23 (sync)`
* `SYN-E2E-26 (sync)`
* `SYN-E2E-28 (sync)`
* `SYN-E2E-29 (sync)`
* `SYN-E2E-31 (sync)`
* `SYN-E2E-32 (sync)`
* `SYN-E2E-33 (sync)`
* `XB-E2E-17 (web)`
* `XB-E2E-20 (web)`
* `XB-E2E-21 (web)`
* `sync: lifecycle.e2e.ts and storage.e2e.ts (unregistered tests)`

**Depends on:** Nothing

### Notify staff on their phones (CB-59)

**Covers:** Push registration, notifications feed on web and mobile
**Before you start:** Staging with Stripe in test mode; store builds on an iPhone and an Android phone

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-web dev-mobile`, with a development build on a real phone, since the simulator gets no push. The web feed is at [http://localhost:8700](<http://localhost:8700>).
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>) and the staging store builds (CB-61) on real phones.

**QA steps**

1. Book online.
   **Expect:** the member's phone gets a push.
2. Send a Connect message.
   **Expect:** a push that opens that client's conversation when tapped.
3. Open the notifications feed on web and mobile.
   **Expect:** the same items, marked seen.

**Done when:** Staff hear about new bookings and messages on their phones.

**By hand only**

* Real APNs and FCM delivery with production credentials.

**Automated by**

* `NATIVE-IOS-03 (native-ios)`

**To automate**

* `NATIVE-PUSH-01` in `apps/mobile/e2e/notifications.yaml`: Run the push tap flow on Android too (MSG18).

**Depends on:** CB-61

### Use the app on iPhone, Android and iPad (CB-60)

**Covers:** Every mobile screen on phones and tablets, screen readers
**Before you start:** Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234; store builds

**Where to test**

* **Local:** `make up migrate seed`, then `make dev-api dev-mobile` on iPhone, Android and iPad simulators. Screen readers need real devices.
* **Staging:** The staging store builds (CB-61) on real phones and an iPad, with VoiceOver and TalkBack.

**QA steps**

1. Walk Today, Schedule, Clients, Payments, Inbox and Setup on an iPhone and an Android phone, as owner and as staff.
   **Expect:** each screen fits the phone and shows what that role sees on web.
2. Open a client record and edit it on iPhone.
   **Expect:** the editor opens and saves (the known iOS regression in `regressions/client-editor.yaml` stays fixed).
3. Do the same on an iPad.
   **Expect:** the full-screen tablet layout with records opening in place.
4. Book a visit and take a sale with VoiceOver on, then with TalkBack.
   **Expect:** every control is announced by name and can be reached.

**Done when:** Staff can run their whole day on a supported phone or tablet, with or without a screen reader.

**By hand only**

* iPad layout review.
* Screen-reader pass with VoiceOver and TalkBack.
* iOS native runs are local only.

**Automated by**

* `NATIVE-CRM-01 (native-ios, native-android)`
* `NATIVE-IOS-01 (native-ios, native-android)`
* `mobile: today.yaml, setup.yaml, payments.yaml, messaging.yaml, clients.record.yaml, staff.yaml, billing.yaml, earnings.yaml (walks, unregistered)`

**To automate**

* `NATIVE-CRM-02` in `apps/mobile/e2e/clients.record.yaml`: Fix and fold `regressions/client-editor.yaml` into the default suite.

**Depends on:** CB-61

## 11. Platform and launch

The work around the product: staging that can run every QA step, store builds, production, the admin console, the marketing site and a full business day end to end.

**Linear project:** [11. Platform and launch](https://linear.app/clientbridgeca/project/11-platform-and-launch-748a330808f9)

**Walk on staging:** No walk of its own: CB-68 runs a full business day once the product epics are done.

### Make staging run every QA step (CB-69)

**Covers:** Staging: Twilio numbers and their assignment, Stripe sandbox onboarding of the demo businesses, the staging mobile build
**Before you start:** Platform admin on the staging admin console; the Stripe sandbox; a real phone

**Where to test**

* **Local:** Not applicable: this ticket sets up staging.
* **Staging:** [https://admin.staging.clientbridge.ca](<https://admin.staging.clientbridge.ca>) with a platform-admin grant, the Stripe sandbox dashboard and the Twilio console.

**QA steps**

1. Get staging Twilio numbers through Trust Hub, one for each demo business QA texts from (at least two, for CB-49), and assign each in the admin console.
   **Expect:** a text to a real phone arrives from each business, and the reply lands in that business's Inbox thread.
2. Finish Stripe onboarding for the demo businesses in the sandbox.
   **Expect:** Getting paid shows cards and payouts on, and a 4242 payment settles.
3. Install the staging build from CB-61 and sign in as hannah@birchbark.example.
   **Expect:** Today opens against staging.

**Done when:** Every product ticket's staging steps can run, with no step waiting on texts, cards or the mobile build.

**By hand only**

* All of it: these are one-off setup steps on the providers.

**Automated by**

* No e2e case yet

**Depends on:** Nothing

### Ship store builds staff can install (CB-61)

**Covers:** EAS builds, TestFlight, Play internal track, OTA updates
**Before you start:** Staging and production build profiles

**Where to test**

* **Local:** Not applicable: the builds come from EAS.
* **Staging:** Install the staging builds from TestFlight and the Play internal track. The EAS setup in operations.md isn't done yet.

**QA steps**

1. Install from TestFlight and the Play internal track; sign in as owner and staff.
   **Expect:** both point at the right environment.
2. Ship a JS-only change as an EAS update.
   **Expect:** installed apps pick it up within two starts.
3. Check the native fingerprint on a config change.
   **Expect:** the deploy asks for a store build.

**Done when:** Both store builds install, sign in and update the way the operations doc says.

**By hand only**

* Store submission, signing and review.

**Automated by**

* No e2e case yet

**Depends on:** Nothing

### Run the business live in production (CB-64)

**Covers:** Production web, mobile, Connect and site addresses with live Stripe, Twilio, Resend, Expo push, Google and storage
**Before you start:** Production with live keys; one real phone number and card you control

**Where to test**

* **Local:** Not applicable: this ticket runs in production.
* **Staging:** Not applicable: pass CB-68 on staging first.

**QA steps**

1. Sign in on the production web app and the store builds.
   **Expect:** each opens its business and syncs.
2. Take a real $1 card payment in live mode and refund it.
   **Expect:** both recorded; fees match Stripe.
3. Send a real text and a staff email from production.
   **Expect:** delivered from the business's number and the production sender.
4. Upload a photo and receive a push notification on a phone.
   **Expect:** the photo is stored and shown; the push arrives.
5. Book and pay on the business's public booking page.
   **Expect:** the booking reaches the schedule and the payment shows in Payments.

**Done when:** A business can sign in, take money, text clients and take bookings in production, on real providers.

**By hand only**

* Live payments, real carriers and real email are manual by nature.

**Automated by**

* `STR-E12 (stripe), sandbox only`

**Depends on:** CB-61

### Operate the platform from the admin console (CB-65)

**Covers:** Admin app pages and `/v1/admin`
**Before you start:** An operator account; a non-operator account

**Where to test**

* **Local:** `make up migrate seed`, then `make configure-demo-admin`, restart `make dev-api` and run `make dev-admin`. Open [http://localhost:8711](<http://localhost:8711>) as hannah@birchbark.example.
* **Staging:** [https://admin.staging.clientbridge.ca](<https://admin.staging.clientbridge.ca>), which needs a platform-admin grant on staging.

**QA steps**

1. Open the console as a non-operator and as an operator.
   **Expect:** only the operator gets in; pages are not cached.
2. Unverify the operator's email.
   **Expect:** they lose the console on the next check.
3. Search businesses, people and payments; open a payment.
   **Expect:** its ledger and activity show.
4. Change a business's edition.
   **Expect:** the owner's app follows; the plan does not change.
5. Assign and retire an SMS number.
   **Expect:** inbound texts follow the assignment.
6. Acknowledge a drift finding and send an email sample.
   **Expect:** recorded once.

**Done when:** Operators can find and fix what they need, and nobody else can.

**Automated by**

* `OPS-E2E-01 (web)`
* `OPS-E2E-02 (web)`
* `OPS-E2E-03 (web)`
* `FLOW-10-A (journeys)`

**To automate**

* `OPS-E2E-08` in `apps/web/e2e/admin.e2e.ts`: SMS number assignment and retirement (OPS07).
* `OPS-E2E-09` in `apps/web/e2e/admin.e2e.ts`: Drift acknowledge and email sample replay (OPS08, OPS09).

**Depends on:** Nothing

### Launch a marketing site that makes no claim the product can't back (CB-66)

**Covers:** Marketing site pages, contact form, waitlist build
**Before you start:** The built site on staging

**Where to test**

* **Local:** `make dev-site` at [http://localhost:8710](<http://localhost:8710>), and `make build-site` for the static build.
* **Staging:** [https://staging.clientbridge.ca](<https://staging.clientbridge.ca>), which robots.txt keeps out of search.

**QA steps**

1. Search the built site for placeholders.
   **Expect:** none, including legal pages.
2. Walk each trade page against the app.
   **Expect:** every claim holds.
3. Send the contact form, then a bot post.
   **Expect:** the team gets one email; the bot post is dropped.
4. Open each demo link.
   **Expect:** the seeded business page opens.
5. From the live site, Start free.
   **Expect:** `/signup` creates an account; Sign in reaches the app.

**Done when:** The live site makes no claim the product can't back, and every link works.

**By hand only**

* Legal review of the privacy policy and terms.
* Claim-by-claim review against the product.

**Automated by**

* `OPS-E2E-04 (connect)`
* `OPS-E2E-05 (connect)`
* `site CI: content, link, accessibility and Lighthouse checks (`make test-site`)`

**To automate**

* `OPS-E2E-10` in `apps/connect/e2e/site.e2e.ts`: Start free and Sign in links reach `/signup` and the app (OPS12).

**Depends on:** Nothing

### Run a full business day end to end (CB-68)

**Covers:** Everything, on staging with the store builds
**Before you start:** Staging with Stripe in test mode; Birchbark Pet Studio (BC, pets): owner hannah@birchbark.example, admin admin@birchbark.example, staff priya@birchbark.example and diego@birchbark.example, password demo1234; Chrome and Safari on a laptop; one iPhone and one Android phone with the store builds

**Where to test**

* **Local:** Not applicable: this runs on staging with the store builds.
* **Staging:** [https://app.staging.clientbridge.ca](<https://app.staging.clientbridge.ca>), the Connect pages on `staging.clientbridge.ca` and the staging store builds (CB-61). Texts to demo clients show as sent and go nowhere; real texts wait on the staging Twilio numbers (CB-69).

**QA steps**

1. Owner day on web: schedule, a walk-in, two invoices paid by link and saved card, a gift card and a package, one refund.
   **Expect:** no errors; statuses right.
2. Staff day on iPhone, then Android: own bookings, move one, add a note, collect a deposit, a Tap to Pay sale.
   **Expect:** matches web.
3. Client side on a phone: book with a deposit, fill a form, sign a contract, pay an invoice, order from the shop.
   **Expect:** each reaches staff.
4. Money: Today, income, GST/HST, staff pay and Stripe's balance.
   **Expect:** agree to the cent.
5. Sync: the same change on web and a phone at once, and offline hours.
   **Expect:** the same everywhere.

**Done when:** Every step passes on staging with the store builds and no launch-blocking bug is open.

**By hand only**

* The whole day is run by a person.

**Automated by**

* No e2e case yet

**Depends on:** CB-61

---

## After launch

Not tracked in Linear. These are pulled in by demand once the launch tickets pass.

- **Growth and commerce:** multiple locations per business (needs a location model), loyalty and rewards,
  online gift card purchase and balance check.
- **Buy now, pay later:** Affirm, Afterpay and Klarna as Stripe payment methods on each connected
  account, offered in the same Payment Element as cards and Link on our direct-charge PaymentIntents,
  once a business turns them on and Stripe activates the capabilities. Confirm current Canadian
  availability and fees in the Stripe docs first; provider fees are higher than card fees, so the
  platform fee for these methods needs a decision.
- **Platform and scale:** a public developer API with keys and outbound webhooks (`webhooks` is inbound
  only), custom permissions (`contractor` has staff permissions
  today), suspending or offboarding a business through `businesses.status`.
- **Feature depth:** membership pause, trial and plan change, package sessions used automatically on
  booking, a cancellation policy with a late-cancel fee, configurable reminders, Google and iCal calendar
  sync, per-staff and travel buffers, conditional form fields, countersigning and a drawn signature.
- **Tax and reporting depth:** place of supply by client province, tax-inclusive pricing, compound tax,
  expenses and input tax credits for net profit, real T4A slips and e-filing, client statements, dunning
  and subscription retry.
- **Auth provider independence:** the backend and the deployed names already treat Kratos as one
  implementation of the auth service, but app-core's auth hooks (`domain/auth.ts`) read Kratos's flow
  shapes: node names such as `totp_qr` and `lookup_secret_codes`, request bodies such as
  `{method: "password", identifier}`, and catalog keys by Kratos message id (`auth.flowMessages.<id>`).
  Replacing Kratos today means rewriting those hooks. The fix is an intent-level `IdentityLike` (sign in,
  sign up, send and verify a code, second factor, Google, password change, TOTP and backup codes,
  passkeys) returning our own results and error codes, with the Kratos mapping kept in the api-client's
  `identity.ts`, so a new provider is a new adapter and the hooks, screens and catalog stay.
- **Platform hygiene:** retention and PII purge, metrics and tracing, blue-green deploys and rollback, more than one currency (CAD is fixed
  on create), a decision on `clients.custom_fields`.
- **Sync follow-ups:** window the money tables with balances, lifetime value and old invoice status
  served by the API, because at 50k clients the ledger screens take 3 to 12 seconds on a device;
  native resume; sanitized sync diagnostics and retention; whether the hours
  editor can express "no hours set"; an offline check on iOS, which the simulator cannot do per app.
- **A second language:** the catalogs, formatter and gates are in place with English only (see
  _Locale and time zones_ in the architecture doc). Adding French needs the translated catalog files,
  locale columns on businesses, users and clients (a schema change), the bodies of `activeLocale()` and
  `locale_for(...)`, language pickers, the device language through `expo-localization`, `/fr` routes and
  `hreflang` on the site, a per-locale prerender of the site (its content reads the catalog at import),
  Stripe's `locale` parameter, translated store listings, and a decision on whether a sent document keeps
  its language. Known gap to close then: the `no-composed-copy` rule cannot see text placed side by side in
  JSX. The localization
  audit of 2026-10-11 found more work that French needs:
  - A missing translation shows the raw key on both sides: `locale.ts` falls back to the key and
    `core/locale.py` passes the key to gettext. Both need a fallback chain to English before a partial
    catalog ships, and `gen-strings` needs the same ICU, `args` and missing-key checks for a translated
    file that it runs on `en-CA.json`.
  - Quebec's Charter of the French Language (as amended by Bill 96) applies to Quebec businesses, and
    contracts of adhesion must be offered in French first. Services, policies, descriptions and contract
    and form bodies are single text fields today, so supporting French and English versions of
    business-written content is a product and schema decision, not catalog work.
  - Almost every `locale_for(...)` call in `services/notifications.py` passes only the business, and one
    locale serves the client's text and the staff push for the same event. Separate client and
    staff languages need the builders' signatures to change, not only the body of `locale_for`. Connect
    does not read `navigator.languages`, nothing records a visitor's language when they book, and gift card
    recipients have no locale source.
  - Some English is written into data: the fallback invoice line "Visit" (`services/billing.py`) and the
    Stripe subscription product name, which is cached per item through `stripe_price_id`.
  - Search and sorting do not fold accents. Only the client directory search does; the command palette,
    Inbox, the booking picker and about 15 other searches use a plain lowercase match, and about 20 replica
    queries sort with SQLite `COLLATE NOCASE`, which folds ASCII only, so "Élise" sorts after "Zoé".
    `localeCompare` is called without the active locale, and Postgres has no `unaccent`.
  - Smaller items: the mobile polyfills load English Intl data only; the frontend ICU JSON and the backend
    `.po` catalog need one translation workflow and tool, and French plural rules need tests on both sides;
    `parseCents("12,50")` in English reads $1,250.00; SMS with French accents fall outside GSM-7 and cost
    more segments; the legal pages are placeholders.

### Connect, the client experience

Connect is the client-facing layer: booking, pay, shop, forms, contracts and a per-business
landing page, as a lean PowerSync-free app that can be embedded through `embed.js`. Still to come:

- **A signed-in client portal across businesses.** A new customer identity (magic link or one-time code)
  linked to each business's `clients` row through a claim flow, with reads across a customer's businesses
  (appointments, invoices, saved cards, balances, messages) and client actions (rebook, pay, reply). The
  booking and payment logic is already shared. The risk is a wrongly linked account showing one customer's
  data to another business, so we would start with a single business and add cross-business linking after.
- **Richer pages and white-label:** a real slot calendar, a multi-item cart, installable PWA, custom
  domains with host-based business lookup.
- **Business pages that preview and index:** Connect renders in the browser, so a shared `<slug>.D` link
  previews as Clientbridge in messages and search, and `robots.txt` disallows every Connect host. Serving
  each business page's title, description, logo and canonical link in its HTML would let link previews and
  production search show the business.
- **Public edge hardening:** bot protection on booking and pay requests, Redis-backed rate limiting, token
  expiry, a trustworthy client IP, a per-business `frame-ancestors` policy for embeds.
