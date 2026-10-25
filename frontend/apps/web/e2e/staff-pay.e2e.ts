import { formatMoney, strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";

import { cancelOwnedBooking, bookingApi } from "./support/bookings";
import { joinHoursStaff } from "./support/offline";
import { signIn } from "./support/session";
import {
    createStaffPaySale,
    expectStaffJournals,
    openStaffPay,
    staffPayEvidence,
} from "./support/staff-pay";

const s = strings.earnings;

test("PAY-E2E-01 approve owned service earnings and record payment once after response loss", async ({
    page,
    browser,
    request,
}, testInfo) => {
    test.setTimeout(180_000);
    const auth = new URL(process.env.VITE_AUTH_URL ?? "http://localhost:8713");
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
            name: s.review.payTitle(formatMoney(6000, "CAD")),
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
            await expect(
                observed.getByRole("listitem").filter({ hasText: sale.title }),
            ).toContainText(s.stage.paid);
            await other.reload();
            await expect(
                (await openStaffPay(other, staff.name))
                    .getByRole("listitem")
                    .filter({ hasText: sale.title }),
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
