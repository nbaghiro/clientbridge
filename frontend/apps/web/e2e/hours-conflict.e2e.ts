import { formatClock, strings } from "@clientbridge/app-core/public";
import { expect, test, type Locator, type Page, type Response } from "@playwright/test";
import {
    hoursEvidence,
    joinHoursStaff,
    openHours,
    selectHoursTime,
    type HoursCommand,
} from "./support/offline";
import { signIn } from "./support/session";

const s = strings.hours;
const week = (monday: boolean, tuesday: boolean) =>
    Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        available: weekday < 5,
        start_time:
            weekday > 4
                ? null
                : weekday === 0 && monday
                  ? "10:00:00"
                  : weekday === 1 && tuesday
                    ? "11:00:00"
                    : "09:00:00",
        end_time:
            weekday > 4
                ? null
                : weekday === 0 && monday
                  ? "16:00:00"
                  : weekday === 1 && tuesday
                    ? "15:00:00"
                    : "17:00:00",
    }));
async function mergedUi(editor: Locator): Promise<void> {
    for (const [day, start, end] of [
        [s.monday, "10:00", "16:00"],
        [s.tuesday, "11:00", "15:00"],
        [s.wednesday, "09:00", "17:00"],
        [s.thursday, "09:00", "17:00"],
        [s.friday, "09:00", "17:00"],
    ] as const) {
        await expect(editor.getByRole("switch", { name: day, exact: true })).toBeChecked();
        await expect(
            editor.getByRole("combobox", { name: strings.ui.startOf(day), exact: true }),
        ).toContainText(formatClock(start));
        await expect(
            editor.getByRole("combobox", { name: strings.ui.endOf(day), exact: true }),
        ).toContainText(formatClock(end));
    }
    for (const day of [s.saturday, s.sunday])
        await expect(editor.getByRole("switch", { name: day, exact: true })).not.toBeChecked();
}

test("SYN-E2E-08 two genuine week editors conflict once and explicitly repair without losing either edit", async ({
    page,
    request,
    browser,
}, info) => {
    test.setTimeout(240_000);
    const staff = await joinHoursStaff(page, request);
    const secondContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
    let release: (forward: boolean) => void = () => {
        throw new Error("barrier not initialized");
    };
    const barrier = new Promise<boolean>((resolve) => {
        release = resolve;
    });
    const held: HoursCommand[] = [];
    const path = `/v1/hours/${staff.id}/week`;
    const intercepted: Page[] = [];
    let outcomes: Promise<Response>[] = [];
    try {
        const second = await secondContext.newPage();
        await signIn(second, staff.account);
        const baseline = await hoursEvidence(staff.id);
        expect(baseline.staff.hours_revision).toBe(0);
        expect(baseline.hours).toEqual([]);
        expect(baseline.receipts).toEqual([]);
        expect(baseline.audits).toEqual([]);
        const pages = [page, second];
        const editors = await Promise.all(pages.map((p) => openHours(p, staff.name)));
        const firstEditor = editors[0],
            secondEditor = editors[1];
        if (!firstEditor || !secondEditor) throw new Error("two real editors are required");
        await selectHoursTime(page, firstEditor, strings.ui.startOf(s.monday), "10:00");
        await selectHoursTime(page, firstEditor, strings.ui.endOf(s.monday), "16:00");
        await selectHoursTime(second, secondEditor, strings.ui.startOf(s.tuesday), "11:00");
        await selectHoursTime(second, secondEditor, strings.ui.endOf(s.tuesday), "15:00");
        for (const p of pages) {
            await p.route(`**${path}`, async (route) => {
                if (route.request().method() !== "POST") return route.continue();
                held.push(route.request().postDataJSON() as HoursCommand);
                if (await barrier) await route.continue();
                else await route.abort();
            });
            intercepted.push(p);
        }
        outcomes = pages.map((p) =>
            p.waitForResponse(
                (r) => new URL(r.url()).pathname === path && r.request().method() === "POST",
                { timeout: 60_000 },
            ),
        );
        await Promise.all(
            editors.map((editor) =>
                editor.getByRole("button", { name: s.saveHours, exact: true }).click(),
            ),
        );
        await expect.poll(() => held.length).toBe(2);
        expect(held.map((command) => command.expected_revision)).toEqual([0, 0]);
        expect(new Set(held.map((command) => command.request.device_id)).size).toBe(2);
        expect(new Set(held.map((command) => command.request.operation_id)).size).toBe(2);
        release(true);
        const responses = await Promise.all(outcomes);
        expect(responses.map((r) => r.status()).sort()).toEqual([200, 409]);
        const win = responses.findIndex((r) => r.status() === 200),
            lose = responses.findIndex((r) => r.status() === 409);
        const winningResponse = responses[win],
            losingResponse = responses[lose],
            loser = pages[lose],
            loserEditor = editors[lose];
        if (!winningResponse || !losingResponse || !loser || !loserEditor)
            throw new Error("race must have a winner and loser");
        expect(await winningResponse.json()).toEqual({ revision: 1, stranded: [] });
        expect(await losingResponse.json()).toMatchObject({ error: "hours_revision_conflict" });
        const winner = winningResponse.request().postDataJSON() as HoursCommand;
        const rejected = losingResponse.request().postDataJSON() as HoursCommand;
        expect(winner.days).toEqual(week(win === 0, win === 1));
        const accepted = await hoursEvidence(staff.id);
        expect(accepted.staff.hours_revision).toBe(1);
        expect(accepted.hours).toEqual(winner.days);
        expect(accepted.receipts).toEqual([
            {
                device_id: winner.request.device_id,
                operation_id: winner.request.operation_id,
                version: 2,
                result: { revision: 1 },
            },
        ]);
        expect(accepted.audits).toEqual([
            {
                action: "hours.week",
                performed_by: baseline.staff.user_id,
                changes: { revision: 1 },
            },
        ]);
        await expect(loserEditor.getByText(s.conflict, { exact: true })).toBeVisible({
            timeout: 60_000,
        });
        await mergedUi(loserEditor);
        expect(await hoursEvidence(staff.id)).toEqual(accepted);
        const repair = loser.waitForResponse(
            (r) => new URL(r.url()).pathname === path && r.request().method() === "POST",
            { timeout: 60_000 },
        );
        await loserEditor.getByRole("button", { name: s.applyChanges, exact: true }).click();
        const repaired = await repair;
        expect(repaired.status(), await repaired.text()).toBe(200);
        expect(await repaired.json()).toEqual({ revision: 2, stranded: [] });
        const command = repaired.request().postDataJSON() as HoursCommand;
        expect(command.expected_revision).toBe(1);
        expect(command.request.operation_id).not.toBe(rejected.request.operation_id);
        expect(command.days).toEqual(week(true, true));
        const final = await hoursEvidence(staff.id);
        expect(final.staff.hours_revision).toBe(2);
        expect(final.hours).toEqual(week(true, true));
        expect(final.receipts).toHaveLength(2);
        expect(final.receipts).toEqual(
            expect.arrayContaining([
                accepted.receipts[0],
                {
                    device_id: command.request.device_id,
                    operation_id: command.request.operation_id,
                    version: 2,
                    result: { revision: 2 },
                },
            ]),
        );
        expect(final.audits).toEqual([
            {
                action: "hours.week",
                performed_by: baseline.staff.user_id,
                changes: { revision: 1 },
            },
            {
                action: "hours.week",
                performed_by: baseline.staff.user_id,
                changes: { revision: 2 },
            },
        ]);
        for (const p of pages) {
            await p.reload();
            const editor = await openHours(p, staff.name);
            await mergedUi(editor);
            await expect(editor.getByText(s.conflict, { exact: true })).toHaveCount(0);
            await expect(editor.getByText(s.savedLocally, { exact: true })).toHaveCount(0);
        }
        expect(await hoursEvidence(staff.id)).toEqual(final);
        await info.attach("two-editor-repair", {
            body: JSON.stringify({ baseline, winner, rejected, accepted, repair: command, final }),
            contentType: "application/json",
        });
    } finally {
        release(false);
        for (const p of intercepted) await p.unrouteAll({ behavior: "wait" });
        await secondContext.close();
        await Promise.allSettled(outcomes);
        await staff.cleanup();
    }
});
