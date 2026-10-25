import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { bookingApi } from "./support/bookings";
import {
    addClassClient,
    classEvidence,
    classFixture,
    classManageUrl,
    cleanupClass,
    expectClassState,
    openClass,
} from "./support/classes";
import { signIn } from "./support/session";

test("CLS-E2E-01 enrollment, full-class waitlist and cancellation auto-promotion persist", async ({
    page,
    browser,
}, testInfo) => {
    await signIn(page);
    // The API creates the class and its initial session; subsequent enrollment and cancellation use UI.
    const fixture = await classFixture(page);
    try {
        const first = { client: fixture.first, id: fixture.bookingId, status: "confirmed" };
        await expectClassState(fixture, [first]);
        const secondId = await addClassClient(page, fixture, fixture.second, "confirmed");
        const second = { client: fixture.second, id: secondId, status: "confirmed" };
        await expectClassState(fixture, [first, second]);
        const waitingId = await addClassClient(page, fixture, fixture.waiting, "waitlisted");
        const waiting = { client: fixture.waiting, id: waitingId, status: "waitlisted" };
        const full = await expectClassState(fixture, [first, second, waiting]);
        const panel = await openClass(page, fixture);
        const waitingRow = panel.getByRole("listitem").filter({ hasText: fixture.waiting.name });
        await waitingRow
            .getByRole("button", { name: strings.classes.promote, exact: true })
            .click();
        await expect(panel.getByText(strings.classes.promoteFull, { exact: true })).toBeVisible();
        expect(await classEvidence(fixture.itemId)).toEqual(full);
        const rejected = await page.request.patch(
            `${bookingApi()}/v1/classes/${fixture.slotId}/roster/${waitingId}`,
            {
                headers: { Origin: new URL(page.url()).origin },
                data: { action: "promote" },
            },
        );
        expect(rejected.status(), await rejected.text()).toBe(409);
        expect(await rejected.json()).toMatchObject({ error: "class_full" });
        expect(await classEvidence(fixture.itemId)).toEqual(full);
        const clientContext = await browser.newContext();
        try {
            const client = await clientContext.newPage();
            const manageUrl = await classManageUrl(fixture);
            const token = new URL(manageUrl).pathname.split("/").at(-1);
            await client.goto(manageUrl);
            await expect(
                client.getByText(strings.publicManage.title, { exact: true }),
            ).toBeVisible();
            await expect(client.getByText(fixture.itemName, { exact: true })).toBeVisible();
            await client
                .getByRole("button", { name: strings.publicManage.cancel, exact: true })
                .click();
            await client
                .getByRole("button", { name: strings.publicManage.keep, exact: true })
                .click();
            expect(await classEvidence(fixture.itemId)).toEqual(full);
            await client
                .getByRole("button", { name: strings.publicManage.cancel, exact: true })
                .click();
            const canceled = client.waitForResponse(
                (response) =>
                    new URL(response.url()).pathname === `/manage/${token}/cancel` &&
                    response.request().method() === "POST",
            );
            await client
                .getByRole("button", { name: strings.publicManage.cancelConfirm, exact: true })
                .click();
            const response = await canceled;
            expect(response.status(), await response.text()).toBe(200);
            expect(await response.json()).toEqual({ deposit: "none", refund_cents: 0 });
            await expect(
                client.getByRole("heading", {
                    name: strings.publicManage.canceledTitle,
                    exact: true,
                }),
            ).toBeVisible();
            const refreshed = client.waitForResponse(
                (response) =>
                    new URL(response.url()).pathname === `/manage/${token}` &&
                    response.request().method() === "GET",
            );
            await client.reload();
            const loaded = await refreshed;
            expect(loaded.status()).toBe(200);
            expect(await loaded.json()).toMatchObject({
                booking_id: fixture.bookingId,
                status: "canceled",
                can_cancel: false,
                can_move: false,
            });
            await expect(
                client.getByText(strings.publicManage.canceledTitle, { exact: true }),
            ).toBeVisible();
            await expect(
                client.getByRole("button", { name: strings.publicManage.cancel, exact: true }),
            ).toHaveCount(0);
        } finally {
            await clientContext.close();
        }
        const final = await expectClassState(fixture, [
            { ...first, status: "canceled" },
            second,
            { ...waiting, status: "confirmed" },
        ]);
        const observer = await browser.newContext({
            baseURL: new URL(page.url()).origin,
            viewport: { width: 1440, height: 900 },
        });
        try {
            const other = await observer.newPage();
            await signIn(other);
            for (const replica of [page, other]) {
                for (let pass = 0; pass < 2; pass++) {
                    if (pass === 1) await replica.reload();
                    const roster = await openClass(replica, fixture);
                    await expect(roster.getByRole("listitem")).toHaveCount(2);
                    await expect(
                        roster.getByRole("listitem").filter({ hasText: fixture.second.name }),
                    ).toBeVisible();
                    await expect(
                        roster.getByRole("listitem").filter({ hasText: fixture.waiting.name }),
                    ).toBeVisible();
                    await expect(
                        roster.getByRole("listitem").filter({ hasText: fixture.first.name }),
                    ).toHaveCount(0);
                    await expect(
                        roster.getByText(strings.classes.emptyWaitlist, { exact: true }),
                    ).toBeVisible();
                    await expect(
                        replica
                            .getByRole("navigation", { name: strings.classes.upcoming })
                            .getByRole("button")
                            .filter({ hasText: fixture.itemName }),
                    ).toContainText(strings.classes.full);
                }
            }
            expect(await classEvidence(fixture.itemId)).toEqual(final);
            await testInfo.attach("class-capacity-and-auto-promotion", {
                body: JSON.stringify({ fixture, full, final }),
                contentType: "application/json",
            });
        } finally {
            await observer.close();
        }
    } finally {
        await cleanupClass(page, fixture);
    }
});
