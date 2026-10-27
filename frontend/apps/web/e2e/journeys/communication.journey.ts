import { randomUUID } from "node:crypto";
import { formatDate, strings } from "@clientbridge/app-core/public";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { bookingApi } from "../support/bookings";
import {
    clientPhone,
    communicationEvidence,
    emailEvent,
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
    careMessage,
    composeMessage,
    expectMail,
    expectMessageCommitted,
    inboxMail,
    messageFixture,
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
} from "../support/messaging";
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

// the message text and its status line share one column
function bubble(log: Locator, body: string): Locator {
    return log.getByText(body, { exact: true }).last().locator("..");
}

test("FLOW-06-A a seat notice queued for the worker honours a STOP that arrives first, and its email counts as delivered only after the signed callback", async ({
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
        const waiting = fixture.waiting;
        await setPhone(page, waiting, phone);
        const secondId = await addClassClient(page, fixture, fixture.second, "confirmed");
        const waitingId = await addClassClient(page, fixture, waiting, "waitlisted");
        await expectClassState(fixture, [
            { client: fixture.first, id: fixture.bookingId, status: "confirmed" },
            { client: fixture.second, id: secondId, status: "confirmed" },
            { client: waiting, id: waitingId, status: "waitlisted" },
        ]);
        const before = await communicationEvidence(waiting.id);
        expect(before.consents).toEqual([]);
        expect(before.threads).toEqual([]);
        expect(seatDeliveries(before, fixture.slotId, waitingId)).toEqual([]);
        const mailBefore = (await inboxMail(page.request, waiting.email)).map((m) => m.ID);

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
        const stop = await inboundText(page.request, { from: phone, body: "STOP" });
        const stoppedAt = new Date();
        expect(stop.status).toBe(200);
        const webhookId = `twilio_${stop.sid}`;

        const held = await communicationEvidence(waiting.id, [webhookId]);
        // both halves of the notice are still waiting for the worker when the STOP commits
        expect(seatDeliveries(held, fixture.slotId, waitingId)).toEqual([
            {
                id: expect.any(String),
                channel: "email",
                state: "queued",
                error: null,
                provider_ref: null,
                scope: `seat:${fixture.slotId}:${waitingId}`,
                recipient: waiting.email,
            },
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
        expect(held.consents).toEqual([{ channel: "sms", status: "withdrawn", source: "reply" }]);
        expect(held.threads).toEqual([{ id: expect.any(String), channel: "sms" }]);
        expect(held.messages).toEqual([
            {
                id: expect.any(String),
                thread_id: held.threads[0]?.id,
                direction: "in",
                channel: "sms",
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

        await test.step("the worker sends the email half and refuses the stopped text", async () => {
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
                .toEqual([
                    ["email", "accepted", null],
                    ["sms", "failed", "consent_withdrawn"],
                ]);
        });
        // the intake form cron may also mail the new client while this runs
        const fresh = async () =>
            (await inboxMail(page.request, waiting.email)).filter(
                (m) =>
                    !mailBefore.includes(m.ID) &&
                    m.Subject === `A seat opened up in ${fixture.itemName}`,
            );
        await expect.poll(async () => (await fresh()).length).toBe(1);
        const [mail] = await fresh();
        const accepted = seatDeliveries(
            await communicationEvidence(waiting.id),
            fixture.slotId,
            waitingId,
        );
        const email = accepted[0];
        if (email === undefined || mail === undefined) throw new Error("The seat notice is gone");

        const emailId = `re_${randomUUID()}`;
        const delivered = {
            type: "email.delivered" as const,
            emailId,
            to: waiting.email,
            tags: { delivery: email.id, business: demoId("bz_birchbark"), client: waiting.id },
        };
        expect((await emailEvent(page.request, delivered, { forged: true })).status).toBe(401);
        expect(
            seatDeliveries(await communicationEvidence(waiting.id), fixture.slotId, waitingId),
        ).toEqual(accepted);
        const confirmed = await emailEvent(page.request, delivered);
        expect(confirmed.status).toBe(200);
        const settled = await communicationEvidence(waiting.id, [`resend_${confirmed.id}`]);
        expect(seatDeliveries(settled, fixture.slotId, waitingId)).toEqual([
            { ...email, state: "delivered", provider_ref: emailId },
            accepted[1],
        ]);
        expect(settled.webhooks).toEqual([
            {
                id: `resend_${confirmed.id}`,
                provider: "resend",
                event: "email.delivered",
                status: "processed",
                payload: {
                    email_id: emailId,
                    to: waiting.email,
                    detail: "",
                    matched: true,
                    business_id: demoId("bz_birchbark"),
                },
            },
        ]);
        expect((await emailEvent(page.request, delivered, { id: confirmed.id })).status).toBe(200);
        expect(await communicationEvidence(waiting.id, [`resend_${confirmed.id}`])).toEqual(
            settled,
        );
        expect(await fresh()).toHaveLength(1);

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
            // a stopped number leaves the reply composer on email
            await expect(
                replica
                    .getByRole("group", { name: s.channelLabel, exact: true })
                    .getByRole("button", { name: s.channels.email, exact: true }),
            ).toHaveAttribute("aria-pressed", "true");
            await expect(
                replica.getByRole("textbox", { name: s.replyPlaceholder("email"), exact: true }),
            ).toBeVisible();
            const record = await openClient(replica, waiting);
            await expect(record).toContainText(
                strings.clients.record.textsStopped(formatDate(stoppedAt, zone)),
            );
        }
        await testInfo.attach("seat-notice-delivery", {
            body: JSON.stringify({ held, settled, mail }),
            contentType: "application/json",
        });
    } finally {
        await observer.close();
        await clientContext.close();
        await cleanupClass(page, fixture);
    }
});

test("FLOW-06-B an accepted email reads Sent until the provider confirms it, and a later bounce reads Not delivered on both devices", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(240_000);
    await signIn(page);
    const client = await messageFixture(page);
    const dialog = await composeMessage(page, client);
    await dialog.getByRole("textbox", { name: s.newMessageTitle, exact: true }).fill(careMessage);
    await dialog.getByRole("button", { name: s.sendMessage, exact: true }).click();
    await expect(dialog).toBeHidden();
    const committed = await expectMessageCommitted(client);
    await expectMail(page.request, client.email);
    const first = committed.messages[0];
    if (first === undefined) throw new Error("The sent message is missing");

    const observer = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        viewport: { width: 1440, height: 900 },
    });
    try {
        const other = await observer.newPage();
        await signIn(other);
        const logs = [await openThread(page, client), await openThread(other, client)];
        for (const log of logs) {
            await expect(bubble(log, careMessage)).toContainText(s.thread.status.sent);
            await expect(bubble(log, careMessage)).not.toContainText(s.thread.status.delivered);
        }

        const tags = { business: demoId("bz_birchbark"), client: client.id, message: first.id };
        const firstId = `re_${randomUUID()}`;
        const delivered = {
            type: "email.delivered" as const,
            emailId: firstId,
            to: client.email,
            tags,
        };
        expect((await emailEvent(page.request, delivered, { forged: true })).status).toBe(401);
        expect((await communicationEvidence(client.id)).messages).toEqual([
            expect.objectContaining({ id: first.id, status: "sent", provider_ref: null }),
        ]);
        const confirmed = await emailEvent(page.request, delivered);
        expect(confirmed.status).toBe(200);
        for (const log of logs)
            await expect(bubble(log, careMessage)).toContainText(s.thread.status.delivered, {
                timeout: 60_000,
            });
        const afterDelivery = await communicationEvidence(client.id, [`resend_${confirmed.id}`]);
        expect(afterDelivery.messages).toEqual([
            expect.objectContaining({ id: first.id, status: "delivered", provider_ref: firstId }),
        ]);
        expect(afterDelivery.webhooks).toEqual([
            expect.objectContaining({ event: "email.delivered", status: "processed" }),
        ]);
        expect((await emailEvent(page.request, delivered, { id: confirmed.id })).status).toBe(200);
        expect(await communicationEvidence(client.id, [`resend_${confirmed.id}`])).toEqual(
            afterDelivery,
        );

        const followUp = "Maple's next visit is booked. Please bring her lead and favourite treat.";
        await page
            .getByRole("textbox", { name: s.replyPlaceholder("email"), exact: true })
            .fill(followUp);
        const sending = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === "/v1/messages" &&
                response.request().method() === "POST",
        );
        await page.getByRole("button", { name: s.send, exact: true }).click();
        const sent = await sending;
        expect(sent.status(), await sent.text()).toBe(200);
        const second = (await sent.json()) as { id: string; status: string };
        expect(second.status).toBe("sent");
        await expect.poll(async () => (await inboxMail(page.request, client.email)).length).toBe(2);
        for (const log of logs)
            await expect(bubble(log, followUp)).toContainText(s.thread.status.sent, {
                timeout: 60_000,
            });

        const secondId = `re_${randomUUID()}`;
        const bounce = await emailEvent(page.request, {
            type: "email.bounced",
            emailId: secondId,
            to: client.email,
            tags: { ...tags, message: second.id },
        });
        expect(bounce.status).toBe(200);
        const late = await emailEvent(page.request, {
            type: "email.delivered",
            emailId: secondId,
            to: client.email,
            tags: { ...tags, message: second.id },
        });
        expect(late.status).toBe(200);
        const final = await communicationEvidence(client.id, [
            `resend_${bounce.id}`,
            `resend_${late.id}`,
        ]);
        expect(final.messages).toEqual([
            expect.objectContaining({ id: first.id, status: "delivered", provider_ref: firstId }),
            expect.objectContaining({ id: second.id, status: "failed", provider_ref: secondId }),
        ]);
        expect(final.webhooks.map((row) => [row.event, row.status]).sort()).toEqual([
            ["email.bounced", "processed"],
            ["email.delivered", "processed"],
        ]);
        expect(final.deliveries).toEqual([]);
        for (const [index, replica] of [page, other].entries()) {
            const log = logs[index];
            if (log === undefined) throw new Error("A conversation is missing");
            await expect(bubble(log, followUp)).toContainText(s.thread.status.failed, {
                timeout: 60_000,
            });
            await replica.reload();
            const reloaded = await openThread(replica, client);
            await expect(bubble(reloaded, careMessage)).toContainText(s.thread.status.delivered);
            await expect(bubble(reloaded, followUp)).toContainText(s.thread.status.failed);
        }
        await testInfo.attach("message-delivery-callbacks", {
            body: JSON.stringify(final),
            contentType: "application/json",
        });
    } finally {
        await observer.close();
    }
});

const p = strings.publicPreferences;

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

        const log = await openInboxThread(page, fixture.waiting);
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

        const log = await openInboxThread(page, contact);
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
