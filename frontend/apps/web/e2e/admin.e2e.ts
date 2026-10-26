import { strings } from "@clientbridge/app-core/public";
import { type Browser, type Page, type Response, expect, test } from "@playwright/test";

import { newAccount } from "./identity";
import { bookingApi } from "./support/bookings";
import { createClient, openClient } from "./support/crm";
import { businessEvidence, openBusiness, signUp } from "./support/onboarding";
import { signIn } from "./support/session";

function required(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is unset: run through make test-functional`);
    return value;
}

const ADMIN = required("VITE_ADMIN_URL");
const AUTH_ADMIN = required("AUTH_ADMIN_URL");
const ad = strings.admin;

function operator(role: "console" | "lapse"): { email: string; password: string } {
    const email = process.env[`E2E_OPERATOR_${role.toUpperCase()}_EMAIL`];
    const password = process.env[`E2E_OPERATOR_${role.toUpperCase()}_PASSWORD`];
    if (!email || !password) throw new Error("the stack grants no platform operator");
    return { email, password };
}

/** Signs in through the web app's admin login, as the console's cross-host redirect sends you. */
async function operatorConsole(browser: Browser, role: "console" | "lapse"): Promise<Page> {
    const { email, password } = operator(role);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(ADMIN);
    await expect(page).toHaveURL(/\/admin-login\?session=1$/, { timeout: 60_000 });
    await page.getByRole("textbox", { name: strings.auth.email, exact: true }).fill(email);
    await page.getByLabel(strings.auth.password, { exact: true }).fill(password);
    await page.getByRole("button", { name: strings.auth.signIn, exact: true }).click();
    await expect(page).toHaveURL(`${ADMIN}/overview`, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: ad.overview, exact: true })).toBeVisible();
    return page;
}

function adminReads(page: Page): Response[] {
    const seen: Response[] = [];
    page.on("response", (response) => {
        const url = new URL(response.url());
        if (url.origin === new URL(bookingApi()).origin && url.pathname.startsWith("/admin/v1/"))
            seen.push(response);
    });
    return seen;
}

async function setEdition(page: Page, businessId: string, subject: string | null) {
    return page.request.post(`${bookingApi()}/admin/v1/businesses/${businessId}/edition`, {
        headers: { Origin: ADMIN },
        data: { subject },
    });
}

test("OPS-E2E-01 only a granted operator reaches the admin ops, and every page stays uncached", async ({
    browser,
    page,
}) => {
    test.setTimeout(240_000);
    const anonymous = await browser.newContext();
    try {
        const visitor = await anonymous.newPage();
        await visitor.goto(`${ADMIN}/businesses`);
        await expect(visitor).toHaveURL(/\/admin-login\?session=1$/, { timeout: 60_000 });
        await expect(
            visitor.getByRole("textbox", { name: strings.auth.email, exact: true }),
        ).toBeVisible();
        const unsigned = await visitor.request.get(`${bookingApi()}/admin/v1/overview`);
        expect(unsigned.status()).toBe(401);
    } finally {
        await anonymous.close();
    }

    await signIn(page);
    const ownerReads = adminReads(page);
    await page.goto(ADMIN);
    await expect(page.getByText(ad.denied, { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(ad.deniedDetail, { exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: ad.navigation })).toHaveCount(0);
    for (const path of ["overview", "businesses", "users", "payments", "access"]) {
        const denied = await page.request.get(`${bookingApi()}/admin/v1/${path}`);
        expect(denied.status(), path).toBe(403);
        expect(await denied.json()).toMatchObject({ error: "platform_access_required" });
    }
    const ownerWrite = await setEdition(page, "bz_birchbark", "vehicle");
    expect(ownerWrite.status()).toBe(403);
    expect(ownerReads.length).toBeGreaterThan(0);
    for (const read of ownerReads)
        expect(`${new URL(read.url()).pathname} ${String(read.status())}`).toBe(
            "/admin/v1/session 403",
        );

    const ops = await operatorConsole(browser, "console");
    try {
        const reads = adminReads(ops);
        const nav = ops.getByRole("navigation", { name: ad.navigation });
        const pages: [string, string][] = [
            [ad.businesses, ad.businessesDetail],
            [ad.people, ad.peopleDetail],
            [ad.payments, ad.paymentsDetail],
            [ad.emails, ad.emailsDetail],
            [ad.activity, ad.activityDetail],
            [ad.operations, ad.operationsDetail],
            [ad.access, ad.accessDetailPage],
            [ad.overview, ad.overviewDetail],
        ];
        for (const [title, detail] of pages) {
            await nav.getByRole("link", { name: title, exact: true }).click();
            await expect(ops.getByRole("heading", { name: title, exact: true })).toBeVisible();
            await expect(ops.getByText(detail, { exact: true })).toBeVisible();
            await expect(ops.getByText(ad.unavailable, { exact: true })).toHaveCount(0);
        }
        await nav.getByRole("link", { name: ad.access, exact: true }).click();
        await expect(ops.getByText(operator("console").email, { exact: true })).toBeVisible();
        await expect(ops.getByText(ad.configuredGrant, { exact: true })).toBeVisible();
        await ops.goto(`${ADMIN}/businesses/bz_birchbark`);
        await expect(ops.getByText("Birchbark Pet Studio", { exact: true })).toBeVisible({
            timeout: 60_000,
        });
        await expect(ops.getByText("bz_birchbark", { exact: true }).first()).toBeVisible();
        const loaded = reads.filter((r) => r.request().method() === "GET");
        expect(loaded.length).toBeGreaterThan(8);
        for (const response of loaded) {
            const path = new URL(response.url()).pathname;
            expect(response.status(), path).toBe(200);
            const headers = response.headers();
            expect(headers["cache-control"], path).toBe("no-store");
            expect(headers["access-control-allow-origin"], path).toBe(ADMIN);
            expect(headers["access-control-allow-credentials"], path).toBe("true");
        }
    } finally {
        await ops.context().close();
    }
});

test("OPS-E2E-02 an operator's edition change reaches the owner's app once and leaves the plan alone", async ({
    browser,
    page,
    request,
}, testInfo) => {
    test.setTimeout(240_000);
    const account = newAccount("edition");
    await signUp(page, request, account);
    const onboarding = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/v1/onboarding" && r.request().method() === "POST",
    );
    await openBusiness(page, `${account.name} Mobile Shine`, "other");
    const businessId = ((await (await onboarding).json()) as { id: string }).id;
    const client = await createClient(page);
    let record = await openClient(page, client);
    await expect(
        record.getByRole("button", { name: strings.subjects.add("vehicle"), exact: true }),
    ).toHaveCount(0);
    const before = await businessEvidence(businessId);
    expect(before.business[0]).toMatchObject({ subject: null, plan_status: "trialing" });
    expect(before.audits.filter((a) => a.action === "business.edition")).toEqual([]);

    const ops = await operatorConsole(browser, "console");
    try {
        await ops.goto(`${ADMIN}/businesses/${businessId}`);
        await expect(ops.getByText(`${account.name} Mobile Shine`, { exact: true })).toBeVisible({
            timeout: 60_000,
        });
        await expect(
            ops.getByText(ad.editionOption("none"), { exact: true }).first(),
        ).toBeVisible();
        const save = ops.getByRole("button", { name: ad.saveEdition, exact: true });
        await expect(save).toBeDisabled();
        await ops.getByRole("combobox", { name: ad.changeEdition }).click();
        await ops
            .getByRole("listbox", { name: ad.changeEdition })
            .getByRole("option", { name: ad.editionOption("vehicle"), exact: true })
            .click();
        const saving = ops.waitForResponse(
            (r) =>
                new URL(r.url()).pathname === `/admin/v1/businesses/${businessId}/edition` &&
                r.request().method() === "POST",
        );
        await save.click();
        const saved = await saving;
        expect(saved.status(), await saved.text()).toBe(200);
        expect(saved.request().postDataJSON()).toEqual({ subject: "vehicle" });
        await expect(ops.getByText(ad.editionSaved, { exact: true })).toBeVisible();
        await expect(save).toBeDisabled();
        const access = (await (
            await ops.request.get(`${bookingApi()}/admin/v1/access`)
        ).json()) as { identity_id: string };

        const changed = await businessEvidence(businessId);
        expect(changed.business[0]).toEqual({ ...before.business[0], subject: "vehicle" });
        const editions = changed.audits.filter((a) => a.action === "business.edition");
        expect(editions).toEqual([
            {
                action: "business.edition",
                entity_type: "business",
                entity_id: businessId,
                changes: { old: null, new: "vehicle", identity_id: access.identity_id },
            },
        ]);
        const repeated = await setEdition(ops, businessId, "vehicle");
        expect(repeated.status(), await repeated.text()).toBe(200);
        expect(await businessEvidence(businessId)).toEqual(changed);

        await ops.reload();
        await expect(
            ops.getByText(ad.editionOption("vehicle"), { exact: true }).first(),
        ).toBeVisible({ timeout: 60_000 });
        await expect(ops.getByRole("button", { name: ad.saveEdition })).toBeDisabled();

        await page.reload();
        record = await openClient(page, client);
        await expect(
            record.getByRole("button", { name: strings.subjects.add("vehicle"), exact: true }),
        ).toBeVisible({ timeout: 60_000 });
        expect(await businessEvidence(businessId)).toEqual(changed);
        await testInfo.attach("edition-change", {
            body: JSON.stringify(changed),
            contentType: "application/json",
        });
    } finally {
        await ops.context().close();
    }
});

test("OPS-E2E-03 an operator whose email stops being verified loses the console on the next check", async ({
    browser,
}) => {
    test.setTimeout(180_000);
    const ops = await operatorConsole(browser, "lapse");
    try {
        const nav = ops.getByRole("navigation", { name: ad.navigation });
        await ops.goto(`${ADMIN}/businesses/bz_birchbark`);
        await expect(ops.getByText("Birchbark Pet Studio").first()).toBeVisible({
            timeout: 60_000,
        });
        const access = (await (
            await ops.request.get(`${bookingApi()}/admin/v1/access`)
        ).json()) as { identity_id: string };
        const before = await businessEvidence("bz_birchbark");
        const lapse = async (verified: boolean): Promise<void> => {
            const patched = await ops.request.patch(
                `${AUTH_ADMIN}/admin/identities/${access.identity_id}`,
                {
                    data: [
                        {
                            op: "replace",
                            path: "/verifiable_addresses/0/verified",
                            value: verified,
                        },
                    ],
                },
            );
            expect(patched.status(), await patched.text()).toBe(200);
        };
        await lapse(false);
        const read = await ops.request.get(`${bookingApi()}/admin/v1/businesses`);
        expect(read.status()).toBe(403);
        expect(await read.json()).toMatchObject({ error: "platform_access_required" });
        const write = await setEdition(ops, "bz_birchbark", "vehicle");
        expect(write.status()).toBe(403);
        expect(await businessEvidence("bz_birchbark")).toEqual(before);
        await expect(ops.getByText("Birchbark Pet Studio").first()).toBeVisible();

        await ops.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(ops.getByText(ad.denied, { exact: true })).toBeVisible({ timeout: 15_000 });
        await expect(nav).toHaveCount(0);
        await expect(ops.getByText("Birchbark Pet Studio")).toHaveCount(0);
        await ops.reload();
        await expect(ops.getByText(ad.denied, { exact: true })).toBeVisible({ timeout: 60_000 });
        await expect(ops.getByText("Birchbark Pet Studio")).toHaveCount(0);

        await lapse(true);
        await ops.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(ops.getByText("Birchbark Pet Studio").first()).toBeVisible({
            timeout: 60_000,
        });
        expect(await businessEvidence("bz_birchbark")).toEqual(before);
    } finally {
        await ops.context().close();
    }
});
