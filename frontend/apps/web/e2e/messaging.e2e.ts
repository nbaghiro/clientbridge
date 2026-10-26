import { strings, addDays, combineDayAndTime } from "@clientbridge/app-core/public";
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
    careMessage,
    composeMessage,
    expectMail,
    expectMessageCommitted,
    expectConversation,
    expectMessageReplica,
    inboxMail,
    messageEvidence,
    messageFixture,
    readdress,
    deliveredMail,
    BIRCHBARK_SMS,
    CEDAR_SMS,
    apiBase,
    broadcastEvidence,
    cancelScheduledBroadcast,
    clientOutreach,
    createContact,
    freshPhone,
    headers,
    postEmailEvent,
    postInboundSms,
    scheduleBroadcast,
    webhookRows,
    type Contact,
    type EmailEvent,
} from "./support/messaging";
import { signIn, navigate } from "./support/session";
import { randomUUID } from "node:crypto";
import { demoId, runEmail } from "@clientbridge/config/e2e/run";

const s = strings.messaging;
for (const retry of [false, true]) {
    test(
        retry
            ? "MSG-E2E-02 retry after committed email response loss sends once"
            : "MSG-E2E-01 blank input is rejected and composed email persists across replicas",
        async ({ page, browser }, testInfo) => {
            await signIn(page);
            const client = await messageFixture(page);
            const dialog = await composeMessage(page, client);
            const input = dialog.getByRole("textbox", { name: s.newMessageTitle, exact: true });
            const submit = dialog.getByRole("button", { name: s.sendMessage, exact: true });
            if (!retry) {
                await input.fill("   ");
                await submit.click();
                await expect(dialog.getByText(s.writeMessage, { exact: true })).toBeVisible();
                expect(await messageEvidence(client.id)).toEqual({
                    threads: [],
                    messages: [],
                    deliveries: [],
                    audits: [],
                });
                expect(await inboxMail(page.request, client.email)).toEqual([]);
            }
            await input.fill(careMessage);
            const keys: (string | undefined)[] = [];
            const bodies: (string | null)[] = [];
            if (retry) {
                await page.route("**/v1/messages", async (route) => {
                    keys.push(route.request().headers()["idempotency-key"]);
                    bodies.push(route.request().postData());
                    const actual = await route.fetch();
                    expect(actual.status(), await actual.text()).toBe(200);
                    if (keys.length === 1) await route.abort("connectionreset");
                    else await route.fulfill({ response: actual });
                });
            }
            await submit.click();
            if (retry) {
                await expect(dialog.getByText(s.sendError, { exact: true })).toBeVisible();
                const committed = await expectMessageCommitted(client);
                const mailId = await expectMail(page.request, client.email);
                await submit.click();
                await expect(dialog).toBeHidden();
                expect(keys).toHaveLength(2);
                expect(keys[0]).toBeTruthy();
                expect(keys[1]).toBe(keys[0]);
                expect(bodies[1]).toBe(bodies[0]);
                expect(await messageEvidence(client.id)).toEqual(committed);
                expect(await expectMail(page.request, client.email)).toBe(mailId);
            } else await expect(dialog).toBeHidden();
            const evidence = await expectMessageCommitted(client);
            await expectMail(page.request, client.email);
            const observer = await browser.newContext({
                baseURL: new URL(page.url()).origin,
                viewport: { width: 1440, height: 900 },
            });
            try {
                const other = await observer.newPage();
                await signIn(other);
                await expectMessageReplica(other, client);
                await other.reload();
                await expectMessageReplica(other, client);
                await page.reload();
                await expectMessageReplica(page, client);
                expect(await messageEvidence(client.id)).toEqual(evidence);
                await expectMail(page.request, client.email);
                await testInfo.attach("committed-message", {
                    body: JSON.stringify(evidence),
                    contentType: "application/json",
                });
            } finally {
                await observer.close();
            }
        },
    );
}

test("MSG-E2E-03 a message the provider refused keeps its draft and a retry sends it once", async ({
    page,
}) => {
    await signIn(page);
    const client = await messageFixture(page);
    const refused = client.email.replace(/@.*$/, "@mailbox.invalid");
    await readdress(page, client, refused);
    const dialog = await composeMessage(page, client);
    const input = dialog.getByRole("textbox", { name: s.newMessageTitle, exact: true });
    const submit = dialog.getByRole("button", { name: s.sendMessage, exact: true });
    const sends: { key: string | undefined; status: number; body: { status: string } }[] = [];
    page.on("response", async (response) => {
        if (new URL(response.url()).pathname !== "/v1/messages") return;
        sends.push({
            key: response.request().headers()["idempotency-key"],
            status: response.status(),
            body: (await response.json()) as { status: string },
        });
    });
    await input.fill(careMessage);
    await submit.click();
    await expect(dialog.getByText(s.notDelivered, { exact: true })).toBeVisible();
    await expect(input).toHaveValue(careMessage);
    await expect.poll(() => sends.length).toBe(1);
    expect(sends[0]?.status).toBe(200);
    expect(sends[0]?.body.status).toBe("failed");
    const failed = await messageEvidence(client.id);
    expect(failed.messages.map((m) => [m.body, m.status])).toEqual([[careMessage, "failed"]]);
    expect(failed.audits.map((a) => a.action)).toEqual(["message.send"]);
    expect(await inboxMail(page.request, refused)).toEqual([]);

    await readdress(page, client, client.email);
    await submit.click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => sends.length).toBe(2);
    expect(sends[1]?.body.status).toBe("sent");
    expect(sends[1]?.key).toBeTruthy();
    expect(sends[1]?.key).not.toBe(sends[0]?.key);
    const evidence = await messageEvidence(client.id);
    expect(evidence.messages.map((m) => [m.body, m.status])).toEqual([
        [careMessage, "failed"],
        [careMessage, "sent"],
    ]);
    expect(evidence.threads).toHaveLength(1);
    await expectMail(page.request, client.email);
    await expectConversation(page, client, [s.thread.status.failed, s.thread.status.sent]);
    await page.reload();
    await expectConversation(page, client, [s.thread.status.failed, s.thread.status.sent]);
    expect(await messageEvidence(client.id)).toEqual(evidence);
});

const ZONE = "America/Vancouver";
const cedar = { email: runEmail("owner@cedarcoast.example"), password: "demo1234" };

async function signedInContext(browser: Browser, origin: string, as?: typeof cedar) {
    const context = await browser.newContext({
        baseURL: origin,
        viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await signIn(page, as);
    return { context, page };
}

async function openConversation(page: Page, contact: Contact, filter: "all" | "unread") {
    await navigate(page, "/today");
    await navigate(page, "/inbox");
    await page
        .getByRole("group", { name: s.filterLabel, exact: true })
        .getByRole("button", { name: s.filters[filter], exact: true })
        .click();
    await page.getByRole("searchbox").fill(contact.name);
    return page
        .getByRole("navigation", { name: s.title, exact: true })
        .getByRole("button")
        .filter({ has: page.getByText(contact.name, { exact: true }) });
}

test("MSG-E2E-10 a text sent from the composer and its signed reply share one thread, read on every device", async ({
    page,
    browser,
}) => {
    await signIn(page);
    const contact = await createContact(page);
    expect(await clientOutreach(contact.id)).toEqual({ threads: [], messages: [], consents: [] });
    const outgoing = `Hi ${contact.name.split(" ")[0] ?? ""}, Maple is ready for pickup at 3.`;
    await navigate(page, "/inbox");
    await page.getByRole("button", { name: s.newShort, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: s.clientLabel, exact: true }).fill(contact.name);
    await page.locator(`[role="option"][data-value="${contact.id}"]`).click({ timeout: 60_000 });
    await dialog
        .getByRole("group", { name: s.channelLabel, exact: true })
        .getByRole("button", { name: s.channels.sms, exact: true })
        .click();
    await dialog.getByRole("textbox", { name: s.newMessageTitle, exact: true }).fill(outgoing);
    const sent = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/v1/messages" && r.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: s.sendMessage, exact: true }).click();
    const response = await sent;
    expect(response.status(), await response.text()).toBe(200);
    expect(await response.json()).toMatchObject({ channel: "sms", status: "sent" });
    await expect(dialog).toBeHidden();
    const afterSend = await clientOutreach(contact.id);
    expect(afterSend.threads).toEqual([
        {
            id: expect.any(String),
            business_id: demoId("bz_birchbark"),
            client_id: contact.id,
            channel: "sms",
            status: "open",
        },
    ]);
    const thread = afterSend.threads[0]?.id;
    expect(afterSend.messages).toEqual([
        {
            id: expect.any(String),
            business_id: demoId("bz_birchbark"),
            client_id: contact.id,
            direction: "out",
            channel: "sms",
            body: outgoing,
            status: "sent",
            provider_ref: null,
            sent_by: demoId("us_dev"),
            broadcast_id: null,
        },
    ]);

    const reply = "Thanks! I'll be there at 3.";
    const inbound = await postInboundSms(page.request, {
        from: contact.phone,
        to: BIRCHBARK_SMS,
        body: reply,
    });
    expect(inbound.response.status()).toBe(200);
    const replied = await clientOutreach(contact.id);
    expect(replied.threads.map((t) => t.id)).toEqual([thread]);
    expect(replied.messages.slice(1)).toEqual([
        {
            id: expect.any(String),
            business_id: demoId("bz_birchbark"),
            client_id: contact.id,
            direction: "in",
            channel: "sms",
            body: reply,
            status: "delivered",
            provider_ref: inbound.sid,
            sent_by: null,
            broadcast_id: null,
        },
    ]);
    expect(replied.consents).toEqual([]);
    expect(await webhookRows(`twilio_${inbound.sid ?? ""}`)).toEqual([
        {
            id: `twilio_${inbound.sid ?? ""}`,
            provider: "twilio",
            event: "sms.inbound",
            status: "processed",
            payload: {
                from: contact.phone,
                to: BIRCHBARK_SMS,
                matched: true,
                business_id: demoId("bz_birchbark"),
                opt_out: false,
            },
        },
    ]);

    const second = await signedInContext(browser, new URL(page.url()).origin);
    const cedarOwner = await signedInContext(browser, new URL(page.url()).origin, cedar);
    try {
        const unreadHere = await openConversation(page, contact, "unread");
        await expect(unreadHere).toHaveCount(1, { timeout: 60_000 });
        await expect(unreadHere.getByText("1", { exact: true })).toBeVisible();
        const unreadThere = await openConversation(second.page, contact, "unread");
        await expect(unreadThere).toHaveCount(1, { timeout: 60_000 });
        const reading = second.page.waitForResponse(
            (r) =>
                new URL(r.url()).pathname === `/v1/threads/${thread ?? ""}/read` &&
                r.request().method() === "POST",
        );
        await unreadThere.click();
        expect((await reading).status()).toBe(200);
        const log = second.page.locator('[aria-live="polite"]');
        await expect(log.getByText(outgoing, { exact: true })).toHaveCount(1);
        await expect(log.getByText(reply, { exact: true })).toHaveCount(1);
        const read = await clientOutreach(contact.id);
        expect(read.messages.map((m) => [m.direction, m.status])).toEqual([
            ["out", "sent"],
            ["in", "read"],
        ]);
        for (const device of [page, second.page]) {
            await device.reload();
            await expect(await openConversation(device, contact, "unread")).toHaveCount(0, {
                timeout: 60_000,
            });
            await expect(device.getByText(s.noThreadsFiltered, { exact: true })).toBeVisible();
            const row = await openConversation(device, contact, "all");
            await row.click({ timeout: 60_000 });
            const conversation = device.locator('[aria-live="polite"]');
            await expect(conversation.getByText(outgoing, { exact: true })).toHaveCount(1);
            await expect(conversation.getByText(reply, { exact: true })).toHaveCount(1);
        }
        await expect(await openConversation(cedarOwner.page, contact, "all")).toHaveCount(0);
        const foreign = await cedarOwner.page.request.get(
            `${apiBase()}/v1/threads/${thread ?? ""}/messages`,
            { params: { before: new Date().toISOString() } },
        );
        expect(foreign.status()).toBe(404);
        expect(await clientOutreach(contact.id)).toEqual(read);
    } finally {
        await second.context.close();
        await cedarOwner.context.close();
    }
});

test("MSG-E2E-11 inbound texts route only to the number's business and unsigned or repeated ones change nothing", async ({
    page,
    browser,
}) => {
    await signIn(page);
    const shared = freshPhone();
    const ours = await createContact(page, { phone: shared });
    const cedarOwner = await signedInContext(browser, new URL(page.url()).origin, cedar);
    try {
        const theirs = await createContact(cedarOwner.page, { phone: shared });
        const twin = freshPhone();
        const first = await createContact(page, { phone: twin });
        const second = await createContact(page, { phone: twin });
        const ids = [ours.id, theirs.id, first.id, second.id];
        const empty = await clientOutreach(...ids);
        expect(empty).toEqual({ threads: [], messages: [], consents: [] });

        const refused: string[] = [];
        for (const signing of ["wrong", "missing"] as const) {
            const attempt = await postInboundSms(
                page.request,
                { from: shared, to: BIRCHBARK_SMS, body: "STOP" },
                signing,
            );
            expect(attempt.response.status()).toBe(401);
            refused.push(`twilio_${attempt.sid ?? ""}`);
        }
        const unsent = await postInboundSms(page.request, {
            from: shared,
            to: BIRCHBARK_SMS,
            body: "STOP",
            sid: null,
        });
        expect(unsent.response.status()).toBe(400);
        expect(await webhookRows(...refused)).toEqual([]);
        expect(await clientOutreach(...ids)).toEqual(empty);

        const unknown = await postInboundSms(page.request, {
            from: shared,
            to: "+12365550191",
            body: "Is anyone there?",
        });
        expect(unknown.response.status()).toBe(200);
        const ambiguous = await postInboundSms(page.request, {
            from: twin,
            to: BIRCHBARK_SMS,
            body: "STOP",
        });
        expect(ambiguous.response.status()).toBe(200);
        expect(await clientOutreach(...ids)).toEqual(empty);
        const unmatched = (sid: string | null, to: string, optOut: boolean, from: string) => ({
            id: `twilio_${sid ?? ""}`,
            provider: "twilio",
            event: "sms.inbound",
            status: "processed",
            payload: { from, to, matched: false, business_id: null, opt_out: optOut },
        });
        expect(
            await webhookRows(`twilio_${unknown.sid ?? ""}`, `twilio_${ambiguous.sid ?? ""}`),
        ).toEqual(
            [
                unmatched(unknown.sid, "+12365550191", false, shared),
                unmatched(ambiguous.sid, BIRCHBARK_SMS, true, twin),
            ].sort((a, b) => a.id.localeCompare(b.id)),
        );

        const sid = `SM${randomUUID().replaceAll("-", "")}`;
        const toUs = { from: shared, to: BIRCHBARK_SMS, body: "Running five minutes late", sid };
        expect((await postInboundSms(page.request, toUs)).response.status()).toBe(200);
        const routed = await clientOutreach(...ids);
        expect(routed.threads.map((t) => [t.business_id, t.client_id, t.channel])).toEqual([
            [demoId("bz_birchbark"), ours.id, "sms"],
        ]);
        expect(
            routed.messages.map((m) => [m.business_id, m.client_id, m.direction, m.body]),
        ).toEqual([[demoId("bz_birchbark"), ours.id, "in", toUs.body]]);
        const replay = await postInboundSms(page.request, { ...toUs, body: "STOP" });
        expect(replay.response.status()).toBe(200);
        expect(await clientOutreach(...ids)).toEqual(routed);

        const toThem = await postInboundSms(page.request, {
            from: shared,
            to: CEDAR_SMS,
            body: "Can Biscuit's walk move to noon?",
        });
        expect(toThem.response.status()).toBe(200);
        const both = await clientOutreach(...ids);
        expect(both.threads.map((t) => [t.business_id, t.client_id]).sort()).toEqual(
            [
                [demoId("bz_birchbark"), ours.id],
                [demoId("bz_demo_second"), theirs.id],
            ].sort(),
        );
        expect(both.messages.filter((m) => m.client_id === theirs.id).map((m) => m.body)).toEqual([
            "Can Biscuit's walk move to noon?",
        ]);
        expect(both.consents).toEqual([]);

        const row = await openConversation(page, ours, "all");
        await row.click({ timeout: 60_000 });
        const log = page.locator('[aria-live="polite"]');
        await expect(log.getByText(toUs.body, { exact: true })).toHaveCount(1);
        await expect(
            log.getByText("Can Biscuit's walk move to noon?", { exact: true }),
        ).toHaveCount(0);
        await expect(page.getByText(s.textsOffShort, { exact: true })).toHaveCount(0);
        const theirRow = await openConversation(cedarOwner.page, theirs, "all");
        await theirRow.click({ timeout: 60_000 });
        const theirLog = cedarOwner.page.locator('[aria-live="polite"]');
        await expect(
            theirLog.getByText("Can Biscuit's walk move to noon?", { exact: true }),
        ).toHaveCount(1);
        await expect(theirLog.getByText(toUs.body, { exact: true })).toHaveCount(0);
        for (const twinClient of [first, second]) {
            await expect(await openConversation(page, twinClient, "all")).toHaveCount(0);
        }
        const send = await page.request.post(`${apiBase()}/v1/messages`, {
            data: { client_id: first.id, channel: "sms", body: "Checking in" },
            headers: headers(page),
        });
        expect(send.status(), await send.text()).toBe(200);
    } finally {
        await cedarOwner.context.close();
    }
});

test("MSG-E2E-12 signed email events settle the message once and a complaint opts out only this business's mailbox", async ({
    page,
    browser,
}) => {
    await signIn(page);
    const mailbox = runEmail(`outreach-${randomUUID()}@example.ca`);
    const flagged = await createContact(page, { email: mailbox, consent: true });
    const sharing = await createContact(page, { email: mailbox.toUpperCase(), consent: true });
    const cedarOwner = await signedInContext(browser, new URL(page.url()).origin, cedar);
    try {
        const foreign = await createContact(cedarOwner.page, { email: mailbox, consent: true });
        const ids = [flagged.id, sharing.id, foreign.id];
        const consented = (await clientOutreach(...ids)).consents;
        expect(consented.map((c) => [c.client_id, c.channel, c.status, c.source]).sort()).toEqual(
            ids
                .flatMap((id) => [
                    [id, "email", "granted", "in_person"],
                    [id, "sms", "granted", "in_person"],
                ])
                .sort(),
        );
        const dialog = await composeMessage(page, flagged);
        await dialog
            .getByRole("textbox", { name: s.newMessageTitle, exact: true })
            .fill(careMessage);
        await dialog.getByRole("button", { name: s.sendMessage, exact: true }).click();
        await expect(dialog).toBeHidden();
        const sent = await clientOutreach(...ids);
        const [message] = sent.messages;
        if (!message) throw new Error("The composed email was not recorded");
        expect(sent.messages).toEqual([
            {
                id: expect.any(String),
                business_id: demoId("bz_birchbark"),
                client_id: flagged.id,
                direction: "out",
                channel: "email",
                body: careMessage,
                status: "sent",
                provider_ref: null,
                sent_by: demoId("us_dev"),
                broadcast_id: null,
            },
        ]);
        expect((await deliveredMail(page.request, mailbox)).map((m) => m.text)).toEqual([
            careMessage,
        ]);
        const tags = { business: demoId("bz_birchbark"), message: message.id };
        const emailId = `re_${randomUUID()}`;
        const event = (type: string, extra: Partial<EmailEvent["data"]> = {}): EmailEvent => ({
            type,
            created_at: new Date().toISOString(),
            data: { email_id: emailId, to: [mailbox], tags, ...extra },
        });

        const stale = await postEmailEvent(page.request, event("email.delivered"), {
            at: new Date(Date.now() - 10 * 60_000),
        });
        const forged = await postEmailEvent(page.request, event("email.delivered"), {
            signing: "wrong",
        });
        expect([stale.response.status(), forged.response.status()]).toEqual([401, 401]);
        expect(await webhookRows(`resend_${stale.id}`, `resend_${forged.id}`)).toEqual([]);
        expect(await clientOutreach(...ids)).toEqual(sent);

        const missing = { business: demoId("bz_birchbark"), message: `message_${randomUUID()}` };
        const pending = await postEmailEvent(page.request, {
            type: "email.delivered",
            created_at: new Date().toISOString(),
            data: { to: [mailbox], tags: missing },
        });
        expect(pending.response.status()).toBe(503);
        expect(await webhookRows(`resend_${pending.id}`)).toEqual([]);
        const settled = await postEmailEvent(page.request, {
            type: "email.delivered",
            created_at: new Date(Date.now() - 20 * 60_000).toISOString(),
            data: { to: [mailbox], tags: missing },
        });
        expect(settled.response.status()).toBe(200);

        const delivered = await postEmailEvent(page.request, event("email.delivered"));
        expect(delivered.response.status()).toBe(200);
        const replayed = await postEmailEvent(page.request, event("email.bounced"), {
            id: delivered.id,
        });
        expect(replayed.response.status()).toBe(200);
        const afterDelivered = await clientOutreach(...ids);
        expect(afterDelivered.messages.map((m) => [m.status, m.provider_ref])).toEqual([
            ["delivered", emailId],
        ]);
        const row = await openConversation(page, flagged, "all");
        await row.click({ timeout: 60_000 });
        await expect(page.locator('[aria-live="polite"]')).toContainText(s.thread.status.delivered);

        const bounced = await postEmailEvent(
            page.request,
            event("email.bounced", {
                bounce: {
                    type: "Permanent",
                    subType: "General",
                    message: "Mailbox does not exist",
                },
            }),
        );
        const late = await postEmailEvent(page.request, event("email.delivered"));
        expect([bounced.response.status(), late.response.status()]).toEqual([200, 200]);
        expect((await clientOutreach(...ids)).messages.map((m) => m.status)).toEqual(["failed"]);

        const crossed = await postEmailEvent(page.request, {
            type: "email.complained",
            created_at: new Date(Date.now() - 20 * 60_000).toISOString(),
            data: {
                to: [mailbox],
                tags: { business: demoId("bz_demo_second"), client: flagged.id },
            },
        });
        expect(crossed.response.status()).toBe(200);
        expect((await clientOutreach(...ids)).consents).toEqual(consented);
        const complained = await postEmailEvent(page.request, event("email.complained"));
        expect(complained.response.status()).toBe(200);
        const final = await clientOutreach(...ids);
        expect(
            final.consents
                .slice(consented.length)
                .sort((a, b) => a.client_id.localeCompare(b.client_id)),
        ).toEqual(
            [flagged.id, sharing.id]
                .map((client) => ({
                    business_id: demoId("bz_birchbark"),
                    client_id: client,
                    channel: "email",
                    status: "withdrawn",
                    source: "complaint",
                    recorded_by: null,
                }))
                .sort((a, b) => a.client_id.localeCompare(b.client_id)),
        );
        expect(final.messages).toEqual([{ ...message, status: "failed", provider_ref: emailId }]);
        expect(
            (
                await webhookRows(
                    ...[settled, delivered, bounced, late, crossed, complained].map(
                        (e) => `resend_${e.id}`,
                    ),
                )
            )
                .map((w) => [w.id, w.event, w.status, w.payload.matched])
                .sort(),
        ).toEqual(
            [
                [`resend_${settled.id}`, "email.delivered", "processed", false],
                [`resend_${delivered.id}`, "email.delivered", "processed", true],
                [`resend_${bounced.id}`, "email.bounced", "processed", true],
                [`resend_${late.id}`, "email.delivered", "processed", true],
                [`resend_${crossed.id}`, "email.complained", "processed", false],
                [`resend_${complained.id}`, "email.complained", "processed", true],
            ].sort(),
        );

        await page.reload();
        const again = await openConversation(page, flagged, "all");
        await again.click({ timeout: 60_000 });
        const log = page.locator('[aria-live="polite"]');
        await expect(log.getByText(careMessage, { exact: true })).toHaveCount(1);
        await expect(log).toContainText(s.thread.status.failed);
        const email = page
            .getByRole("listitem")
            .filter({ has: page.getByText(s.consentChannel.email, { exact: true }) });
        await expect(email).toContainText(s.consentState.opted_out, { timeout: 60_000 });
        expect((await deliveredMail(page.request, mailbox)).map((m) => m.text)).toEqual([
            careMessage,
        ]);
    } finally {
        await cedarOwner.context.close();
    }
});

test("MSG-E2E-13 staff message and read like everyone, while broadcasts, cancels, exports and foreign records stay closed", async ({
    page,
    browser,
}) => {
    await signIn(page);
    const origin = new URL(page.url()).origin;
    const contact = await createContact(page);
    const noon = combineDayAndTime(addDays(new Date(), 1, ZONE), "12:00", ZONE);
    const scheduled = await page.request.post(`${apiBase()}/v1/broadcasts`, {
        data: {
            name: "Holiday hours",
            channel: "email",
            body: "We're closed on the holiday Monday.",
            audience: { tags: [`audience-${randomUUID()}`] },
            scheduled_at: noon.toISOString(),
        },
        headers: headers(page),
    });
    expect(scheduled.status(), await scheduled.text()).toBe(200);
    const broadcast = (await scheduled.json()) as { id: string; status: string };
    expect(broadcast.status).toBe("scheduled");
    const staff = await signedInContext(browser, origin, {
        email: runEmail("diego@birchbark.example"),
        password: "demo1234",
    });
    const admin = await signedInContext(browser, origin, {
        email: runEmail("admin@birchbark.example"),
        password: "demo1234",
    });
    const cedarOwner = await signedInContext(browser, origin, cedar);
    try {
        const foreign = await createContact(cedarOwner.page);
        const foreignSend = await cedarOwner.page.request.post(`${apiBase()}/v1/messages`, {
            data: { client_id: foreign.id, channel: "email", body: "See you Thursday." },
            headers: headers(cedarOwner.page),
        });
        expect(foreignSend.status(), await foreignSend.text()).toBe(200);
        const foreignBefore = await clientOutreach(foreign.id);
        const foreignThread = foreignBefore.threads[0]?.id ?? "";

        await navigate(staff.page, "/inbox");
        await expect(
            staff.page.getByRole("tab", { name: strings.navigation.inboxSegments.broadcasts }),
        ).toHaveCount(0);
        const dialog = await composeMessage(staff.page, contact);
        await dialog
            .getByRole("textbox", { name: s.newMessageTitle, exact: true })
            .fill(careMessage);
        await dialog.getByRole("button", { name: s.sendMessage, exact: true }).click();
        await expect(dialog).toBeHidden();
        const own = await clientOutreach(contact.id);
        expect(own.messages.map((m) => [m.direction, m.channel, m.status, m.sent_by])).toEqual([
            ["out", "email", "sent", demoId("us_diego")],
        ]);
        const row = await openConversation(staff.page, contact, "all");
        await row.click({ timeout: 60_000 });
        await expect(
            staff.page.locator('[aria-live="polite"]').getByText(careMessage, { exact: true }),
        ).toHaveCount(1);
        const ownThread = own.threads[0]?.id ?? "";
        const history = await staff.page.request.get(
            `${apiBase()}/v1/threads/${ownThread}/messages`,
            { params: { before: new Date(Date.now() + 60_000).toISOString() } },
        );
        expect(history.status()).toBe(200);
        expect(((await history.json()) as { messages: { body: string }[] }).messages).toEqual([
            expect.objectContaining({ body: careMessage, author: "Diego Ramirez" }),
        ]);

        const refusals = [
            await staff.page.request.post(`${apiBase()}/v1/broadcasts`, {
                data: { name: "Staff offer", channel: "email", body: "Half off", audience: {} },
                headers: headers(staff.page),
            }),
            await staff.page.request.post(`${apiBase()}/v1/broadcasts/${broadcast.id}/cancel`, {
                headers: headers(staff.page),
            }),
            await staff.page.request.post(`${apiBase()}/v1/consents/export`, {
                headers: headers(staff.page),
            }),
        ];
        expect(refusals.map((r) => r.status())).toEqual([403, 403, 403]);
        const foreignRefusals = [
            await staff.page.request.post(`${apiBase()}/v1/messages`, {
                data: { client_id: foreign.id, channel: "email", body: "Wrong business" },
                headers: headers(staff.page),
            }),
            await staff.page.request.post(`${apiBase()}/v1/threads/${foreignThread}/read`, {
                headers: headers(staff.page),
            }),
            await staff.page.request.get(`${apiBase()}/v1/threads/${foreignThread}/messages`, {
                params: { before: new Date().toISOString() },
            }),
            await staff.page.request.post(`${apiBase()}/v1/broadcasts/${broadcast.id}/cancel`, {
                headers: headers(cedarOwner.page),
            }),
        ];
        expect(foreignRefusals.map((r) => r.status())).toEqual([404, 404, 404, 403]);
        const crossCancel = await cedarOwner.page.request.post(
            `${apiBase()}/v1/broadcasts/${broadcast.id}/cancel`,
            { headers: headers(cedarOwner.page) },
        );
        expect(crossCancel.status()).toBe(404);
        expect(await clientOutreach(foreign.id)).toEqual(foreignBefore);
        expect((await broadcastEvidence(broadcast.id)).broadcasts.map((b) => b.status)).toEqual([
            "scheduled",
        ]);

        const exported = await admin.page.request.post(`${apiBase()}/v1/consents/export`, {
            headers: headers(admin.page),
        });
        expect(exported.status(), await exported.text()).toBe(200);
        const canceled = await admin.page.request.post(
            `${apiBase()}/v1/broadcasts/${broadcast.id}/cancel`,
            { headers: headers(admin.page) },
        );
        expect(canceled.status(), await canceled.text()).toBe(200);
        const final = await broadcastEvidence(broadcast.id);
        expect(final.broadcasts.map((b) => [b.status, b.recipient_count])).toEqual([
            ["canceled", 0],
        ]);
        expect(final.messages).toEqual([]);
        expect(final.audits.map((a) => [a.action, a.performed_by])).toEqual([
            ["broadcast.send", demoId("us_dev")],
            ["broadcast.cancel", expect.any(String)],
        ]);
        expect(final.audits[1]?.performed_by).not.toBe(demoId("us_dev"));
    } finally {
        await staff.context.close();
        await admin.context.close();
        await cedarOwner.context.close();
    }
});

test("MSG-E2E-16 a broadcast scheduled from the composer counts its audience and a cancel leaves nobody messaged", async ({
    page,
}) => {
    await signIn(page);
    const code = randomUUID().slice(0, 6);
    const tag = `fall-${code}`;
    const agreed = [
        await createContact(page, { consent: true, tags: [tag] }),
        await createContact(page, { consent: true, tags: [tag] }),
    ];
    const unasked = await createContact(page, { tags: [tag] });
    const name = `Fall de-shed offer ${code}`;
    const scheduled = await scheduleBroadcast(page, {
        name,
        tag,
        body: "Book a de-shed this week and we'll add a free nail trim.",
        recipients: 2,
        matched: 3,
    });
    const tomorrow = combineDayAndTime(addDays(new Date(), 1, ZONE), "09:00", ZONE);
    expect(scheduled).toMatchObject({
        status: "scheduled",
        scheduled_at: expect.any(String),
        recipient_count: 2,
        excluded_count: 1,
    });
    expect(new Date(scheduled.scheduled_at ?? "").getTime()).toBe(tomorrow.getTime());
    const before = await broadcastEvidence(scheduled.id);
    expect(before.broadcasts).toEqual([
        {
            id: scheduled.id,
            business_id: demoId("bz_birchbark"),
            name,
            channel: "email",
            status: "scheduled",
            scheduled_at: expect.any(String),
            recipient_count: 2,
            excluded_count: 1,
        },
    ]);
    expect(before.messages).toEqual([]);

    const canceled = await cancelScheduledBroadcast(page, name);
    expect(canceled.status(), await canceled.text()).toBe(200);
    expect(await canceled.json()).toMatchObject({ id: scheduled.id, status: "canceled" });
    const again = await page.request.post(`${apiBase()}/v1/broadcasts/${scheduled.id}/cancel`, {
        headers: headers(page),
    });
    expect(again.status()).toBe(409);
    await page.reload();
    await navigate(page, "/inbox?segment=broadcasts");
    await expect(page.getByRole("button").filter({ hasText: name }).first()).toContainText(
        strings.broadcasts.status.canceled,
        { timeout: 60_000 },
    );
    const after = await broadcastEvidence(scheduled.id);
    expect(after.broadcasts.map((b) => [b.status, b.recipient_count, b.excluded_count])).toEqual([
        ["canceled", 2, 1],
    ]);
    expect(after.messages).toEqual([]);
    expect(after.audits.map((a) => [a.action, a.performed_by])).toEqual([
        ["broadcast.send", demoId("us_dev")],
        ["broadcast.cancel", demoId("us_dev")],
    ]);
    for (const contact of [...agreed, unasked]) {
        expect(await deliveredMail(page.request, contact.email)).toEqual([]);
        expect((await clientOutreach(contact.id)).messages).toEqual([]);
    }
});
