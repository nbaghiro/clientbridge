import { randomUUID } from "node:crypto";
import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";

import { mailedCode, newAccount } from "./identity";
import { bookingApi } from "./support/bookings";
import { createClient, openClient } from "./support/crm";
import { businessEvidence } from "./support/onboarding";
import { payCash, ringCash, saleEvidence, stockProduct } from "./support/sales";
import { navigate } from "./support/session";

const a = strings.auth;
const o = strings.business.onboarding;

test("ID-E2E-01 a Nova Scotia pet groomer's signup sets its zone, tax and subject on every device", async ({
    page,
    browser,
    request,
}, testInfo) => {
    test.setTimeout(240_000);
    const account = newAccount("onboard-ns");
    await page.goto("/signup");
    await page.getByLabel(a.name, { exact: true }).fill(account.name);
    await page.getByRole("textbox", { name: a.email, exact: true }).fill(account.email);
    await page.getByLabel(a.newPassword, { exact: true }).fill(account.password);
    await page.getByRole("button", { name: a.createAccount, exact: true }).click();
    await expect(page.getByRole("heading", { name: a.verifyTitle })).toBeVisible();
    const code = await mailedCode(request, account.email, "verification");
    const wrong = code.replace(/\d$/, (digit) => String((Number(digit) + 1) % 10));
    await page.getByLabel(a.code, { exact: true }).fill(wrong);
    await page.getByRole("button", { name: a.verify, exact: true }).click();
    await expect(page.getByText(a.flowMessages[4070006], { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: o.title })).toHaveCount(0);
    await page.getByLabel(a.code, { exact: true }).fill(code);
    await page.getByRole("button", { name: a.verify, exact: true }).click();

    await expect(page.getByRole("heading", { name: o.title })).toBeVisible();
    const name = `${account.name} Pet Spa`;
    await page.getByLabel(o.businessName, { exact: true }).fill(name);
    await page.getByRole("combobox", { name: o.province }).click();
    await page
        .getByRole("listbox", { name: o.province })
        .getByRole("option", { name: o.provinceNS, exact: true })
        .click();
    await expect(page.getByText(`${o.taxTitle(o.provinceNS)}: HST 14%`)).toBeVisible();
    await page.getByRole("combobox", { name: o.industryLabel }).click();
    await page
        .getByRole("listbox", { name: o.industryLabel })
        .getByRole("option", { name: o.industry("petGrooming"), exact: true })
        .click();
    const onboarding = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/v1/onboarding" && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: o.createBusiness, exact: true }).click();
    const created = await onboarding;
    expect(created.status(), await created.text()).toBe(201);
    expect(created.request().postDataJSON()).toMatchObject({
        province: "NS",
        subject: "pet",
        timezone: null,
    });
    const businessId = ((await created.json()) as { id: string }).id;
    const menu = page
        .locator("aside")
        .getByRole("link", { name: strings.navigation.businessMenu, exact: true });
    await expect(menu).toBeVisible({ timeout: 60_000 });

    const opened = await businessEvidence(businessId);
    expect(opened.business).toEqual([
        {
            id: businessId,
            name,
            slug: expect.any(String),
            province: "NS",
            timezone: "America/Halifax",
            subject: "pet",
            status: "active",
            plan: null,
            plan_status: "trialing",
            tax_registered: false,
            trial_seconds: 14 * 24 * 60 * 60,
        },
    ]);
    expect(opened.staff).toEqual([
        {
            id: expect.any(String),
            role: "owner",
            status: "active",
            payee: true,
            email: account.email,
            linked: true,
        },
    ]);

    await navigate(page, "/setup/business");
    await expect(
        page.getByRole("combobox", { name: strings.business.timezoneLabel, exact: true }),
    ).toContainText(strings.business.timeZones.atlantic, { timeout: 60_000 });
    const client = await createClient(page);
    const record = await openClient(page, client);
    await expect(
        record.getByRole("button", { name: strings.subjects.add("pet"), exact: true }),
    ).toBeVisible();
    await expect(
        record.getByRole("button", { name: strings.subjects.add("vehicle"), exact: true }),
    ).toHaveCount(0);

    const registered = await page.request.patch(`${bookingApi()}/v1/business`, {
        headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
        data: { tax_registered: true },
    });
    expect(registered.status(), await registered.text()).toBe(200);
    const product = await stockProduct(page, {
        name: "Salmon dog treats",
        prefix: "NS-TR",
        priceCents: 2000,
        taxClass: "standard",
        stock: 4,
    });
    const payment = await ringCash(page, {
        product,
        stock: 4,
        taps: 1,
        client,
        charge: "$22.80",
        given: "25.00",
    });
    const paid = await payCash(page, payment, "$22.80");
    expect(paid).toMatchObject({ amount_cents: 2280, change_cents: 220 });
    const sale = await saleEvidence(product.id);
    expect(sale.orders).toEqual([
        expect.objectContaining({
            client_id: client.id,
            subtotal_cents: 2000,
            tax_total_cents: 280,
            total_cents: 2280,
            paid: true,
        }),
    ]);
    expect(
        sale.entries
            .map(({ category, amount_cents }) => ({ category, amount_cents }))
            .sort((x, y) => x.category.localeCompare(y.category)),
    ).toEqual([
        { category: "cash", amount_cents: 2280 },
        { category: "revenue", amount_cents: -2000 },
        { category: "tax", amount_cents: -280 },
    ]);

    await page.reload();
    await expect(menu).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: o.title })).toHaveCount(0);
    const second = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
        const other = await second.newPage();
        await other.addInitScript((title) => {
            new MutationObserver(() => {
                if ([...document.querySelectorAll("h1")].some((h) => h.textContent === title))
                    sessionStorage.setItem("onboarding-flashed", "yes");
            }).observe(document, { subtree: true, childList: true });
        }, o.title);
        await other.goto("/");
        await other.getByRole("textbox", { name: a.email, exact: true }).fill(account.email);
        await other.getByLabel(a.password, { exact: true }).fill(account.password);
        await other.getByRole("button", { name: a.signIn, exact: true }).click();
        await expect(other).toHaveURL(/\/today$/, { timeout: 60_000 });
        await navigate(other, "/setup/business");
        await expect(
            other.getByRole("textbox", { name: strings.business.nameLabel, exact: true }),
        ).toHaveValue(name, { timeout: 60_000 });
        await expect(
            other.getByRole("combobox", { name: strings.business.timezoneLabel, exact: true }),
        ).toContainText(strings.business.timeZones.atlantic);
        expect(await other.evaluate(() => sessionStorage.getItem("onboarding-flashed"))).toBeNull();
    } finally {
        await second.close();
    }
    const final = await businessEvidence(businessId);
    expect(final.business[0]).toMatchObject({ timezone: "America/Halifax", subject: "pet" });
    expect(final.staff).toEqual(opened.staff);
    await testInfo.attach("onboarded-business", {
        body: JSON.stringify({ final, sale }),
        contentType: "application/json",
    });
});
