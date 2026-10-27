import { formatMoney, strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { on } from "./hosts";
import { links } from "./links";
import { ownAddress } from "./network";
import { documentApi, estimateEvidence, issueEstimate } from "./documents";
import { watchErrors } from "./errors";

test.beforeEach(async ({ context }, info) => {
    await ownAddress(context, info);
});

test("a client reads an estimate and a receipt", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(on("pay", `/e/${links.estimate}`));
    await expect(
        page.getByRole("button", { name: new RegExp(`^${strings.publicEstimate.acceptFor("")}`) }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: strings.publicEstimate.decline })).toBeVisible();
    await page.goto(on("pay", `/r/${links.receipt}`));
    await expect(page.getByRole("button", { name: strings.publicReceipt.print })).toBeVisible();
    expect(errors).toEqual([]);
});

test("DOC-E2E-06 a ticked add-on is shown and accepted at the same discounted total", async ({
    page,
    request,
}) => {
    const pe = strings.publicEstimate;
    const money = (cents: number) => formatMoney(cents, "CAD");
    const issued = await issueEstimate(request);
    await page.goto(on("pay", `/e/${issued.token}`));
    // $100 less 10% plus 5% GST
    const accept = page.getByRole("button", { name: pe.acceptFor(money(9450)), exact: true });
    await expect(accept).toBeVisible();
    const quoted = page.waitForResponse(
        (response) =>
            response.url().includes(`/estimate/${issued.token}?`) && response.status() === 200,
    );
    await page.getByRole("checkbox", { name: "De-shedding treatment" }).check();
    await quoted;
    // $200 less 10% is $180, plus $9 GST
    const both = page.getByRole("button", { name: pe.acceptFor(money(18900)), exact: true });
    await expect(both).toBeVisible();
    await expect(page.getByText(money(18000), { exact: true })).toBeVisible();
    expect(await estimateEvidence(issued.id)).toMatchObject({ status: "sent", total_cents: 9450 });
    await both.click();
    await expect(page.getByRole("heading", { name: pe.acceptedTitle })).toBeVisible();
    const saved = await estimateEvidence(issued.id);
    expect(saved).toMatchObject({
        status: "accepted",
        subtotal_cents: 18000,
        tax_total_cents: 900,
        total_cents: 18900,
    });
    expect(saved.lines).toEqual([
        expect.objectContaining({ optional: false, amount_cents: 9000, sale_discount_cents: 1000 }),
        expect.objectContaining({
            optional: true,
            selected: true,
            amount_cents: 9000,
            sale_discount_cents: 1000,
        }),
    ]);
    await page.reload();
    await expect(page.getByRole("heading", { name: pe.acceptedTitle })).toBeVisible();
    await expect(page.getByText(money(18900), { exact: true }).first()).toBeVisible();
    const replay = await request.post(`${documentApi}/estimate/${issued.token}/accept`, {
        data: { line_ids: [], total_cents: 9450 },
    });
    expect(replay.status()).toBe(409);
    expect(await estimateEvidence(issued.id)).toEqual(saved);
});
