import { formatMoney, formatPhone, strings } from "@clientbridge/app-core/public";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { paymentEvidence } from "./support/evidence";
import {
    composeDocument,
    createDocumentClient,
    documentEvidence,
    fillDocumentLine,
    openDocument,
    saveDocument,
} from "./support/billing";
import { textInbox, textsTo } from "./support/auth";
import { deliveredTexts } from "./support/messaging";
import { signIn } from "./support/session";
import { runEmail } from "@clientbridge/config/e2e/run";

interface Preview {
    recipient: string | null;
    text: { to: string; body: string } | null;
}

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function reviewSend(
    page: Page,
    action: string,
    previewPath: string,
): Promise<{ review: Locator; preview: Preview }> {
    const loaded = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === previewPath &&
            response.request().method() === "GET",
    );
    await page.getByRole("button", { name: action, exact: true }).click();
    const response = await loaded;
    expect(response.status(), await response.text()).toBe(200);
    const preview = (await response.json()) as Preview;
    const review = page.getByRole("dialog").filter({
        has: page.getByRole("heading", { name: strings.previews.title, exact: true }),
    });
    const text = preview.text;
    if (text === null) throw new Error("The preview shows no text");
    await expect(review.getByText(strings.ui.review.to(preview.recipient ?? ""))).toBeVisible();
    await expect(
        review.getByText(strings.ui.review.textTo(formatPhone(text.to)), { exact: true }),
    ).toBeVisible();
    for (const line of text.body.split("\n").filter((part) => part.trim() !== ""))
        await expect(review).toContainText(line);
    return { review, preview };
}

test("BILL-DOC-04 the send preview shows word for word the invoice and reminder texts that arrive", async ({
    page,
}, testInfo) => {
    await signIn(page);
    const client = await createDocumentClient(page);
    const editor = await composeDocument(page, client, "invoice");
    await fillDocumentLine(page, editor, 0, "Deshedding treatment", "1", "40.00", "standard");
    const draft = await saveDocument(page, editor, "invoice");
    // CAD40 plus 5% GST and 7% PST
    expect(draft).toMatchObject({ status: "draft", number: null, total_cents: 4480 });
    await editor.getByRole("button", { name: strings.common.close, exact: true }).click();
    await openDocument(page, client, "invoice", draft.id);
    const sending = await reviewSend(
        page,
        strings.billing.sendInvoice,
        `/v1/previews/invoices/${draft.id}/send`,
    );
    const sendPreview = sending.preview;
    expect(sendPreview.recipient).toBe(client.name);
    expect(sendPreview.text?.to).toBe(client.phone);
    const promised = /^Invoice #(\d+) for /.exec(sendPreview.text?.body ?? "");
    expect(promised).not.toBeNull();
    expect((await documentEvidence("invoice", draft.id)).document).toMatchObject({
        status: "draft",
        number: null,
    });
    expect(await textsTo(page.request, client.phone)).toEqual([]);
    const sent = page.waitForResponse(
        (response) =>
            response.url().endsWith(`/v1/invoices/${draft.id}/send`) &&
            response.request().method() === "POST",
    );
    await sending.review
        .getByRole("button", { name: strings.billing.sendInvoice, exact: true })
        .click();
    const sentResponse = await sent;
    expect(sentResponse.status(), await sentResponse.text()).toBe(200);
    const issued = (await sentResponse.json()) as { number: number; status: string };
    expect(issued.status).toBe("sent");
    expect(String(issued.number)).toBe(promised?.[1]);
    await expect
        .poll(async () => (await textsTo(page.request, client.phone)).length, {
            timeout: 30_000,
        })
        .toBe(1);
    const [invoiceText] = await deliveredTexts(page.request, client.phone);
    expect(invoiceText?.to).toEqual([textInbox(client.phone)]);
    // a draft's pay link is minted only when it goes out, so the preview holds its place
    const [before, after, ...rest] = (sendPreview.text?.body ?? "").split("…");
    expect(rest).toEqual([]);
    expect(before).toContain(formatMoney(4480, "CAD"));
    expect(invoiceText?.text).toMatch(
        new RegExp(`^${escape(before ?? "")}[A-Za-z0-9_-]{16,}${escape(after ?? "")}$`),
    );

    await openDocument(page, client, "invoice", draft.id);
    const canceled = await reviewSend(
        page,
        strings.billing.remind,
        `/v1/previews/invoices/${draft.id}/remind`,
    );
    await canceled.review.getByRole("button", { name: strings.common.cancel, exact: true }).click();
    await expect(canceled.review).toBeHidden();
    const reminding = await reviewSend(
        page,
        strings.billing.remind,
        `/v1/previews/invoices/${draft.id}/remind`,
    );
    const remindPreview = reminding.preview;
    expect(remindPreview.text).toEqual({
        to: client.phone,
        body: expect.stringContaining(`invoice #${String(issued.number)}`),
    });
    expect(remindPreview.text?.body).toContain(formatMoney(4480, "CAD"));
    expect(remindPreview.text?.body).not.toContain("…");
    expect(await textsTo(page.request, client.phone)).toHaveLength(1);
    const reminded = page.waitForResponse(
        (response) =>
            response.url().endsWith(`/v1/invoices/${draft.id}/remind`) &&
            response.request().method() === "POST",
    );
    await reminding.review
        .getByRole("button", { name: strings.previews.sendReminder, exact: true })
        .click();
    expect((await reminded).status()).toBe(200);
    await expect
        .poll(async () => (await textsTo(page.request, client.phone)).length, {
            timeout: 30_000,
        })
        .toBe(2);
    const delivered = await deliveredTexts(page.request, client.phone);
    expect(delivered).toEqual([
        invoiceText,
        {
            id: expect.any(String),
            to: [textInbox(client.phone)],
            text: remindPreview.text?.body,
        },
    ]);
    // the reminder carries the same pay link the invoice text minted
    const link = /https?:\/\/\S+\/i\/[A-Za-z0-9_-]+/.exec(invoiceText?.text ?? "")?.[0];
    expect(link).toBeTruthy();
    expect(delivered[1]?.text).toContain(link);
    const ledger = await paymentEvidence(draft.id);
    expect(ledger.payments).toEqual([]);
    expect(ledger.deliveries).toEqual([]);
    expect((await documentEvidence("invoice", draft.id)).document).toMatchObject({
        status: "sent",
        number: issued.number,
    });
    await testInfo.attach("previews-and-texts", {
        body: JSON.stringify({ sendPreview, remindPreview, delivered }),
        contentType: "application/json",
    });
});

test("BILL-DOC-20 retry after a lost estimate send response texts the estimate once", async ({
    page,
}, testInfo) => {
    await signIn(page);
    const client = await createDocumentClient(page);
    const editor = await composeDocument(page, client, "estimate");
    await fillDocumentLine(page, editor, 0, "Deshedding treatment", "1", "40.00", "standard");
    const draft = await saveDocument(page, editor, "estimate");
    // CAD40 plus 5% GST and 7% PST
    expect(draft).toMatchObject({ status: "draft", number: null, total_cents: 4480 });
    await editor.getByRole("button", { name: strings.common.close, exact: true }).click();
    await openDocument(page, client, "estimate", draft.id);
    const keys: (string | undefined)[] = [];
    await page.route(`**/v1/estimates/${draft.id}/send`, async (route) => {
        keys.push(route.request().headers()["idempotency-key"]);
        const committed = await route.fetch();
        expect(committed.status()).toBe(200);
        if (keys.length === 1) await route.abort("connectionreset");
        else await route.fulfill({ response: committed });
    });
    const confirm = new RegExp(
        `^(${escape(strings.billing.sendEstimate)}|${escape(strings.previews.sendAgain)})$`,
    );
    const send = async (): Promise<void> => {
        const { review } = await reviewSend(
            page,
            strings.billing.sendEstimate,
            `/v1/previews/estimates/${draft.id}/send`,
        );
        await review.getByRole("button", { name: confirm }).click();
    };

    await send();
    await expect(page.getByText(strings.billing.actionError, { exact: true })).toBeVisible();
    const committed = (await documentEvidence("estimate", draft.id)).document;
    expect(committed).toMatchObject({ status: "sent", number: expect.any(Number) });
    await expect
        .poll(async () => (await textsTo(page.request, client.phone)).length, {
            timeout: 30_000,
        })
        .toBe(1);

    await send();
    await expect(
        page.getByText(strings.billing.estimateSentTo(committed.number ?? 0, client.name), {
            exact: true,
        }),
    ).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect((await documentEvidence("estimate", draft.id)).document).toEqual(committed);
    const delivered = await deliveredTexts(page.request, client.phone);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.text).toContain(`#${String(committed.number)}`);
    await testInfo.attach("estimate-send", {
        body: JSON.stringify({ keys, committed, delivered }),
        contentType: "application/json",
    });
});

const r = strings.ui.review;
const p = strings.previews;

test("a reminder shows the message before it goes out, and cancelling sends nothing", async ({
    page,
}) => {
    test.setTimeout(180_000);
    const sends: string[] = [];
    page.on("request", (req) => {
        if (req.method() === "POST" && /\/v1\/invoices\/[^/]+\/(remind|send)$/.test(req.url()))
            sends.push(req.url());
    });
    await page.goto("/today");
    await page
        .getByRole("textbox", { name: strings.auth.email, exact: true })
        .fill(runEmail("hannah@birchbark.example"));
    await page.getByLabel(strings.auth.password, { exact: true }).fill("demo1234");
    await page.getByRole("button", { name: strings.auth.signIn, exact: true }).click();
    const main = page.getByRole("main");
    await main
        .getByRole("button", { name: strings.today.attention.overdueAction })
        .first()
        .click({ timeout: 60_000 });
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText(p.title)).toBeVisible();
    await expect(sheet.getByText(new RegExp(`^${r.textTo("").trim()}`))).toBeVisible();
    await expect(sheet.getByRole("button", { name: p.sendReminder })).toBeEnabled();
    await sheet.getByRole("button", { name: strings.common.cancel }).click();
    await expect(page.getByText(p.title)).toHaveCount(0);
    expect(sends).toEqual([]);
});
