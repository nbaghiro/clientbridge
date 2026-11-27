import { randomUUID } from "node:crypto";
import {
    dateKey,
    formatMoney,
    formatRate,
    parseTimestamp,
    strings,
    yearOf,
} from "@clientbridge/app-core/public";
import { type APIRequestContext, type Browser, expect, type Page, test } from "@playwright/test";
import {
    bookFreeVisit,
    bookingApi,
    cancelOwnedBooking,
    createBookingFixture,
} from "./support/bookings";
import { select } from "./support/db";
import { choosePaymentMethod, paymentPanel, payCash, saleTicket } from "./support/pos";
import { joinHoursStaff } from "./support/hours";
import { navigate, signIn } from "./support/session";
import {
    createStaffPaySale,
    expectStaffJournals,
    invoiceVisit,
    legSum,
    makePayee,
    openStaffPay,
    pickWorkThrough,
    refundSale,
    setPayOnTeam,
    showPaid,
    staffLedger,
    staffPayEvidence,
    statementBusiness,
    t4aRows,
    takeBackAdjustment,
} from "./support/earnings";
import { reports } from "./support/reports";
import { runUrl } from "@clientbridge/config/e2e/run";

const s = strings.earnings;
const d = strings.pos.desk;

async function joinStaff(browser: Browser, page: Page, request: APIRequestContext) {
    const joining = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
        return await joinHoursStaff(await joining.newPage(), request);
    } finally {
        await joining.close();
    }
}

test("PAY-E2E-01 approve owned service earnings and record payment once after response loss", async ({
    page,
    browser,
    request,
}, testInfo) => {
    test.setTimeout(180_000);
    const auth = new URL(runUrl("VITE_AUTH_URL"));
    if (!["localhost", "127.0.0.1"].includes(auth.hostname))
        throw new Error("Staff-pay prerequisites require isolated local auth");
    await signIn(page);
    const joining = await browser.newContext({ baseURL: new URL(page.url()).origin });
    const staff = await (async () => {
        try {
            return await joinHoursStaff(await joining.newPage(), request);
        } finally {
            await joining.close();
        }
    })();
    let bookingId: string | null = null;
    try {
        const sale = await createStaffPaySale(page, staff.id, (id) => {
            bookingId = id;
        });
        bookingId = sale.bookingId;
        const pending = await staffPayEvidence(bookingId);
        expectStaffJournals(pending, staff.id, "pending");
        const earningId = pending[0]?.journal_id;
        expect(earningId).toBeTruthy();
        const panel = await openStaffPay(page, staff.name);
        const line = panel.getByRole("listitem").filter({ hasText: sale.title });
        await expect(line).toContainText(formatMoney(6000, "CAD"));
        await expect(line).toContainText(s.stage.pending);
        await line.getByRole("checkbox").check();
        const approving = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === "/v1/earnings/approve" &&
                response.request().method() === "POST",
        );
        await panel.getByRole("button", { name: s.approveSelected(1), exact: true }).click();
        const approved = await approving;
        expect(approved.status(), await approved.text()).toBe(200);
        expect(approved.request().postDataJSON()).toEqual({ ids: [earningId] });
        const approvedEvidence = await staffPayEvidence(bookingId);
        expectStaffJournals(approvedEvidence, staff.id, "approved");
        await expect(line).toContainText(s.stage.approved);
        const pay = panel.getByRole("button", {
            name: s.payApproved(formatMoney(6000, "CAD")),
            exact: true,
        });
        await pay.click();
        const review = page.getByRole("dialog", {
            name: s.review.payTitle(formatMoney(6000, "CAD"), staff.name),
            exact: true,
        });
        await expect(review).toContainText(s.review.payBody);
        await review.getByRole("button", { name: strings.common.cancel, exact: true }).click();
        expect(await staffPayEvidence(bookingId)).toEqual(approvedEvidence);

        let captured: { key: string; body: string } | null = null;
        await page.route("**/v1/earnings/pay", async (route) => {
            const key = route.request().headers()["idempotency-key"];
            const body = route.request().postData();
            expect(key).toBeTruthy();
            expect(body).not.toBeNull();
            captured = { key: key ?? "", body: body ?? "" };
            const actual = await route.fetch();
            expect(actual.status(), await actual.text()).toBe(200);
            await route.abort("connectionreset");
        });
        await pay.click();
        await review.getByRole("button", { name: s.review.markPaid, exact: true }).click();
        await expect(panel.getByText(s.updateError, { exact: true })).toBeVisible();
        const paid = await staffPayEvidence(bookingId);
        expectStaffJournals(paid, staff.id, "paid");
        expect(captured).not.toBeNull();
        const sent = captured as { key: string; body: string } | null;
        if (sent === null) throw new Error("Pay command was not captured");
        expect(JSON.parse(sent.body)).toEqual({ ids: [earningId] });
        const replay = await page.request.post(`${bookingApi()}/v1/earnings/pay`, {
            headers: {
                Origin: new URL(page.url()).origin,
                "Idempotency-Key": sent.key,
                "Content-Type": "application/json",
            },
            data: sent.body,
        });
        expect(replay.status(), await replay.text()).toBe(200);
        expect(await staffPayEvidence(bookingId)).toEqual(paid);
        await page.unroute("**/v1/earnings/pay");
        await page.reload();
        const fresh = await openStaffPay(page, staff.name);
        await showPaid(fresh);
        await expect(fresh.getByRole("listitem").filter({ hasText: sale.title })).toContainText(
            s.stage.paid,
        );
        await expect(
            fresh.getByRole("button", { name: s.payApproved(formatMoney(0, "CAD")), exact: true }),
        ).toBeDisabled();
        const observer = await browser.newContext({ baseURL: new URL(page.url()).origin });
        try {
            const other = await observer.newPage();
            await signIn(other);
            const observed = await openStaffPay(other, staff.name);
            await showPaid(observed);
            await expect(
                observed.getByRole("listitem").filter({ hasText: sale.title }),
            ).toContainText(s.stage.paid);
            await other.reload();
            const reopened = await openStaffPay(other, staff.name);
            await showPaid(reopened);
            await expect(
                reopened.getByRole("listitem").filter({ hasText: sale.title }),
            ).toContainText(s.stage.paid);
            expect(await staffPayEvidence(bookingId)).toEqual(paid);
            await testInfo.attach("staff-pay-journals", {
                body: JSON.stringify(paid),
                contentType: "application/json",
            });
        } finally {
            await observer.close();
        }
    } finally {
        try {
            if (bookingId !== null) await cancelOwnedBooking(page, bookingId);
        } finally {
            await staff.cleanup();
        }
    }
});

async function joinPayee(page: Page, browser: Browser, request: APIRequestContext) {
    const joining = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
        return await joinHoursStaff(await joining.newPage(), request);
    } finally {
        await joining.close();
    }
}

test("PAY-E2E-02 claw back a refunded sale's paid pay from the next run, then undo that run", async ({
    page,
    browser,
    request,
}) => {
    test.setTimeout(240_000);
    await signIn(page);
    const staff = await joinPayee(page, browser, request);
    const bookings: string[] = [];
    try {
        const first = await createStaffPaySale(
            page,
            staff.id,
            (id) => bookings.push(id),
            "Saddle trim visit",
        );
        const panel = await openStaffPay(page, staff.name);
        const firstRow = panel.getByRole("listitem").filter({ hasText: first.title });
        await expect(firstRow).toContainText(s.stage.pending, { timeout: 60_000 });
        await firstRow.getByRole("checkbox").check();
        await panel
            .getByRole("button", { name: s.payApproved(formatMoney(6000, "CAD")), exact: true })
            .click();
        await page
            .getByRole("dialog", {
                name: s.review.payTitle(formatMoney(6000, "CAD"), staff.name),
                exact: true,
            })
            .getByRole("button", { name: s.review.markPaid, exact: true })
            .click();
        await expect(firstRow).toBeHidden();
        const firstRun = await staffLedger(staff.id);
        const firstPay = firstRun.filter((row) => row.event === "staff_payment");
        expect(firstPay).toHaveLength(2);
        const runOne = firstPay[0]?.run ?? null;
        expect(runOne).toMatch(/^prun_/);
        expect(legSum(firstRun, (row) => row.category === "bank")).toBe(-6000);

        await refundSale(page, first.paymentId, 5000);
        const clawback = panel.getByRole("listitem").filter({ hasText: s.refundOf(first.title) });
        await expect(clawback).toContainText(formatMoney(-3000, "CAD"), { timeout: 60_000 });
        await expect(clawback).toContainText(s.stage.pending);
        await expect(
            page.getByRole("button").filter({ has: page.getByText(staff.name, { exact: true }) }),
        ).toContainText(s.owesBack(formatMoney(3000, "CAD")));
        const clawed = await staffLedger(staff.id);
        const back = clawed.filter((row) => row.basis === "clawback");
        expect(back).toEqual([
            expect.objectContaining({ category: "staff_cost", amount_cents: -3000 }),
            expect.objectContaining({ category: "payable", code: "pending", amount_cents: 3000 }),
        ]);

        const second = await createStaffPaySale(
            page,
            staff.id,
            (id) => bookings.push(id),
            "Full coat care visit",
            15,
        );
        const secondRow = panel.getByRole("listitem").filter({ hasText: second.title });
        await expect(secondRow).toContainText(formatMoney(6000, "CAD"), { timeout: 60_000 });
        await secondRow.getByRole("checkbox").check();
        await panel
            .getByRole("button", { name: s.payApproved(formatMoney(3000, "CAD")), exact: true })
            .click();
        await page
            .getByRole("dialog", {
                name: s.review.payTitle(formatMoney(3000, "CAD"), staff.name),
                exact: true,
            })
            .getByRole("button", { name: s.review.markPaid, exact: true })
            .click();
        await expect(clawback).toBeHidden();
        await expect(secondRow).toBeHidden();
        const netted = await staffLedger(staff.id);
        const runTwo = netted.filter((row) => row.event === "staff_payment" && row.run !== runOne);
        expect(new Set(runTwo.map((row) => row.run)).size).toBe(1);
        expect(runTwo[0]?.run).toMatch(/^prun_/);
        expect(legSum(runTwo, (row) => row.category === "bank")).toBe(-3000);
        expect(legSum(netted, (row) => row.category === "bank")).toBe(-9000);
        expect(legSum(netted, (row) => row.category === "payable")).toBe(0);

        await showPaid(panel);
        const latest = panel
            .locator("section")
            .filter({ hasText: s.refundOf(first.title), hasNot: page.locator("section") });
        await expect(latest).toContainText(formatMoney(3000, "CAD"));
        await latest.getByRole("button", { name: s.undoRun, exact: true }).click();
        await page
            .getByRole("dialog", {
                name: s.review.undoRunTitle(formatMoney(3000, "CAD"), staff.name),
                exact: true,
            })
            .getByRole("button", { name: s.review.undo, exact: true })
            .click();
        await expect(latest).toBeHidden();
        const undone = await staffLedger(staff.id);
        const undos = undone.filter((row) => row.ref.endsWith(":undo"));
        expect(new Set(undos.map((row) => row.journal_id)).size).toBe(2);
        expect(legSum(undone, (row) => row.category === "bank")).toBe(-6000);
        expect(legSum(undone, (row) => row.category === "payable" && row.code === "approved")).toBe(
            -3000,
        );
        await panel.getByRole("button", { name: s.view.todo, exact: true }).click();
        await expect(secondRow).toContainText(s.stage.approved);
        await expect(clawback).toContainText(s.stage.approved);
        await page.reload();
        const fresh = await openStaffPay(page, staff.name);
        await expect(
            fresh.getByRole("button", {
                name: s.payApproved(formatMoney(3000, "CAD")),
                exact: true,
            }),
        ).toBeEnabled();
    } finally {
        try {
            for (const id of bookings) await cancelOwnedBooking(page, id);
        } finally {
            await staff.cleanup();
        }
    }
});

test("PAY-E2E-03 a team member reads their paid bonus and prints a statement headed by the business", async ({
    page,
    browser,
    request,
}) => {
    test.setTimeout(180_000);
    await signIn(page);
    const staff = await joinPayee(page, browser, request);
    try {
        await makePayee(page, staff.id);
        const panel = await openStaffPay(page, staff.name);
        await panel.getByRole("button", { name: s.addAdjustment, exact: true }).click();
        const sheet = page
            .getByRole("dialog")
            .filter({ has: page.getByRole("heading", { name: s.adjustment.title, exact: true }) });
        await sheet.getByLabel(s.adjustment.amount, { exact: true }).fill("50");
        await sheet.getByLabel(s.adjustment.reason, { exact: true }).fill("Holiday bonus");
        await sheet.getByRole("button", { name: s.adjustment.save, exact: true }).click();
        await expect(sheet).toBeHidden();
        const bonus = panel.getByRole("listitem").filter({ hasText: "Holiday bonus" });
        await expect(bonus).toContainText(formatMoney(5000, "CAD"));
        await bonus.getByRole("checkbox").check();
        await panel
            .getByRole("button", { name: s.payApproved(formatMoney(5000, "CAD")), exact: true })
            .click();
        await page
            .getByRole("dialog", {
                name: s.review.payTitle(formatMoney(5000, "CAD"), staff.name),
                exact: true,
            })
            .getByRole("button", { name: s.review.markPaid, exact: true })
            .click();
        await expect(bonus).toBeHidden();
        const ledger = await staffLedger(staff.id);
        expect(ledger.filter((row) => row.basis === "adjustment")).toEqual([
            expect.objectContaining({ category: "staff_cost", amount_cents: 5000 }),
            expect.objectContaining({ category: "payable", code: "pending", amount_cents: -5000 }),
        ]);
        expect(legSum(ledger, (row) => row.category === "bank")).toBe(-5000);
        expect(legSum(ledger, (row) => row.category === "payable")).toBe(0);

        const [business, ...others] = await statementBusiness(staff.id);
        if (business === undefined || others.length > 0) throw new Error("expected one business");
        const member = await browser.newContext({ baseURL: new URL(page.url()).origin });
        try {
            const own = await member.newPage();
            await own.addInitScript(() => {
                window.print = () => {
                    document.body.dataset.printed =
                        document.querySelector<HTMLElement>(".print-sheet")?.innerText ?? "";
                };
            });
            await signIn(own, staff.account);
            await navigate(own, "/payments/staff-pay");
            await expect(own.getByText(s.mine.subtitle, { exact: true })).toBeVisible({
                timeout: 60_000,
            });
            await expect(own.getByText(s.colMember, { exact: true })).toHaveCount(0);
            await own.getByRole("button", { name: s.view.paid, exact: true }).click();
            const run = own
                .locator("section")
                .filter({ hasText: "Holiday bonus", hasNot: own.locator("section") });
            await expect(run).toContainText(formatMoney(5000, "CAD"));
            await expect(run.getByRole("button", { name: s.undoRun, exact: true })).toHaveCount(0);
            await run.getByRole("button", { name: s.statement, exact: true }).click();
            await expect(own.locator("body")).toHaveAttribute("data-printed", /.+/);
            const printed = (await own.locator("body").getAttribute("data-printed")) ?? "";
            for (const part of [
                business.name,
                business.street_name,
                business.city,
                s.statementTitle,
                "Holiday bonus",
                formatMoney(5000, "CAD"),
            ])
                expect(printed).toContain(part);
        } finally {
            await member.close();
        }
    } finally {
        await staff.cleanup();
    }
});

test("PAY-E2E-04 a crew visit's desk tip splits by the crew, lands under each member and stays out of sales", async ({
    page,
    browser,
    request,
}, testInfo) => {
    test.setTimeout(240_000);
    await signIn(page);
    const lead = await joinStaff(browser, page, request);
    const helper = await joinStaff(browser, page, request);
    let bookingId: string | null = null;
    try {
        const visit = await createBookingFixture(page, {
            price_cents: 8000,
            tax_class: "federal_only",
        });
        const api = bookingApi();
        const headers = () => ({
            Origin: new URL(page.url()).origin,
            "Idempotency-Key": randomUUID(),
        });
        // a helper joins only before the visit starts, so it starts a few minutes from now
        const step = 5 * 60_000;
        const starts = new Date(Math.ceil((Date.now() + 2 * 60_000) / step) * step);
        const booked = await page.request.post(`${api}/v1/bookings`, {
            headers: headers(),
            data: {
                client_id: visit.clientId,
                item_id: visit.itemId,
                staff_id: lead.id,
                starts_at: starts.toISOString(),
                notify: false,
            },
        });
        expect(booked.status(), await booked.text()).toBe(201);
        const booking = (await booked.json()) as { id: string };
        bookingId = booking.id;
        const crewed = await page.request.post(`${api}/v1/bookings/${booking.id}/crew`, {
            headers: headers(),
            data: { staff_id: helper.id },
        });
        expect(crewed.status(), await crewed.text()).toBe(201);
        // the desk lists today's visits, so one booked past midnight waits for its day
        if (dateKey(starts, visit.zone) !== dateKey(new Date(), visit.zone)) {
            const wait = starts.getTime() - Date.now() + 5_000;
            test.setTimeout(test.info().timeout + wait);
            await page.waitForTimeout(wait);
        }

        await navigate(page, "/payments/sales");
        const row = page
            .getByRole("main")
            .locator("div")
            .filter({ has: page.getByText(visit.clientName, { exact: true }) })
            .filter({ has: page.getByRole("button", { name: d.checkOut, exact: true }) })
            .last();
        await row.getByRole("button", { name: d.checkOut, exact: true }).click({ timeout: 60_000 });
        await saleTicket(page)
            .getByRole("button", { name: d.charge("$84.00"), exact: true })
            .click();
        const payment = paymentPanel(page);
        await payment
            .getByRole("group", { name: d.tip, exact: true })
            .getByRole("button", { name: "20%", exact: true })
            .click();
        for (const member of [lead, helper])
            await expect(
                payment.getByRole("listitem").filter({ hasText: member.name }),
            ).toContainText(formatMoney(800, "CAD"));
        await choosePaymentMethod(payment, d.methodCash);
        await payment.getByRole("button", { name: d.exactCash, exact: true }).click();
        const paid = await payCash(page, payment, "$100.00");
        expect(paid).toMatchObject({ amount_cents: 10000, change_cents: 0 });

        const ledger = await select<{ category: string; owner_id: string; amount_cents: number }>`
            SELECT a.category, a.owner_id, e.amount_cents
            FROM entries e JOIN accounts a ON a.id = e.account_id
            WHERE e.source_id = ${paid.payment_id} AND a.category IN ('revenue', 'tax', 'payable')
            ORDER BY a.category, a.owner_id`;
        // the visit's $80 is the only sale; its $16 tip goes half to each of the crew, untaxed
        expect(ledger).toHaveLength(4);
        expect(ledger).toEqual(
            expect.arrayContaining([
                { category: "payable", owner_id: lead.id, amount_cents: -800 },
                { category: "payable", owner_id: helper.id, amount_cents: -800 },
                { category: "revenue", owner_id: expect.any(String), amount_cents: -8000 },
                { category: "tax", owner_id: expect.any(String), amount_cents: -400 },
            ]),
        );
        for (const member of [lead, helper]) {
            const panel = await openStaffPay(page, member.name);
            await expect(
                panel
                    .getByRole("listitem")
                    .filter({ hasText: s.sourceTip })
                    .filter({ hasText: visit.clientName }),
            ).toContainText(formatMoney(800, "CAD"));
            await page.keyboard.press("Escape");
            await expect(panel).toBeHidden();
        }
        await testInfo.attach("crew-tip-ledger", {
            body: JSON.stringify({ booking: booking.id, ledger }),
            contentType: "application/json",
        });
    } finally {
        if (bookingId !== null) await cancelOwnedBooking(page, bookingId);
        await lead.cleanup();
        await helper.cleanup();
    }
});

test("PAY-E2E-05 rates set on Team earn percent, retail, fixed and hourly pay, and a work-through day holds later work", async ({
    page,
    browser,
    request,
}) => {
    test.setTimeout(300_000);
    await signIn(page);
    const staff = await joinPayee(page, browser, request);
    let ahead: string | null = null;
    try {
        const visit = await createBookingFixture(page, {
            price_cents: 10000,
            tax_class: "federal_only",
            duration_min: 30,
        });
        const created = await page.request.post(`${bookingApi()}/v1/items`, {
            headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
            data: { kind: "product", name: `Leash for ${visit.clientName}`, price_cents: 3000 },
        });
        expect(created.status(), await created.text()).toBe(201);
        const leash = (await created.json()) as { id: string; name: string };
        const payOf = (id: string) =>
            select<{
                payee: boolean;
                rate_type: string | null;
                rate_bps: number | null;
                rate_cents: number | null;
                retail_rate_bps: number | null;
            }>`SELECT payee, rate_type, rate_bps, rate_cents, retail_rate_bps FROM staff WHERE id = ${id}`;
        const ownerBefore = await payOf(visit.staffId);

        const summary = await setPayOnTeam(page, staff.name, {
            type: "percent",
            rate: "40",
            retail: "10",
        });
        expect(summary).toBe(strings.staff.payWithRetail(strings.staff.payPercent(40), 10));
        expect(await payOf(staff.id)).toEqual([
            {
                payee: true,
                rate_type: "percent",
                rate_bps: 4000,
                rate_cents: null,
                retail_rate_bps: 1000,
            },
        ]);
        expect(await payOf(visit.staffId)).toEqual(ownerBefore);

        // the visit's own invoice carries a product sold at it, with no member named on its line
        const past = Array.from({ length: 7 }, (_, i) => -1 - i);
        const earlier = await bookFreeVisit(page, visit, staff.id, past, ["10:00", "10:30"]);
        const day = dateKey(parseTimestamp(earlier.starts_at), visit.zone);
        await invoiceVisit(page, earlier.id, [
            { description: leash.name, item_id: leash.id, unit_amount_cents: 3000 },
        ]);
        await setPayOnTeam(page, staff.name, { type: "fixed", rate: "12" });
        const sameDay = [earlier.offset];
        const fixed = await bookFreeVisit(page, visit, staff.id, sameDay, [
            "12:00",
            "12:30",
            "13:00",
        ]);
        await invoiceVisit(page, fixed.id);
        await setPayOnTeam(page, staff.name, { type: "hourly", rate: "30" });
        const hourly = await bookFreeVisit(page, visit, staff.id, sameDay, [
            "14:00",
            "14:30",
            "15:00",
        ]);
        await invoiceVisit(page, hourly.id);
        // from tomorrow, so the visit is still ahead at any hour and paying it doesn't complete it
        const coming = Array.from({ length: 7 }, (_, i) => i + 1);
        const later = await bookFreeVisit(page, visit, staff.id, coming, ["16:00", "16:30"]);
        ahead = later.id;
        await invoiceVisit(page, later.id);

        const panel = await openStaffPay(page, staff.name);
        const row = (text: string) => panel.getByRole("listitem").filter({ hasText: text });
        const money = (cents: number) => formatMoney(cents, "CAD");
        await expect(row(s.lineOf(formatRate(4000), money(10000)))).toContainText(money(4000), {
            timeout: 60_000,
        });
        await expect(row(leash.name)).toContainText(s.lineOf(formatRate(1000), money(3000)));
        await expect(row(leash.name)).toContainText(money(300));
        await expect(row(s.fixed)).toContainText(money(1200));
        await expect(row(s.hourly)).toHaveCount(2);
        for (const line of await row(s.hourly).all()) await expect(line).toContainText(money(1500));

        await pickWorkThrough(page, panel, day, visit.zone);
        await expect(row(s.hourly)).toHaveCount(1);
        await panel.getByRole("button", { name: s.payApproved(money(7000)), exact: true }).click();
        await page
            .getByRole("dialog", { name: s.review.payTitle(money(7000), staff.name), exact: true })
            .getByRole("button", { name: s.review.markPaid, exact: true })
            .click();
        await expect(panel.getByText(s.noneThrough, { exact: true })).toBeVisible();
        const ledger = await staffLedger(staff.id);
        const paid = ledger.filter((entry) => entry.event === "staff_payment");
        expect(legSum(paid, (entry) => entry.category === "bank")).toBe(-7000);
        expect(new Set(paid.map((entry) => entry.run)).size).toBe(1);
        const through = await select<{ through: string }>`
            SELECT DISTINCT e.meta->>'through' AS through FROM entries e
            WHERE e.event = 'staff_payment' AND e.owner_type = 'staff' AND e.owner_id = ${staff.id}`;
        expect(through).toEqual([{ through: day }]);
        const waiting = await staffPayEvidence(later.id);
        expect(waiting.map((e) => [e.event, e.category, e.amount_cents])).toEqual([
            ["earning", "staff_cost", 1500],
            ["earning", "payable", -1500],
        ]);
        expect(waiting.find((e) => e.category === "payable")?.code).toBe("pending");
        await showPaid(panel);
        await panel.getByRole("button", { name: s.view.todo, exact: true }).click();
        await expect(row(s.hourly)).toContainText(s.stage.pending);
    } finally {
        try {
            // paid visits that have started stay as history; one still ahead would keep the member
            if (ahead !== null) await cancelOwnedBooking(page, ahead);
        } finally {
            await staff.cleanup();
        }
    }
});

test("PAY-E2E-06 the T4A counts a payment undone and paid again once, and leaves the owner out", async ({
    page,
    browser,
    request,
}) => {
    test.setTimeout(240_000);
    await signIn(page);
    const staff = await joinPayee(page, browser, request);
    const bookings: string[] = [];
    let drawn: { ownerId: string; id: string } | null = null;
    try {
        const sale = await createStaffPaySale(
            page,
            staff.id,
            (id) => bookings.push(id),
            "T4A trim",
        );
        const api = bookingApi();
        const headers = () => ({
            Origin: new URL(page.url()).origin,
            "Idempotency-Key": randomUUID(),
        });
        const [owner] = await select<{ id: string; name: string; timezone: string }>`
            SELECT s.id, u.name, b.timezone FROM staff s
            JOIN users u ON u.id = s.user_id JOIN businesses b ON b.id = s.business_id
            WHERE s.role = 'owner' AND s.business_id = (
                SELECT business_id FROM staff WHERE id = ${staff.id})`;
        if (owner === undefined) throw new Error("the business has no owner");
        const draw = await page.request.post(`${api}/v1/earnings/adjustments`, {
            headers: headers(),
            data: { staff_id: owner.id, amount_cents: 2500, reason: "Owner's draw" },
        });
        expect(draw.status(), await draw.text()).toBe(201);
        const drawId = ((await draw.json()) as { id: string }).id;
        const paidDraw = await page.request.post(`${api}/v1/earnings/pay`, {
            headers: headers(),
            data: { ids: [drawId] },
        });
        expect(paidDraw.status(), await paidDraw.text()).toBe(200);
        drawn = { ownerId: owner.id, id: drawId };
        const year = yearOf(new Date(), owner.timezone);
        const t4a = async () => {
            const rows = await t4aRows(page, year);
            expect(rows.map((r) => r.staff_id)).not.toContain(owner.id);
            return rows.find((r) => r.staff_id === staff.id) ?? null;
        };
        const payRow = async () => {
            const panel = await openStaffPay(page, staff.name);
            // the panel keeps the view it was left on
            await panel.getByRole("button", { name: s.view.todo, exact: true }).click();
            const line = panel.getByRole("listitem").filter({ hasText: sale.title });
            await line.getByRole("checkbox").check({ timeout: 60_000 });
            await panel
                .getByRole("button", { name: s.payApproved(formatMoney(6000, "CAD")), exact: true })
                .click();
            await page
                .getByRole("dialog", {
                    name: s.review.payTitle(formatMoney(6000, "CAD"), staff.name),
                    exact: true,
                })
                .getByRole("button", { name: s.review.markPaid, exact: true })
                .click();
            await expect(line).toBeHidden();
            return panel;
        };
        const closePanel = async () => {
            await page.keyboard.press("Escape");
            await expect(page.getByRole("complementary", { name: staff.name })).toBeHidden();
        };

        const panel = await payRow();
        expect(await t4a()).toEqual({
            staff_id: staff.id,
            name: staff.name,
            fees_cents: 6000,
            tips_cents: 0,
            total_cents: 6000,
        });
        await showPaid(panel);
        await panel
            .getByRole("listitem")
            .filter({ hasText: sale.title })
            .getByRole("button")
            .filter({ hasText: s.undoPayment })
            .click();
        await page
            .getByRole("dialog", { name: s.review.undoPaymentTitle, exact: true })
            .getByRole("button", { name: s.review.undo, exact: true })
            .click();
        await expect(panel.getByRole("listitem").filter({ hasText: sale.title })).toBeHidden();
        expect(await t4a()).toBeNull();
        await closePanel();

        await payRow();
        expect((await t4a())?.total_cents).toBe(6000);
        const payments = (await staffPayEvidence(sale.bookingId)).filter(
            (e) => e.event === "staff_payment" && e.category === "bank",
        );
        expect(payments.map((e) => e.amount_cents)).toEqual([-6000, 6000, -6000]);

        await reports(page);
        await page.getByRole("tab", { name: strings.reports.library.t4a, exact: true }).click();
        await expect(page.getByRole("row", { name: staff.name })).toContainText(
            formatMoney(6000, "CAD"),
        );
        await expect(page.getByRole("row", { name: owner.name })).toHaveCount(0);
    } finally {
        try {
            if (drawn !== null) await takeBackAdjustment(page, drawn.ownerId, drawn.id, 2500);
            for (const id of bookings) await cancelOwnedBooking(page, id);
        } finally {
            await staff.cleanup();
        }
    }
});
