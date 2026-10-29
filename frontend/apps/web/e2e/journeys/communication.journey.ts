import { randomUUID } from "node:crypto";
import { formatDate, strings } from "@clientbridge/app-core/public";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { bookingApi } from "../support/bookings";
import {
    clientPhone,
    communicationEvidence,
    inboundText,
    type CommunicationEvidence,
} from "../support/communication";
import {
    addClassClient,
    classFixture,
    classManageUrl,
    cleanupClass,
    expectClassState,
    type ClassFixture,
} from "../support/classes";
import { openClient, type ClientFixture, clientCommand, editClient } from "../support/clients";
import {
    BIRCHBARK_SMS,
    apiBase,
    awayFromDeliveryTick,
    clientOutreach,
    createContact,
    deliveryRows,
    headers,
    postInboundSms,
} from "../support/messaging";
import { freshPhone, textsSince, textsTo } from "../support/auth";
import { signIn, navigate } from "../support/session";
import { demoId, demoPhone } from "@clientbridge/config/e2e/run";

const s = strings.messaging;
const zone = "America/Vancouver";
// The worker's send_deliveries cron fires at second 15 of every minute (tasks/worker.py).
const TICK = 15;

async function setPhone(page: Page, client: ClientFixture, phone: string): Promise<void> {
    const response = await page.request.patch(`${bookingApi()}/v1/clients/${client.id}`, {
        data: { phone },
        headers: { "Idempotency-Key": randomUUID(), Origin: new URL(page.url()).origin },
    });
    expect(response.status(), await response.text()).toBe(200);
}

/** Waits until the next worker tick is at least 25 seconds away, so a step lands between ticks. */
async function betweenTicks(page: Page): Promise<void> {
    const second = new Date().getUTCSeconds();
    const lead = (TICK + 60 - second) % 60;
    if (lead < 25) await page.waitForTimeout((lead + 2) * 1000);
}

function seatDeliveries(evidence: CommunicationEvidence, slotId: string, bookingId: string) {
    return evidence.deliveries
        .filter((row) => row.scope === `seat:${slotId}:${bookingId}`)
        .sort((a, b) => a.channel.localeCompare(b.channel));
}

async function openThread(page: Page, client: ClientFixture): Promise<Locator> {
    await page.goto("/inbox");
    await page.getByRole("searchbox").fill(client.name);
    await page
        .getByRole("button")
        .filter({ has: page.getByText(client.name, { exact: true }) })
        .first()
        .click({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: client.name, exact: true })).toBeVisible();
    return page.locator('[aria-live="polite"]');
}

test("FLOW-06-A a seat notice queued for the worker honours a STOP that arrives first, and every device shows texts are off", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(300_000);
    await signIn(page);
    const fixture = await classFixture(page);
    const clientContext = await browser.newContext();
    const observer = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        viewport: { width: 1440, height: 900 },
    });
    try {
        const phone = clientPhone();
        const waiting = { ...fixture.waiting, phone };
        await setPhone(page, waiting, phone);
        const secondId = await addClassClient(page, fixture, fixture.second, "confirmed");
        const waitingId = await addClassClient(page, fixture, waiting, "waitlisted");
        await expectClassState(fixture, [
            { client: fixture.first, id: fixture.bookingId, status: "confirmed" },
            { client: fixture.second, id: secondId, status: "confirmed" },
            { client: waiting, id: waitingId, status: "waitlisted" },
        ]);
        // joining the waitlist texts the client before any STOP; the intake-form job may text too
        await expect
            .poll(async () => (await textsTo(page.request, phone)).length, { timeout: 90_000 })
            .toBeGreaterThan(0);
        const before = await communicationEvidence(waiting.id);
        expect(before.consents).toEqual([]);
        expect(before.threads).toEqual([]);
        expect(seatDeliveries(before, fixture.slotId, waitingId)).toEqual([]);

        const client = await clientContext.newPage();
        const manageUrl = await classManageUrl(fixture);
        const token = new URL(manageUrl).pathname.split("/").at(-1);
        await client.goto(manageUrl);
        await expect(client.getByText(fixture.itemName, { exact: true })).toBeVisible();
        await client
            .getByRole("button", { name: strings.publicManage.cancel, exact: true })
            .click();
        await betweenTicks(page);
        const canceled = client.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === `/manage/${token}/cancel` &&
                response.request().method() === "POST",
        );
        await client
            .getByRole("button", { name: strings.publicManage.cancelConfirm, exact: true })
            .click();
        const cancellation = await canceled;
        expect(cancellation.status(), await cancellation.text()).toBe(200);
        const beforeStop = Date.now();
        const stop = await inboundText(page.request, { from: phone, body: "STOP" });
        const stoppedAt = new Date();
        expect(stop.status).toBe(200);
        const webhookId = `twilio_${stop.sid}`;

        const held = await communicationEvidence(waiting.id, [webhookId]);
        // the notice is still waiting for the worker when the STOP commits
        expect(seatDeliveries(held, fixture.slotId, waitingId)).toEqual([
            {
                id: expect.any(String),
                channel: "sms",
                state: "queued",
                error: null,
                provider_ref: null,
                scope: `seat:${fixture.slotId}:${waitingId}`,
                recipient: phone,
            },
        ]);
        expect(held.consents).toEqual([{ status: "withdrawn", source: "reply" }]);
        expect(held.threads).toEqual([{ id: expect.any(String) }]);
        expect(held.messages).toEqual([
            {
                id: expect.any(String),
                thread_id: held.threads[0]?.id,
                direction: "in",
                body: "STOP",
                status: "delivered",
                provider_ref: stop.sid,
            },
        ]);
        expect(held.webhooks).toEqual([
            {
                id: webhookId,
                provider: "twilio",
                event: "sms.inbound",
                status: "processed",
                payload: {
                    from: phone,
                    to: demoPhone("+12365550190"),
                    matched: true,
                    business_id: demoId("bz_birchbark"),
                    opt_out: true,
                },
            },
        ]);
        const replayed = await inboundText(page.request, {
            from: phone,
            body: "STOP",
            sid: stop.sid,
        });
        expect(replayed.status).toBe(200);
        const forged = await inboundText(page.request, {
            from: phone,
            body: "START",
            signature: "forged",
        });
        expect(forged.status).toBe(401);
        const afterNoise = await communicationEvidence(waiting.id, [webhookId]);
        expect(afterNoise.consents).toEqual(held.consents);
        expect(afterNoise.messages).toEqual(held.messages);

        await test.step("the worker refuses the stopped text", async () => {
            await expect
                .poll(
                    async () =>
                        seatDeliveries(
                            await communicationEvidence(waiting.id),
                            fixture.slotId,
                            waitingId,
                        ).map((row) => [row.channel, row.state, row.error]),
                    { timeout: 100_000, intervals: [2_000] },
                )
                .toEqual([["sms", "failed", "consent_withdrawn"]]);
        });
        const refused = seatDeliveries(
            await communicationEvidence(waiting.id),
            fixture.slotId,
            waitingId,
        );
        expect(await textsSince(page.request, phone, beforeStop)).toEqual([]);

        const other = await observer.newPage();
        await signIn(other);
        for (const replica of [page, other]) {
            const log = await openThread(replica, waiting);
            await expect(log.getByText("STOP", { exact: true })).toHaveCount(1);
            await expect(
                replica.getByText(s.textsOffTitle(waiting.name.split(" ")[0] ?? ""), {
                    exact: true,
                }),
            ).toBeVisible();
            const record = await openClient(replica, waiting);
            await expect(record).toContainText(
                strings.clients.record.textsStopped(formatDate(stoppedAt, zone)),
            );
        }
        await testInfo.attach("seat-notice-delivery", {
            body: JSON.stringify({ held, refused }),
            contentType: "application/json",
        });
    } finally {
        await observer.close();
        await clientContext.close();
        await cleanupClass(page, fixture);
    }
});

async function openInboxThread(page: Page, contact: { name: string }) {
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
        // joining the waitlist texts the client before any STOP; the intake-form job may text too
        await expect
            .poll(async () => (await textsTo(page.request, phone)).length, { timeout: 90_000 })
            .toBeGreaterThan(0);
        const scope = `seat:${fixture.slotId}:${waitingId}:`;
        expect(await deliveryRows(scope)).toEqual([]);
        expect(await clientOutreach(fixture.waiting.id)).toEqual({
            threads: [],
            messages: [],
            consents: [],
        });

        await awayFromDeliveryTick();
        await cancelOnManagePage(page, fixture);
        const beforeStop = Date.now();
        const stop = await postInboundSms(page.request, {
            from: phone,
            to: BIRCHBARK_SMS,
            body: "STOP",
        });
        expect(stop.response.status()).toBe(200);
        const queued = await deliveryRows(scope);
        expect(queued.map((d) => [d.channel, d.state, d.error, d.recipient])).toEqual([
            ["sms", "queued", null, phone],
        ]);
        expect(queued[0]?.from_number).toBe(BIRCHBARK_SMS);
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
                status: "withdrawn",
                source: "reply",
                recorded_by: null,
            },
        ]);
        expect(stopped.messages.map((m) => [m.direction, m.body])).toEqual([["in", "STOP"]]);

        await expect
            .poll(async () => (await deliveryRows(scope)).map((d) => [d.state, d.error]), {
                timeout: 100_000,
                intervals: [2_000],
            })
            .toEqual([["failed", "consent_withdrawn"]]);
        const settled = await deliveryRows(scope);
        expect(await textsSince(page.request, phone, beforeStop)).toEqual([]);
        expect(await clientOutreach(fixture.waiting.id)).toEqual(stopped);

        const log = await openInboxThread(page, fixture.waiting);
        await expect(log.getByText("STOP", { exact: true })).toHaveCount(1);
        await expect(
            page.getByText(s.textsOffTitle(fixture.waiting.name.split(" ")[0] ?? ""), {
                exact: true,
            }),
        ).toBeVisible({ timeout: 60_000 });
        await testInfo.attach("stop-after-queue", {
            body: JSON.stringify({ queued, settled }),
            contentType: "application/json",
        });
    } finally {
        await cleanupClass(page, fixture);
    }
});

test("MSG-E2E-15 a STOP holds against the staff toggle until the client replies START", async ({
    page,
}) => {
    test.setTimeout(300_000);
    await signIn(page);
    const contact = await createContact(page);
    const consents = (rows: { status: string; source: string }[]) =>
        rows.map((c) => [c.status, c.source]);
    const stop = await postInboundSms(page.request, {
        from: contact.phone,
        to: BIRCHBARK_SMS,
        body: "arrêt",
    });
    expect(stop.response.status()).toBe(200);
    expect(consents((await clientOutreach(contact.id)).consents)).toEqual([["withdrawn", "reply"]]);

    const editor = await editClient(page, contact);
    const toggle = editor.getByRole("switch", { name: strings.clients.edit.consentLabel });
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    const saving = clientCommand(page, `/${contact.id}`, "PATCH");
    await editor.getByRole("button", { name: strings.clients.edit.save, exact: true }).click();
    expect((await saving).status()).toBe(200);
    // only the client's own START lifts a STOP, so the staff toggle records nothing
    expect(consents((await clientOutreach(contact.id)).consents)).toEqual([["withdrawn", "reply"]]);

    await navigate(page, "/inbox");
    await page.getByRole("button", { name: s.newShort, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: s.clientLabel, exact: true }).fill(contact.name);
    await page.locator(`[role="option"][data-value="${contact.id}"]`).click({ timeout: 60_000 });
    await expect(dialog.getByText(s.smsBlockedNew, { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: s.sendMessage, exact: true })).toBeDisabled();
    const blocked = await page.request.post(`${apiBase()}/v1/messages`, {
        data: { client_id: contact.id, body: "Are you free Friday?" },
        headers: headers(page),
    });
    expect(blocked.status()).toBe(409);
    expect((await clientOutreach(contact.id)).messages.map((m) => [m.direction, m.body])).toEqual([
        ["in", "arrêt"],
    ]);
    await dialog.getByRole("button", { name: s.cancel, exact: true }).click();

    const start = await postInboundSms(page.request, {
        from: contact.phone,
        to: BIRCHBARK_SMS,
        body: "START",
    });
    expect(start.response.status()).toBe(200);
    expect(consents((await clientOutreach(contact.id)).consents)).toEqual([
        ["withdrawn", "reply"],
        ["granted", "reply"],
    ]);
    const log = await openInboxThread(page, contact);
    await expect(log.getByText("START", { exact: true })).toHaveCount(1);
    await expect(
        page.getByText(s.textsOffTitle(contact.name.split(" ")[0] ?? ""), { exact: true }),
    ).toHaveCount(0, { timeout: 60_000 });
    const reply = page.getByRole("textbox", { name: s.replyPlaceholder, exact: true });
    await reply.fill("Thanks for coming back. Friday at 10 works.");
    const sent = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/v1/messages" && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: s.send, exact: true }).click();
    const delivered = await sent;
    expect(delivered.status()).toBe(200);
    expect(await delivered.json()).toMatchObject({ status: "sent" });
    expect(
        (await clientOutreach(contact.id)).messages.map((m) => [m.direction, m.body, m.status]),
    ).toEqual([
        ["in", "arrêt", "read"],
        ["in", "START", "read"],
        ["out", "Thanks for coming back. Friday at 10 works.", "sent"],
    ]);
});
