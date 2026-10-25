import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import {
    careMessage,
    composeMessage,
    expectMail,
    expectMessageCommitted,
    expectMessageReplica,
    inboxMail,
    messageEvidence,
    messageFixture,
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
