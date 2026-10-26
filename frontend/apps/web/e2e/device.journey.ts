import { randomUUID } from "node:crypto";
import { strings } from "@clientbridge/app-core/public";
import { expect, test, type Page } from "@playwright/test";

import { bookingApi } from "./support/bookings";
import { addClientNote, createClient, openClient } from "./support/crm";
import {
    expectMondayOnly,
    hoursEvidence,
    joinHoursStaff,
    openHours,
    selectHoursTime,
    type HoursCommand,
} from "./support/offline";
import { navigate, signIn } from "./support/session";

const h = strings.hours;

function replicaFiles(page: Page): Promise<string[]> {
    return page.evaluate(async () =>
        (await indexedDB.databases())
            .map((database) => database.name ?? "")
            .filter((name) => name.startsWith("clientbridge-"))
            .sort(),
    );
}

async function signOut(page: Page): Promise<void> {
    await page.getByRole("button", { name: strings.navigation.accountMenu, exact: true }).click();
    await page.getByRole("menuitem", { name: strings.navigation.signOut, exact: true }).click();
}

test("FLOW-09-A a member's write reaches their second device, an offline week survives closing the tab and replays once, and the next account on the device starts clean", async ({
    page,
    context,
    request,
    browser,
    baseURL,
}, testInfo) => {
    test.skip(!process.env.CI, "Requires the production service worker");
    test.setTimeout(300_000);
    const member = await joinHoursStaff(page, request);
    let removed = false;
    const secondContext = await browser.newContext({
        baseURL: baseURL ?? "",
        viewport: { width: 1440, height: 900 },
    });
    try {
        const second = await secondContext.newPage();
        await signIn(second, member.account);

        const client = await createClient(page);
        const note = "Prefers the quiet room and a slow blow-dry. Allergic to lavender shampoo.";
        await addClientNote(page, client, note);
        const record = await openClient(second, client);
        await expect(record.getByText(note, { exact: true })).toBeVisible({ timeout: 60_000 });

        const baseline = await hoursEvidence(member.id);
        expect(baseline.staff.hours_revision).toBe(0);
        await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
        await page.reload();
        const filesBefore = await replicaFiles(page);
        expect(filesBefore).toHaveLength(1);
        const editor = await openHours(page, member.name);
        await context.setOffline(true);
        await selectHoursTime(page, editor, strings.ui.startOf(h.monday), "10:00");
        await selectHoursTime(page, editor, strings.ui.endOf(h.monday), "16:00");
        for (const day of [h.tuesday, h.wednesday, h.thursday, h.friday])
            await editor.getByRole("switch", { name: day, exact: true }).uncheck();
        await editor.getByRole("button", { name: h.saveHours, exact: true }).click();
        await expect(editor.getByText(h.savedLocally, { exact: true })).toBeVisible();
        await navigate(page, "/today");
        expect(await hoursEvidence(member.id)).toEqual(baseline);

        // signing out now would lose the week, so the app asks first and keeps it
        await signOut(page);
        const leaving = page.getByRole("dialog");
        await expect(leaving.getByText(strings.sync.signOutTitle, { exact: true })).toBeVisible();
        await expect(leaving).toContainText(strings.sync.signOutBody(1));
        await leaving
            .getByRole("button", { name: strings.sync.signOutCancel, exact: true })
            .click();

        await page.close();
        const device = await context.newPage();
        await device.goto("/today");
        const reopened = await openHours(device, member.name);
        await expectMondayOnly(reopened);
        await expect(reopened.getByText(h.savedLocally, { exact: true })).toBeVisible();
        expect(await hoursEvidence(member.id)).toEqual(baseline);

        const confirmed = device.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === `/v1/hours/${member.id}/week` &&
                response.request().method() === "POST" &&
                response.status() === 200,
            { timeout: 60_000 },
        );
        await context.setOffline(false);
        const response = await confirmed;
        const command = response.request().postDataJSON() as HoursCommand;
        expect(command.expected_revision).toBe(0);
        expect(await response.json()).toEqual({ revision: 1, stranded: [] });
        await expect(reopened.getByText(h.savedLocally, { exact: true })).toHaveCount(0, {
            timeout: 60_000,
        });
        const committed = await hoursEvidence(member.id);
        expect(committed.staff.hours_revision).toBe(1);
        expect(committed.receipts).toHaveLength(1);
        await navigate(second, "/setup/team");
        await expect(
            second
                .getByRole("row", { name: h.rowLabel(member.name), exact: true })
                .getByText(h.perWeek(6), { exact: true }),
        ).toBeVisible({ timeout: 60_000 });
        await expectMondayOnly(await openHours(second, member.name));

        await navigate(device, "/today");
        await signOut(device);
        await expect(device).toHaveURL(/\/login/, { timeout: 60_000 });
        await signIn(device);
        await expect(device.getByText(strings.staff.roleOwner, { exact: true })).toBeVisible();
        const filesAfter = await replicaFiles(device);
        // the owner gets a replica file of their own beside the member's cleared one
        expect(filesAfter).toHaveLength(2);
        expect(filesAfter).toEqual(expect.arrayContaining(filesBefore));
        await navigate(device, "/setup/team");
        await expect(
            device
                .getByRole("row", { name: h.rowLabel(member.name), exact: true })
                .getByText(h.perWeek(6), { exact: true }),
        ).toBeVisible({ timeout: 60_000 });
        expect(await hoursEvidence(member.id)).toEqual(committed);

        const removal = await device.request.post(`${bookingApi()}/v1/staff/${member.id}/remove`, {
            headers: { Origin: new URL(device.url()).origin, "Idempotency-Key": randomUUID() },
            data: {},
        });
        expect(removal.status(), await removal.text()).toBe(200);
        removed = true;
        for (let pass = 0; pass < 2; pass++) {
            if (pass === 1) await second.reload();
            await expect(
                second.getByRole("heading", {
                    name: strings.business.onboarding.title,
                    exact: true,
                }),
            ).toBeVisible({ timeout: 60_000 });
            await expect(second.getByText(note, { exact: true })).toHaveCount(0);
            await expect(second.getByText(client.name, { exact: true })).toHaveCount(0);
        }
        const refused = await second.request.patch(`${bookingApi()}/v1/clients/${client.id}`, {
            headers: {
                Origin: new URL(second.url()).origin,
                "Idempotency-Key": randomUUID(),
                "X-Business-Id": committed.staff.business_id,
            },
            data: { name: client.name },
        });
        expect(refused.status(), await refused.text()).toBe(403);
        await testInfo.attach("device-lifecycle", {
            body: JSON.stringify({ command, committed, filesBefore, filesAfter }),
            contentType: "application/json",
        });
    } finally {
        await context.setOffline(false);
        await secondContext.close();
        if (!removed) await member.cleanup();
    }
});
