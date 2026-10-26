import { strings } from "@clientbridge/app-core/public";
import { expect, test, type Page } from "@playwright/test";
import {
    addClassClient,
    classFixture,
    classManageUrl,
    cleanupClass,
    expectClassState,
    type ClassFixture,
} from "./support/classes";
import { clientCommand, editClient } from "./support/crm";
import {
    BIRCHBARK_SMS,
    apiBase,
    awayFromDeliveryTick,
    clientOutreach,
    createContact,
    deliveryRows,
    freshPhone,
    headers,
    mailpitBase,
    postInboundSms,
    prefsLink,
    type Contact,
} from "./support/outreach";
import { navigate, signIn } from "./support/session";
import { demoId } from "@clientbridge/config/e2e/run";

const s = strings.messaging;
const p = strings.publicPreferences;

async function openThread(page: Page, contact: { name: string }) {
    await navigate(page, "/today");
    await navigate(page, "/inbox");
    await page.getByRole("searchbox").fill(contact.name);
    await page
        .getByRole("navigation", { name: s.title, exact: true })
        .getByRole("button")
        .filter({ has: page.getByText(contact.name, { exact: true }) })
        .click({ timeout: 60_000 });
    return page.locator('[aria-live="polite"]');
}

async function cancelOnManagePage(page: Page, fixture: ClassFixture) {
    const context = await page.context().browser()?.newContext();
    if (!context) throw new Error("No browser for the customer");
    try {
        const customer = await context.newPage();
        const manageUrl = await classManageUrl(fixture);
        const token = new URL(manageUrl).pathname.split("/").at(-1) ?? "";
        await customer.goto(manageUrl);
        await expect(customer.getByText(fixture.itemName, { exact: true })).toBeVisible();
        await customer
            .getByRole("button", { name: strings.publicManage.cancel, exact: true })
            .click();
        const canceled = customer.waitForResponse(
            (r) =>
                new URL(r.url()).pathname === `/manage/${token}/cancel` &&
                r.request().method() === "POST",
        );
        await customer
            .getByRole("button", { name: strings.publicManage.cancelConfirm, exact: true })
            .click();
        const response = await canceled;
        expect(response.status(), await response.text()).toBe(200);
        await expect(
            customer.getByRole("heading", { name: strings.publicManage.canceledTitle }),
        ).toBeVisible();
    } finally {
        await context.close();
    }
}

test("MSG-E2E-14 a STOP that arrives after a seat notice is queued keeps the worker from texting it", async ({
    page,
}, testInfo) => {
    test.setTimeout(300_000);
    await signIn(page);
    const fixture = await classFixture(page);
    try {
        const phone = freshPhone();
        const patched = await page.request.patch(`${apiBase()}/v1/clients/${fixture.waiting.id}`, {
            data: { phone },
            headers: headers(page),
        });
        expect(patched.status(), await patched.text()).toBe(200);
        const first = { client: fixture.first, id: fixture.bookingId, status: "confirmed" };
        const secondId = await addClassClient(page, fixture, fixture.second, "confirmed");
        const second = { client: fixture.second, id: secondId, status: "confirmed" };
        const waitingId = await addClassClient(page, fixture, fixture.waiting, "waitlisted");
        const waiting = { client: fixture.waiting, id: waitingId, status: "waitlisted" };
        await expectClassState(fixture, [first, second, waiting]);
        const scope = `seat:${fixture.slotId}:${waitingId}:`;
        expect(await deliveryRows(scope)).toEqual([]);
        expect(await clientOutreach(fixture.waiting.id)).toEqual({
            threads: [],
            messages: [],
            consents: [],
        });

        await awayFromDeliveryTick();
        await cancelOnManagePage(page, fixture);
        const stop = await postInboundSms(page.request, {
            from: phone,
            to: BIRCHBARK_SMS,
            body: "STOP",
        });
        expect(stop.response.status()).toBe(200);
        const queued = await deliveryRows(scope);
        expect(queued.map((d) => [d.channel, d.state, d.error, d.recipient])).toEqual([
            ["email", "queued", null, fixture.waiting.email],
            ["sms", "queued", null, phone],
        ]);
        expect(queued[1]?.from_number).toBe(BIRCHBARK_SMS);
        await expectClassState(fixture, [
            { ...first, status: "canceled" },
            second,
            { ...waiting, status: "confirmed" },
        ]);
        const stopped = await clientOutreach(fixture.waiting.id);
        expect(stopped.consents).toEqual([
            {
                business_id: demoId("bz_birchbark"),
                client_id: fixture.waiting.id,
                channel: "sms",
                status: "withdrawn",
                source: "reply",
                recorded_by: null,
            },
        ]);
        expect(stopped.messages.map((m) => [m.direction, m.channel, m.body])).toEqual([
            ["in", "sms", "STOP"],
        ]);

        await expect
            .poll(async () => (await deliveryRows(scope)).map((d) => [d.state, d.error]), {
                timeout: 100_000,
                intervals: [2_000],
            })
            .toEqual([
                ["accepted", null],
                ["failed", "consent_withdrawn"],
            ]);
        const [email, text] = await deliveryRows(scope);
        if (!email || !text) throw new Error("The seat notices disappeared");
        const search = await page.request.get(`${mailpitBase()}/api/v1/search`, {
            params: { query: `to:${fixture.waiting.email}`, limit: 100 },
        });
        const mail = (
            (await search.json()) as { messages: { Subject: string; Created: string }[] }
        ).messages.filter((m) => m.Subject === email.subject);
        expect(mail).toHaveLength(1);
        const arrived = new Date(mail[0]?.Created ?? "");
        expect(arrived.getTime()).toBeGreaterThan(new Date(email.created_at).getTime() - 1_000);
        expect(arrived.getUTCSeconds()).toBeGreaterThanOrEqual(15);
        expect(arrived.getUTCSeconds()).toBeLessThan(25);
        expect(await clientOutreach(fixture.waiting.id)).toEqual(stopped);

        const log = await openThread(page, fixture.waiting);
        await expect(log.getByText("STOP", { exact: true })).toHaveCount(1);
        await expect(
            page.getByText(s.textsOffTitle(fixture.waiting.name.split(" ")[0] ?? ""), {
                exact: true,
            }),
        ).toBeVisible({ timeout: 60_000 });
        await testInfo.attach("stop-after-queue", {
            body: JSON.stringify({ queued, settled: [email, text], mail }),
            contentType: "application/json",
        });
    } finally {
        await cleanupClass(page, fixture);
    }
});

async function prefsPage(page: Page, contact: Contact) {
    const context = await page.context().browser()?.newContext();
    if (!context) throw new Error("No browser for the client");
    const client = await context.newPage();
    await client.goto(await prefsLink(contact.id));
    await expect(client.getByRole("heading", { name: p.title, exact: true })).toBeVisible();
    const hint = `•••${contact.phone.slice(-4)}`;
    return { context, client, sms: client.getByRole("switch", { name: p.byTextTo(hint) }) };
}

test("MSG-E2E-15 a STOP holds against the staff toggle and the preferences page until the client replies START", async ({
    page,
}) => {
    test.setTimeout(300_000);
    await signIn(page);
    const contact = await createContact(page);
    const consents = (rows: { channel: string; status: string; source: string }[]) =>
        rows.map((c) => [c.channel, c.status, c.source]);
    const stop = await postInboundSms(page.request, {
        from: contact.phone,
        to: BIRCHBARK_SMS,
        body: "arrêt",
    });
    expect(stop.response.status()).toBe(200);
    expect(consents((await clientOutreach(contact.id)).consents)).toEqual([
        ["sms", "withdrawn", "reply"],
    ]);

    const editor = await editClient(page, contact);
    const toggle = editor.getByRole("switch", { name: strings.clients.edit.consentLabel });
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    const saving = clientCommand(page, `/${contact.id}`, "PATCH");
    await editor.getByRole("button", { name: strings.clients.edit.save, exact: true }).click();
    expect((await saving).status()).toBe(200);
    expect(consents((await clientOutreach(contact.id)).consents)).toEqual([
        ["sms", "withdrawn", "reply"],
        ["email", "granted", "in_person"],
    ]);

    const prefs = await prefsPage(page, contact);
    try {
        await expect(prefs.sms).not.toBeChecked();
        await prefs.sms.check();
        const saved = prefs.client.waitForResponse(
            (r) =>
                new URL(r.url()).pathname.startsWith("/prefs/") && r.request().method() === "POST",
        );
        await prefs.client.getByRole("button", { name: p.save, exact: true }).click();
        const response = await saved;
        expect(response.status()).toBe(200);
        expect(await response.json()).toMatchObject({ email: true, sms: false });
        await prefs.client.reload();
        await expect(prefs.sms).not.toBeChecked();
        expect(consents((await clientOutreach(contact.id)).consents)).toEqual([
            ["sms", "withdrawn", "reply"],
            ["email", "granted", "in_person"],
        ]);

        await navigate(page, "/inbox");
        await page.getByRole("button", { name: s.newShort, exact: true }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("combobox", { name: s.clientLabel, exact: true }).fill(contact.name);
        await page
            .locator(`[role="option"][data-value="${contact.id}"]`)
            .click({ timeout: 60_000 });
        await dialog
            .getByRole("group", { name: s.channelLabel, exact: true })
            .getByRole("button", { name: s.channels.sms, exact: true })
            .click();
        await expect(dialog.getByText(s.smsBlockedNew, { exact: true })).toBeVisible();
        await expect(
            dialog.getByRole("button", { name: s.sendMessage, exact: true }),
        ).toBeDisabled();
        const blocked = await page.request.post(`${apiBase()}/v1/messages`, {
            data: { client_id: contact.id, channel: "sms", body: "Are you free Friday?" },
            headers: headers(page),
        });
        expect(blocked.status()).toBe(409);
        expect(
            (await clientOutreach(contact.id)).messages.map((m) => [m.direction, m.body]),
        ).toEqual([["in", "arrêt"]]);
        await dialog.getByRole("button", { name: s.cancel, exact: true }).click();

        const start = await postInboundSms(page.request, {
            from: contact.phone,
            to: BIRCHBARK_SMS,
            body: "START",
        });
        expect(start.response.status()).toBe(200);
        expect(consents((await clientOutreach(contact.id)).consents)).toEqual([
            ["sms", "withdrawn", "reply"],
            ["email", "granted", "in_person"],
            ["sms", "granted", "reply"],
        ]);
        await prefs.client.reload();
        await expect(prefs.sms).toBeChecked();

        const log = await openThread(page, contact);
        await expect(log.getByText("START", { exact: true })).toHaveCount(1);
        await expect(
            page.getByText(s.textsOffTitle(contact.name.split(" ")[0] ?? ""), { exact: true }),
        ).toHaveCount(0, { timeout: 60_000 });
        const reply = page.getByRole("textbox", { name: s.replyPlaceholder("sms"), exact: true });
        await reply.fill("Thanks for coming back. Friday at 10 works.");
        const sent = page.waitForResponse(
            (r) => new URL(r.url()).pathname === "/v1/messages" && r.request().method() === "POST",
        );
        await page.getByRole("button", { name: s.send, exact: true }).click();
        const delivered = await sent;
        expect(delivered.status()).toBe(200);
        expect(await delivered.json()).toMatchObject({ channel: "sms", status: "sent" });
        expect(
            (await clientOutreach(contact.id)).messages.map((m) => [m.direction, m.body, m.status]),
        ).toEqual([
            ["in", "arrêt", "read"],
            ["in", "START", "read"],
            ["out", "Thanks for coming back. Friday at 10 works.", "sent"],
        ]);
    } finally {
        await prefs.context.close();
    }
});
