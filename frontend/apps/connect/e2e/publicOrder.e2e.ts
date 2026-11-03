import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { runUrl } from "@clientbridge/config/e2e/run";
import { on } from "./support/hosts";
import { links } from "./support/links";
import { ownAddress, rewrite } from "./support/network";

test.beforeEach(async ({ context }, info) => {
    await ownAddress(context, info);
});

test("the order page shows a tax row only when the order charged tax", async ({ browser }) => {
    const s = strings.publicOrder;
    const orderPage = on("shop", `/order/${links.order}`);
    const charged = await browser.newContext();
    const taxed = await charged.newPage();
    await taxed.route(`${runUrl("VITE_API_URL")}/order/${links.order}*`, (route) =>
        rewrite(route, (body) => ({ ...body, tax_total_cents: 288 })),
    );
    await taxed.goto(orderPage);
    await expect(taxed.getByText(s.tax, { exact: true })).toHaveCount(1);
    await charged.close();

    const untaxedContext = await browser.newContext();
    const untaxed = await untaxedContext.newPage();
    await untaxed.route(`${runUrl("VITE_API_URL")}/order/${links.order}*`, (route) =>
        rewrite(route, (body) => ({ ...body, tax_total_cents: 0 })),
    );
    await untaxed.goto(orderPage);
    await expect(untaxed.getByText(s.total, { exact: true })).toBeVisible();
    await expect(untaxed.getByText(s.tax, { exact: true })).toHaveCount(0);
    await untaxedContext.close();
});
