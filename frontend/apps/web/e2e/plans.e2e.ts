import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { addDays, combineDayAndTime, strings } from "@clientbridge/app-core/public";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { freshPhone, newAccount } from "./support/auth";
import { requireLocalMail } from "./support/evidence";
import { openBusiness, signUp } from "./support/business";
import {
    apiBase,
    broadcastEvidence,
    cancelScheduledBroadcast,
    createContact,
    headers,
    planEvidence,
} from "./support/messaging";
import { clientTags, openClient } from "./support/clients";
import { lapsedNotice } from "./support/plans";
import { navigate, signIn } from "./support/session";
import { demoId, runEmail } from "@clientbridge/config/e2e/run";

const execute = promisify(execFile);
const p = strings.plans;
const t = strings.staff.team;
const ZONE = "America/Vancouver";
const SEAT_CAP = 50;

async function member(browser: Browser, origin: string, email: string) {
    const context = await browser.newContext({ baseURL: origin });
    const page = await context.newPage();
    await signIn(page, { email, password: "demo1234" });
    return { context, page };
}

async function freshTrial(page: Page) {
    requireLocalMail();
    const account = newAccount("plans");
    await signUp(page, page.request, account);
    const onboarding = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/v1/onboarding" && r.request().method() === "POST",
    );
    await openBusiness(page, `${account.name}'s Beauty Studio`);
    const created = await onboarding;
    expect(created.status(), await created.text()).toBe(201);
    const business = (await created.json()) as { id: string };
    return { account, businessId: business.id };
}

const invite = (page: Page, email: string) =>
    page.request.post(`${apiBase()}/v1/staff/invites`, {
        data: { email, role: "staff" },
        headers: headers(page),
    });

test("PLN-E2E-01 only the owner reads or changes the plan, in their own business", async ({
    page,
    browser,
}) => {
    await signIn(page);
    const origin = new URL(page.url()).origin;
    const birchbark = await planEvidence(demoId("bz_birchbark"));
    const cedarBefore = await planEvidence(demoId("bz_demo_second"));
    expect(birchbark.business).toMatchObject({ plan: "team", plan_status: "active" });
    expect(cedarBefore.business).toMatchObject({ plan_status: "trialing" });
    const own = await page.request.get(`${apiBase()}/v1/plan`);
    expect(own.status(), await own.text()).toBe(200);
    expect(await own.json()).toMatchObject({ access: "active", plan: "team", seat_cap: SEAT_CAP });
    await navigate(page, "/setup/security");
    await expect(page.getByRole("heading", { name: p.activeTitle(p.team) })).toBeVisible({
        timeout: 60_000,
    });
    const foreign = await page.request.get(`${apiBase()}/v1/plan`, {
        headers: { "X-Business-Id": demoId("bz_demo_second") },
    });
    expect(foreign.status()).toBe(403);
    const foreignCheckout = await page.request.post(`${apiBase()}/v1/plan/checkout`, {
        data: { plan: "team", interval: "month" },
        headers: { ...headers(page), "X-Business-Id": demoId("bz_demo_second") },
    });
    expect(foreignCheckout.status()).toBe(403);
    const active = await page.request.post(`${apiBase()}/v1/plan/checkout`, {
        data: { plan: "premium", interval: "month" },
        headers: headers(page),
    });
    expect(active.status()).toBe(409);
    expect(await active.json()).toMatchObject({ error: "plan_active" });

    for (const email of [
        runEmail("admin@birchbark.example"),
        runEmail("diego@birchbark.example"),
    ]) {
        const other = await member(browser, origin, email);
        try {
            const calls = [
                await other.page.request.get(`${apiBase()}/v1/plan`),
                await other.page.request.post(`${apiBase()}/v1/plan/checkout`, {
                    data: { plan: "team", interval: "month" },
                    headers: headers(other.page),
                }),
                await other.page.request.post(`${apiBase()}/v1/plan/change`, {
                    data: { plan: "premium", interval: "year" },
                    headers: headers(other.page),
                }),
                await other.page.request.post(`${apiBase()}/v1/plan/portal`, {
                    headers: headers(other.page),
                }),
            ];
            expect(calls.map((r) => r.status())).toEqual([403, 403, 403, 403]);
            await navigate(other.page, "/setup/security");
            await expect(
                other.page.getByRole("heading", { name: p.activeTitle(p.team) }),
            ).toHaveCount(0);
        } finally {
            await other.context.close();
        }
    }

    const cedarOwner = await member(browser, origin, runEmail("owner@cedarcoast.example"));
    try {
        const trial = await cedarOwner.page.request.get(`${apiBase()}/v1/plan`);
        expect(trial.status(), await trial.text()).toBe(200);
        expect(await trial.json()).toMatchObject({ access: "trial", managed: false });
        const unconfigured = await cedarOwner.page.request.post(`${apiBase()}/v1/plan/checkout`, {
            data: { plan: "team", interval: "month" },
            headers: headers(cedarOwner.page),
        });
        expect(unconfigured.status()).toBe(503);
        expect(await unconfigured.json()).toMatchObject({ error: "payments_not_configured" });
        const unmanaged = await cedarOwner.page.request.post(`${apiBase()}/v1/plan/portal`, {
            headers: headers(cedarOwner.page),
        });
        expect(unmanaged.status()).toBe(409);
        expect(await unmanaged.json()).toMatchObject({ error: "plan_not_managed" });
    } finally {
        await cedarOwner.context.close();
    }
    // other cases add staff to these shared businesses, so only the plan itself must be unchanged
    expect((await planEvidence(demoId("bz_birchbark"))).business).toEqual(birchbark.business);
    expect((await planEvidence(demoId("bz_demo_second"))).business).toEqual(cedarBefore.business);
});

test("PLN-E2E-02 a trial fills its last seat once, refuses the next invite and frees a seat on revoke", async ({
    page,
}) => {
    test.setTimeout(300_000);
    const { businessId } = await freshTrial(page);
    const run = randomUUID().slice(0, 8);
    const address = (n: number) => runEmail(`team-${run}-${String(n)}@example.ca`);
    for (let n = 1; n < SEAT_CAP; n++) {
        const response = await invite(page, address(n));
        expect(response.status(), await response.text()).toBe(201);
    }
    const refused = address(0).replace("@example.ca", "@mailbox.invalid");
    const unsent = await invite(page, refused);
    expect(unsent.status()).toBeGreaterThanOrEqual(500);
    const filled = await planEvidence(businessId);
    expect(filled.staff.filter((s) => s.role !== "owner")).toHaveLength(SEAT_CAP - 1);
    expect(filled.staff.map((s) => s.email)).not.toContain(refused);

    const raced = await Promise.all([invite(page, address(50)), invite(page, address(51))]);
    expect(raced.map((r) => r.status()).sort()).toEqual([201, 409]);
    const loser = raced.find((r) => r.status() === 409);
    expect(await loser?.json()).toMatchObject({ error: "seat_limit" });
    const full = await planEvidence(businessId);
    const invited = full.staff.filter((s) => s.role !== "owner");
    expect(invited).toHaveLength(SEAT_CAP);
    expect(invited.every((s) => s.status === "invited" && s.invited)).toBe(true);
    const plan = await page.request.get(`${apiBase()}/v1/plan`);
    expect(await plan.json()).toMatchObject({
        access: "trial",
        seats: SEAT_CAP,
        seat_cap: SEAT_CAP,
    });

    await navigate(page, "/setup/team");
    await page.getByRole("button", { name: t.inviteMember, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: t.emails }).fill(address(52));
    await dialog.getByRole("button", { name: t.send, exact: true }).click();
    await expect(dialog.getByText(strings.api.seatLimit, { exact: true })).toBeVisible();
    expect(await planEvidence(businessId)).toEqual(full);
    await dialog.getByRole("button", { name: strings.common.cancel, exact: true }).click();

    const first = page.getByText(address(1), { exact: true });
    const row = page
        .locator("div")
        .filter({ has: first })
        .filter({
            has: page.getByRole("button", { name: t.revoke, exact: true }),
        });
    await row.last().getByRole("button", { name: t.revoke, exact: true }).click();
    const revoked = page.waitForResponse((r) =>
        /\/v1\/staff\/invites\/[^/]+\/revoke$/.test(new URL(r.url()).pathname),
    );
    await page
        .getByRole("alertdialog")
        .or(page.getByRole("dialog"))
        .getByRole("button", { name: t.revoke, exact: true })
        .click();
    expect((await revoked).status()).toBe(204);
    await expect(page.getByText(address(1), { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: t.inviteMember, exact: true }).click();
    await dialog.getByRole("textbox", { name: t.emails }).fill(address(52));
    await dialog.getByRole("button", { name: t.send, exact: true }).click();
    await expect(dialog.getByRole("heading", { name: t.sentTitle(1) })).toBeVisible();
    const final = await planEvidence(businessId);
    const seats = final.staff.filter((s) => s.role !== "owner").map((s) => s.email);
    expect(seats).toHaveLength(SEAT_CAP);
    expect(seats).toContain(address(52));
    expect(seats).not.toContain(address(1));
    expect(final.audits).toEqual([]);
});

test("PLN-E2E-03 a lapsed trial blocks new work but still exports, settles, revokes and cancels its broadcast", async ({
    page,
}) => {
    const { account, businessId } = await freshTrial(page);
    const address = await page.request.patch(`${apiBase()}/v1/business`, {
        data: {
            street_number: "1450",
            street_name: "Fort Street",
            city: "Victoria",
            province: "BC",
            postal_code: "V8S 1Z1",
            legal_phone: "(250) 555-0142",
        },
        headers: headers(page),
    });
    expect(address.status(), await address.text()).toBe(200);
    const contact = await createContact(page, { consent: true, tags: ["regulars"] });
    const pending = await invite(page, runEmail(`front-desk-${randomUUID()}@example.ca`));
    expect(pending.status(), await pending.text()).toBe(201);
    const inviteId = ((await pending.json()) as { id: string }).id;
    const scheduled = await page.request.post(`${apiBase()}/v1/broadcasts`, {
        data: {
            name: "Spring hours",
            body: "We're open late on Thursdays this spring.",
            audience: { tags: ["regulars"] },
            scheduled_at: combineDayAndTime(
                addDays(new Date(), 2, ZONE),
                "10:00",
                ZONE,
            ).toISOString(),
        },
        headers: headers(page),
    });
    expect(scheduled.status(), await scheduled.text()).toBe(200);
    const broadcast = (await scheduled.json()) as { id: string };

    const { stdout } = await execute(
        "uv",
        ["run", "python", "-m", "e2e.actions", "trial-clock", businessId, account.email],
        { cwd: fileURLToPath(new URL("../../../../backend", import.meta.url)), timeout: 30_000 },
    );
    expect(JSON.parse(stdout)).toEqual({ id: businessId, plan_status: "trialing", lapsed: true });
    const lapsed = await planEvidence(businessId);

    await page.reload();
    await expect(lapsedNotice(page)).toBeVisible({ timeout: 60_000 });
    await expect(
        lapsedNotice(page).getByRole("button", { name: p.noticeChoose, exact: true }),
    ).toBeVisible();
    const status = await page.request.get(`${apiBase()}/v1/plan`);
    expect(await status.json()).toMatchObject({ access: "lapsed", seats: 1 });

    const blocked = [
        await page.request.post(`${apiBase()}/v1/clients`, {
            data: { name: "Noor Haddad", phone: freshPhone() },
            headers: headers(page),
        }),
        await page.request.patch(`${apiBase()}/v1/clients/${contact.id}`, {
            data: { tags: ["regulars", "vip"] },
            headers: headers(page),
        }),
        await page.request.post(`${apiBase()}/v1/broadcasts`, {
            data: { name: "Late offer", body: "Ten percent off", audience: {} },
            headers: headers(page),
        }),
        await invite(page, runEmail(`another-${randomUUID()}@example.ca`)),
    ];
    for (const response of blocked) {
        expect(response.status()).toBe(402);
        expect(await response.json()).toMatchObject({ error: "plan_required" });
    }
    const readable = await page.request.get(`${apiBase()}/v1/plan`);
    expect(readable.status()).toBe(200);

    const settings = await page.request.patch(`${apiBase()}/v1/business`, {
        data: { billing_email: runEmail(`billing-${randomUUID()}@example.ca`) },
        headers: headers(page),
    });
    const exported = await page.request.post(`${apiBase()}/v1/consents/export`, {
        headers: headers(page),
    });
    const revoked = await page.request.post(`${apiBase()}/v1/staff/invites/${inviteId}/revoke`, {
        headers: headers(page),
    });
    const checkout = await page.request.post(`${apiBase()}/v1/plan/checkout`, {
        data: { plan: "team", interval: "month" },
        headers: headers(page),
    });
    expect([settings, exported, revoked].map((r) => r.status())).toEqual([200, 200, 204]);
    expect(checkout.status()).toBe(503);
    expect(await checkout.json()).toMatchObject({ error: "payments_not_configured" });

    await navigate(page, "/today");
    await navigate(page, "/inbox?segment=broadcasts");
    const canceled = await cancelScheduledBroadcast(page, "Spring hours");
    expect(canceled.status(), await canceled.text()).toBe(200);
    const after = await broadcastEvidence(broadcast.id);
    expect(after.broadcasts.map((b) => b.status)).toEqual(["canceled"]);
    expect(after.messages).toEqual([]);
    const final = await planEvidence(businessId);
    expect(final.business).toEqual(lapsed.business);
    expect(final.staff.map((s) => s.role)).toEqual(["owner"]);
    expect(final.audits).toEqual([]);
    // clients are read from the replica, so a lapsed business still opens the record
    await openClient(page, contact);
    expect(await clientTags(contact.id)).toEqual(["regulars"]);
});
