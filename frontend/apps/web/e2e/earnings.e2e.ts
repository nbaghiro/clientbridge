import { formatMoney, strings } from "@clientbridge/app-core/public";
import { type APIRequestContext, type Browser, expect, type Page, test } from "@playwright/test";
import { cancelOwnedBooking, bookingApi } from "./support/bookings";
import { joinHoursStaff } from "./support/hours";
import { navigate, signIn } from "./support/session";
import {
    createStaffPaySale,
    expectStaffJournals,
    legSum,
    makePayee,
    openStaffPay,
    refundSale,
    showPaid,
    staffLedger,
    staffPayEvidence,
    statementBusiness,
} from "./support/earnings";
import { runUrl } from "@clientbridge/config/e2e/run";

const s = strings.earnings;

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
