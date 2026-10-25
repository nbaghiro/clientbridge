import { formatMoney, strings } from "@clientbridge/app-core/public";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { paymentEvidence } from "./support/evidence";
import {
    composeDocument,
    createDocumentClient,
    documentEvidence,
    fillDocumentLine,
    openDocument,
    saveDocument,
} from "./support/invoices";
import { deliveredMail, inboxMail } from "./support/messaging";
import { signIn } from "./support/session";

interface Preview {
    recipient: string | null;
    email: { to: string; subject: string; body: string } | null;
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
    const email = preview.email;
    if (email === null) throw new Error("The preview shows no email");
    await expect(review.getByText(strings.ui.review.to(preview.recipient ?? ""))).toBeVisible();
    await expect(
        review.getByText(strings.ui.review.emailTo(email.to), { exact: true }),
    ).toBeVisible();
    await expect(review.getByText(email.subject, { exact: true })).toBeVisible();
    for (const line of email.body.split("\n").filter((part) => part.trim() !== ""))
        await expect(review).toContainText(line);
    return { review, preview };
}

test("BILL-DOC-04 the send preview shows word for word the invoice and reminder emails that arrive", async ({
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
    expect(sendPreview.text).toBeNull();
    expect(sendPreview.email?.to).toBe(client.email);
    const promised = /^Invoice #(\d+) from Birchbark Pet Studio$/.exec(
        sendPreview.email?.subject ?? "",
    );
    expect(promised).not.toBeNull();
    expect((await documentEvidence("invoice", draft.id)).document).toMatchObject({
        status: "draft",
        number: null,
    });
    expect(await inboxMail(page.request, client.email)).toEqual([]);
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
        .poll(async () => (await inboxMail(page.request, client.email)).length, {
            timeout: 30_000,
        })
        .toBe(1);
    const [invoiceMail] = await deliveredMail(page.request, client.email);
    expect(invoiceMail?.to).toEqual([client.email]);
    expect(invoiceMail?.subject).toBe(sendPreview.email?.subject);
    // a draft's pay link is minted only when it goes out, so the preview holds its place
    const [before, after, ...rest] = (sendPreview.email?.body ?? "").split("…");
    expect(rest).toEqual([]);
    expect(before).toContain(formatMoney(4480, "CAD"));
    expect(invoiceMail?.text).toMatch(
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
    expect(remindPreview.text).toBeNull();
    expect(remindPreview.email).toEqual({
        to: client.email,
        subject: `Reminder: invoice #${String(issued.number)} from Birchbark Pet Studio`,
        body: expect.stringContaining(formatMoney(4480, "CAD")),
    });
    expect(remindPreview.email?.body).not.toContain("…");
    expect(await inboxMail(page.request, client.email)).toHaveLength(1);
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
        .poll(async () => (await inboxMail(page.request, client.email)).length, {
            timeout: 30_000,
        })
        .toBe(2);
    const delivered = await deliveredMail(page.request, client.email);
    expect(delivered).toEqual([
        invoiceMail,
        {
            id: expect.any(String),
            to: [client.email],
            subject: remindPreview.email?.subject,
            text: remindPreview.email?.body,
        },
    ]);
    // the reminder carries the same pay link the invoice email minted
    const link = /https?:\/\/\S+\/i\/[A-Za-z0-9_-]+/.exec(invoiceMail?.text ?? "")?.[0];
    expect(link).toBeTruthy();
    expect(delivered[1]?.text).toContain(link);
    const ledger = await paymentEvidence(draft.id);
    expect(ledger.payments).toEqual([]);
    expect(ledger.deliveries).toEqual([]);
    expect((await documentEvidence("invoice", draft.id)).document).toMatchObject({
        status: "sent",
        number: issued.number,
    });
    await testInfo.attach("previews-and-mail", {
        body: JSON.stringify({ sendPreview, remindPreview, delivered }),
        contentType: "application/json",
    });
});
