import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
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
} from "./support/messaging";
import { signIn } from "./support/session";

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
