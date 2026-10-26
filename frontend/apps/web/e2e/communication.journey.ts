import { randomUUID } from "node:crypto";
import { formatDate, strings } from "@clientbridge/app-core/public";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { bookingApi } from "./support/bookings";
import {
    clientPhone,
    communicationEvidence,
    emailEvent,
    inboundText,
    type CommunicationEvidence,
} from "./support/callbacks";
import {
    addClassClient,
    classFixture,
    classManageUrl,
    cleanupClass,
    expectClassState,
} from "./support/classes";
import { openClient, type ClientFixture } from "./support/crm";
import {
    careMessage,
    composeMessage,
    expectMail,
    expectMessageCommitted,
    inboxMail,
    messageFixture,
} from "./support/messaging";
import { signIn } from "./support/session";

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

function bubble(log: Locator, body: string): Locator {
    return log
        .locator("div")
        .filter({ has: log.page().getByText(body, { exact: true }) })
        .last();
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
                    to: "+12365550190",
                    matched: true,
                    business_id: "bz_birchbark",
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
        const fresh = async () =>
            (await inboxMail(page.request, waiting.email)).filter(
                (m) => !mailBefore.includes(m.ID),
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
            tags: { delivery: email.id, business: "bz_birchbark", client: waiting.id },
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
                    business_id: "bz_birchbark",
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

        const tags = { business: "bz_birchbark", client: client.id, message: first.id };
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
