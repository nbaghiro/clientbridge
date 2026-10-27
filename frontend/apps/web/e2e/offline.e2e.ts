import { strings } from "@clientbridge/app-core/public";
import { type BrowserContext, expect } from "@playwright/test";
import { runEmail, runUrl } from "@clientbridge/config/e2e/run";
import {
    expectMondayOnly,
    hoursEvidence,
    joinHoursStaff,
    openHours,
    selectHoursTime,
    type HoursCommand,
} from "./support/hours";
import { navigate, signIn, test } from "./support/session";

// Firefox's emulated offline leaves the replica's token fetch pending, so it drops requests instead
async function setOffline(context: BrowserContext, browserName: string, offline: boolean) {
    if (browserName !== "firefox") return context.setOffline(offline);
    if (offline) return context.route("**/*", (route) => route.abort("internetdisconnected"));
    return context.unrouteAll();
}

test(
    "the production shell restores its replica offline and locks expired offline access without deleting it",
    { tag: ["@browsers", "@no-webkit"] },
    async ({ page, context, browserName }) => {
        test.skip(!process.env.CI, "Requires the production service worker");
        await page.goto("/");
        await page
            .getByRole("textbox", { name: strings.auth.email, exact: true })
            .fill(runEmail("hannah@birchbark.example"));
        await page.getByLabel(strings.auth.password, { exact: true }).fill("demo1234");
        await page.getByRole("button", { name: strings.auth.signIn, exact: true }).click();
        await expect(page.getByRole("heading", { level: 1 })).toContainText("Hannah", {
            timeout: 60_000,
        });
        await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
        await page.reload();
        await expect(page.getByRole("heading", { level: 1 })).toContainText("Hannah", {
            timeout: 60_000,
        });
        await setOffline(context, browserName, true);
        await page.reload();
        await expect(page.getByRole("heading", { level: 1 })).toContainText("Hannah", {
            timeout: 60_000,
        });
        await page.evaluate(() => {
            localStorage.setItem("cb_verified_at", String(Date.now() - 8 * 86_400_000));
        });
        await page.reload();
        await expect(page.getByText(strings.sync.offlineExpired, { exact: true })).toBeVisible();
        expect(await page.evaluate(() => localStorage.getItem("cb_user"))).not.toBeNull();
        await setOffline(context, browserName, false);
        await page.reload();
        await expect(page.getByRole("heading", { level: 1 })).toContainText("Hannah", {
            timeout: 60_000,
        });
        const cached = await page.evaluate(async () => {
            const keys: string[] = [];
            for (const name of await caches.keys())
                for (const request of await (await caches.open(name)).keys())
                    keys.push(new URL(request.url).pathname);
            return keys;
        });
        expect(cached).toContain("/index.html");
        expect(cached).toContain("/config.js");
        const shell = (path: string) =>
            ["/index.html", "/config.js"].includes(path) || path.startsWith("/assets/");
        expect(cached.every(shell)).toBe(true);
    },
);

test(
    "OFF-E2E-01 working-hours command survives offline reload and reconnects exactly once",
    { tag: ["@browsers", "@no-webkit"] },
    async ({ page, context, request, browser, browserName }, testInfo) => {
        test.skip(!process.env.CI, "Requires the production service worker");
        test.setTimeout(240_000);
        const staff = await joinHoursStaff(page, request);
        const observer = await browser.newContext({
            baseURL: new URL(page.url()).origin,
            viewport: { width: 1440, height: 900 },
        });
        try {
            const owner = await observer.newPage();
            await signIn(owner);
            const baseline = await hoursEvidence(staff.id);
            expect(baseline.staff.hours_revision).toBe(0);
            expect(baseline.hours).toEqual([]);
            expect(baseline.receipts).toEqual([]);
            expect(baseline.audits).toEqual([]);
            await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
            await page.reload();
            await openHours(page, staff.name);
            await setOffline(context, browserName, true);
            const editor = page.getByRole("dialog", {
                name: strings.hours.editHoursFor(staff.name),
                exact: true,
            });
            await selectHoursTime(page, editor, strings.ui.startOf(strings.hours.monday), "10:00");
            await selectHoursTime(page, editor, strings.ui.endOf(strings.hours.monday), "16:00");
            for (const day of [
                strings.hours.tuesday,
                strings.hours.wednesday,
                strings.hours.thursday,
                strings.hours.friday,
            ]) {
                await editor.getByRole("switch", { name: day, exact: true }).uncheck();
            }
            await editor
                .getByRole("button", { name: strings.hours.saveHours, exact: true })
                .click();
            await expect(
                editor.getByText(strings.hours.savedLocally, { exact: true }),
            ).toBeVisible();
            expect(await hoursEvidence(staff.id)).toEqual(baseline);
            await page.reload();
            const restored = await openHours(page, staff.name);
            await expectMondayOnly(restored);
            await expect(
                restored.getByText(strings.hours.savedLocally, { exact: true }),
            ).toBeVisible();
            expect(await hoursEvidence(staff.id)).toEqual(baseline);
            const confirmed = page.waitForResponse(
                (response) =>
                    new URL(response.url()).pathname === `/v1/hours/${staff.id}/week` &&
                    response.request().method() === "POST" &&
                    response.status() === 200,
                { timeout: 60_000 },
            );
            await setOffline(context, browserName, false);
            const response = await confirmed;
            const command = response.request().postDataJSON() as HoursCommand;
            expect(command.expected_revision).toBe(0);
            expect(await response.json()).toEqual({ revision: 1, stranded: [] });
            await expect(
                restored.getByText(strings.hours.savedLocally, { exact: true }),
            ).toHaveCount(0, { timeout: 60_000 });
            await navigate(owner, "/setup/team");
            await expect(
                owner
                    .getByRole("row", { name: strings.hours.rowLabel(staff.name), exact: true })
                    .getByText(strings.hours.perWeek(6), { exact: true }),
            ).toBeVisible({ timeout: 60_000 });
            const independent = await openHours(owner, staff.name);
            await expectMondayOnly(independent);
            const expectedDays = Array.from({ length: 7 }, (_, weekday) => ({
                weekday,
                available: weekday === 0,
                start_time: weekday === 0 ? "10:00:00" : null,
                end_time: weekday === 0 ? "16:00:00" : null,
            }));
            expect(command.days).toEqual(expectedDays);
            const committed = await hoursEvidence(staff.id);
            expect(committed.staff.hours_revision).toBe(1);
            expect(committed.hours).toEqual(expectedDays);
            expect(committed.receipts).toEqual([
                {
                    device_id: command.request.device_id,
                    operation_id: command.request.operation_id,
                    version: 2,
                    result: { revision: 1 },
                },
            ]);
            expect(committed.audits).toEqual([
                {
                    action: "hours.week",
                    performed_by: baseline.staff.user_id,
                    changes: { revision: 1 },
                },
            ]);
            const api = runUrl("VITE_API_URL");
            const replay = await page.request.post(`${api}/v1/hours/${staff.id}/week`, {
                data: command,
                headers: { Origin: new URL(page.url()).origin },
            });
            expect(replay.status(), await replay.text()).toBe(200);
            expect(await replay.json()).toEqual({ revision: 1, stranded: [] });
            expect(await hoursEvidence(staff.id)).toEqual(committed);
            await page.reload();
            const final = await openHours(page, staff.name);
            await expectMondayOnly(final);
            await expect(final.getByText(strings.hours.savedLocally, { exact: true })).toHaveCount(
                0,
            );
            await testInfo.attach("committed-hours-evidence", {
                body: JSON.stringify(committed),
                contentType: "application/json",
            });
        } finally {
            await setOffline(context, browserName, false);
            await observer.close();
            await staff.cleanup();
        }
    },
);

test(
    "XB-E2E-17 a private window keeps the replica in IndexedDB and reopens it after a reload",
    { tag: "@browsers" },
    async ({ browser, baseURL }) => {
        // a plain Playwright context browses privately, where WebKit refuses OPFS
        const privateWindow = await browser.newContext({
            ...(baseURL === undefined ? {} : { baseURL }),
            viewport: { width: 1440, height: 900 },
        });
        try {
            const page = await privateWindow.newPage();
            const replicas = (): Promise<string[]> =>
                page.evaluate(async () =>
                    (await indexedDB.databases())
                        .map((database) => database.name ?? "")
                        .filter((name) => name.startsWith("clientbridge-")),
                );
            await signIn(page);
            await expect(page.getByRole("heading", { level: 1 })).toContainText("Hannah");
            const opened = await replicas();
            expect(opened).toHaveLength(1);
            test.setTimeout(400_000);
            await page.reload();
            await expect(page).toHaveURL(/\/today$/, { timeout: 60_000 });
            const started = Date.now();
            for (let i = 0; i < 60; i++) {
                const heading = await page.getByRole("heading", { level: 1 }).textContent();
                const locks = await page.evaluate(async () => JSON.stringify(await navigator.locks.query()));
                console.log("DBGWAIT", Date.now() - started, heading, locks);
                if (heading?.includes("Hannah")) break;
                await page.waitForTimeout(5000);
            }
            await expect(page.getByRole("heading", { level: 1 })).toContainText("Hannah");
            expect(await replicas()).toEqual(opened);
        } finally {
            await privateWindow.close();
        }
    },
);
