import { randomUUID } from "node:crypto";
import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { documentApi, documentProvider } from "./support/documents";
import { on } from "./support/hosts";
import { links } from "./support/links";
import { ownAddress } from "./support/network";
import { watchErrors } from "./support/errors";

test.beforeEach(async ({ context }, info) => {
    await ownAddress(context, info);
});

test("a client opens an invoice and sees how to pay it", async ({ page }) => {
    const errors = watchErrors(page);
    const pay = strings.publicPay;
    await page.goto(on("pay", `/i/${links.invoice}`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText("#");
    await expect(
        page.getByRole("heading", { name: new RegExp(`^(${pay.cardLabel}|${pay.offlineTitle})$`) }),
    ).toBeVisible();
    expect(errors).toEqual([]);
});

test("a paid or voided invoice says so at the top and asks for nothing", async ({
    page,
    request,
}) => {
    const errors = watchErrors(page);
    const pay = strings.publicPay;
    const provider = await documentProvider(request);
    const write = (path: string, data: unknown) =>
        request.post(`${documentApi}${path}`, {
            headers: { ...provider.headers, "Idempotency-Key": randomUUID() },
            data,
        });
    const issue = async () => {
        const response = await write("/v1/invoices", {
            client_id: provider.clientId,
            send: true,
            lines: [
                {
                    description: "Nail trim",
                    quantity: 1,
                    unit_amount_cents: 1800,
                    tax_class: "exempt",
                },
            ],
        });
        expect(response.status(), await response.text()).toBe(201);
        return (await response.json()) as { id: string; pay_token: string };
    };
    const paid = await issue();
    const recorded = await write(`/v1/invoices/${paid.id}/payments`, {
        method: "cash",
        amount_cents: 1800,
        send_receipt: false,
    });
    expect(recorded.status(), await recorded.text()).toBe(201);
    const voided = await issue();
    expect((await write(`/v1/invoices/${voided.id}/void`, {})).status()).toBe(200);
    const dueLead = (pay.dueOn("~").split("~")[0] ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const due = new RegExp(`^${dueLead}`);
    for (const [invoice, status] of [
        [paid, pay.paidInFull],
        [voided, pay.closed],
    ] as const) {
        await page.goto(on("pay", `/i/${invoice.pay_token}`));
        await expect(page.getByText(status, { exact: true })).toBeVisible();
        await expect(page.getByText(due)).toHaveCount(0);
        await expect(page.getByRole("button", { name: pay.payByCard, exact: true })).toHaveCount(0);
    }
    expect(errors).toEqual([]);
});
