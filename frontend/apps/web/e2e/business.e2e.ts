import { randomUUID } from "node:crypto";
import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { mailedCode, newAccount } from "./support/auth";
import { bookingApi } from "./support/bookings";
import { createClient, openClient } from "./support/clients";
import {
    brandAsset,
    brandControls,
    businessEvidence,
    connectUrl,
    expectBranded,
    newBusiness,
    patchBusiness,
    payLink,
    storedBrand,
} from "./support/business";
import { payCash, ringCash, saleEvidence, stockProduct } from "./support/pos";
import { navigate } from "./support/session";

const a = strings.auth;
const o = strings.business.onboarding;
const b = strings.business;
const g = strings.business.getSetUp;
const PLUM = "#7D5A82";

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

test("CFG-E2E-05 brand colour, logo and cover set in Setup reach the business, booking, shop and pay pages", async ({
    page,
    request,
}) => {
    test.setTimeout(240_000);
    const business = await newBusiness(page, request, "brand-reach", "petGrooming");
    await navigate(page, "/setup/business");
    const brand = await brandControls(page, business.name);
    await brand.upload(brand.logo, {
        name: "logo.png",
        mimeType: "image/png",
        buffer: await brandAsset("logo.png"),
    });
    await brand.upload(brand.cover, {
        name: "cover.jpg",
        mimeType: "image/jpeg",
        buffer: await brandAsset("face_cl_regular_15.jpg"),
    });
    await brand.colour(g.colourNames.plum).click();
    await brand.tagline.fill("Calm hands, kind prices");
    await brand.save.click();
    await expect(page.getByText(g.saved, { exact: true })).toBeVisible();
    const stored = await storedBrand(business.id);
    expect(stored).toMatchObject({
        primary: PLUM,
        tagline: "Calm hands, kind prices",
        logo_file_id: expect.stringMatching(/^fl_/),
        cover_file_id: expect.stringMatching(/^fl_/),
    });
    const pay = await payLink(page);
    const wanted = { name: business.name, colour: PLUM };
    await expectBranded(page, connectUrl(business.slug), wanted);
    await expect(page.getByText("Calm hands, kind prices")).toBeVisible();
    await expect(
        page.locator(`header img[src$="/media/${stored.cover_file_id as string}"]`),
    ).toBeVisible();
    await expectBranded(page, connectUrl("book", business.slug), wanted);
    await expectBranded(page, connectUrl("shop", business.slug), wanted);
    await expectBranded(page, pay, wanted);
});

test("CFG-E2E-06 province changes until a document charges tax, then locks with a reason; a client-only business shows no subject fields", async ({
    page,
    request,
}) => {
    test.setTimeout(240_000);
    const t = strings.taxes;
    const business = await newBusiness(page, request, "province-lock");
    await navigate(page, "/setup/taxes");
    const province = page.getByRole("combobox", { name: t.province, exact: true });
    await expect(province).toContainText(o.provinceBC, { timeout: 60_000 });
    const change = page.getByRole("button", { name: t.provinceChange, exact: true });

    await province.click();
    await page.getByRole("option", { name: o.provinceON, exact: true }).click();
    await change.click();
    const confirm = page.getByRole("dialog");
    await expect(confirm.getByText(t.provinceConfirmBody(o.provinceON))).toBeVisible();
    await confirm.getByRole("button", { name: strings.common.cancel, exact: true }).click();
    await expect(province).toContainText(o.provinceBC);
    await expect(change).toBeDisabled();

    await province.click();
    await page.getByRole("option", { name: o.provinceON, exact: true }).click();
    await change.click();
    await confirm.getByRole("button", { name: t.provinceChange, exact: true }).click();
    await expect
        .poll(async () => (await businessEvidence(business.id)).business[0]?.province)
        .toBe("ON");
    expect((await businessEvidence(business.id)).business[0]?.timezone).toBe("America/Vancouver");
    await navigate(page, "/setup/business");
    await expect(page.getByText(b.legalAddress.provinceHint, { exact: true })).toBeVisible({
        timeout: 60_000,
    });

    expect((await patchBusiness(page, { tax_registered: true })).status()).toBe(200);
    const client = await createClient(page);
    const record = await openClient(page, client);
    await expect(
        record.getByRole("button", { name: /^Add (pet|vehicle|student|property|site)/ }),
    ).toHaveCount(0);
    const product = await stockProduct(page, {
        name: "Sea salt soap",
        prefix: "LOCK",
        priceCents: 2000,
        taxClass: "standard",
        stock: 4,
    });
    const payment = await ringCash(page, {
        product,
        stock: 4,
        taps: 1,
        client,
        charge: "$22.60",
        given: "25.00",
    });
    await payCash(page, payment, "$22.60");

    await navigate(page, "/setup/taxes");
    await expect(page.getByText(t.provinceLocked, { exact: true })).toBeVisible({
        timeout: 60_000,
    });
    await expect(province).toHaveCount(0);
    await navigate(page, "/setup/business");
    await expect(page.getByText(t.provinceLocked, { exact: true })).toBeVisible();
    const refused = await patchBusiness(page, { province: "BC" });
    expect(refused.status()).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe("province_locked");
});

const SVG = {
    sized: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#7D5A82"/></svg>`,
    viewBoxOnly: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><rect width="300" height="100" fill="#2E6670"/></svg>`,
    bare: `<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="#A95C43"/></svg>`,
    scripted: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" onload="window.ran=1"><script>window.ran=1</script><rect width="64" height="64" fill="#3F5E80"/></svg>`,
};

test(
    "CFG-E2E-07 an SVG logo is stored as a PNG in every browser, and a broken one is refused",
    { tag: "@browsers" },
    async ({ page, request }) => {
        test.setTimeout(240_000);
        const business = await newBusiness(page, request, "svg-logo");
        await navigate(page, "/setup/business");
        const brand = await brandControls(page, business.name);
        const logoImage = page.locator(`img[src*="/media/"]`).first();
        for (const [name, svg] of Object.entries(SVG)) {
            const minted = page.waitForResponse(
                (r) => new URL(r.url()).pathname === "/v1/files" && r.request().method() === "POST",
            );
            await brand.upload(brand.logo, {
                name: `${name}.svg`,
                mimeType: "image/svg+xml",
                buffer: Buffer.from(svg),
            });
            const body = (await minted).request().postDataJSON() as { content_type: string };
            expect(body.content_type, name).toBe("image/png");
            await expect
                .poll(() => logoImage.evaluate((img: HTMLImageElement) => img.naturalWidth), {
                    message: name,
                })
                .toBeGreaterThan(0);
            const media = await page.request.get((await logoImage.getAttribute("src")) ?? "", {
                headers: { Origin: new URL(page.url()).origin },
            });
            expect(media.headers()["content-type"], name).toBe("image/png");
            expect((await media.body()).subarray(1, 4).toString(), name).toBe("PNG");
        }
        expect(await page.evaluate(() => "ran" in window)).toBe(false);
        await brand.logo.setInputFiles({
            name: "broken.svg",
            mimeType: "image/svg+xml",
            buffer: Buffer.from("<svg><not closed"),
        });
        await expect(
            page.getByText(strings.api.fileTypeUnsupported, { exact: true }),
        ).toBeVisible();
    },
);

test("CFG-E2E-08 slow uploads keep edits, each Save says what it saves, leaving asks first and an older draft erases nothing", async ({
    page,
    request,
}) => {
    test.setTimeout(240_000);
    const business = await newBusiness(page, request, "brand-draft");
    await navigate(page, "/setup/business");
    const brand = await brandControls(page, business.name);

    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    await page.route("**/v1/files/*/complete", async (route) => {
        await held;
        await route.continue();
    });
    await brand.logo.setInputFiles({
        name: "logo.png",
        mimeType: "image/png",
        buffer: await brandAsset("logo.png"),
    });
    await brand.tagline.fill("Typed during the upload");
    await brand.colour(g.colourNames.plum).click();
    release();
    await expect(page.getByRole("button", { name: strings.files.removeLogo })).toBeVisible();
    await page.unroute("**/v1/files/*/complete");
    await expect(brand.tagline).toHaveValue("Typed during the upload");
    await expect(brand.colour(g.colourNames.plum)).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText(g.unsaved, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: b.saveDetails, exact: true }).click();
    await expect(page.getByText(strings.common.saved, { exact: true })).toBeVisible();
    await expect(page.getByText(g.unsaved, { exact: true })).toBeVisible();
    expect(await storedBrand(business.id)).not.toHaveProperty("logo_file_id");

    const setupLink = page
        .getByRole("navigation", { name: strings.navigation.setup })
        .getByRole("link", { name: strings.navigation.setupSections.team, exact: true });
    await setupLink.click();
    const leaving = page.getByRole("dialog");
    await expect(leaving.getByText(b.leaveTitle, { exact: true })).toBeVisible();
    await leaving.getByRole("button", { name: b.keepEditing, exact: true }).click();
    await expect(page).toHaveURL(/\/setup\/business/);
    await expect(brand.tagline).toHaveValue("Typed during the upload");

    expect(
        (await patchBusiness(page, { brand: { website: "https://elsewhere.example" } })).status(),
    ).toBe(200);
    await brand.save.click();
    await expect(page.getByText(g.saved, { exact: true })).toBeVisible();
    await expect(page.getByText(g.unsaved, { exact: true })).toHaveCount(0);
    expect(await storedBrand(business.id)).toMatchObject({
        website: "https://elsewhere.example",
        tagline: "Typed during the upload",
        primary: PLUM,
        logo_file_id: expect.any(String),
    });

    await setupLink.click();
    await expect(page).toHaveURL(/\/setup\/team/);
    await page
        .getByRole("navigation", { name: strings.navigation.setup })
        .getByRole("link", { name: strings.navigation.setupSections.business, exact: true })
        .click();
    await expect(page.getByLabel(new RegExp(`^${g.tagline}`))).toHaveValue(
        "Typed during the upload",
        { timeout: 60_000 },
    );
    await page.getByRole("button", { name: strings.files.removeLogo, exact: true }).click();
    await page.getByRole("button", { name: g.save, exact: true }).click();
    await expect(page.getByText(g.saved, { exact: true })).toBeVisible();
    expect(await storedBrand(business.id)).not.toHaveProperty("logo_file_id");
});

test("CFG-E2E-09 refused settings and files say why, and a name can't be blank or endless", async ({
    page,
    request,
}) => {
    test.setTimeout(240_000);
    const business = await newBusiness(page, request, "brand-refused");
    await navigate(page, "/setup/business");
    const brand = await brandControls(page, business.name);
    const website = page.getByLabel(g.profile.website, { exact: true });
    await website.fill("not a link");
    await brand.save.click();
    await expect(page.getByText(b.fieldErrors.website, { exact: true })).toBeVisible();
    await expect(page.getByText(b.checkFields, { exact: true })).toBeVisible();
    await website.fill("https://birch.example");
    await expect(page.getByText(b.fieldErrors.website, { exact: true })).toHaveCount(0);
    await brand.save.click();
    await expect(page.getByText(g.saved, { exact: true })).toBeVisible();

    const details = page.getByRole("button", { name: b.saveDetails, exact: true });
    await page.getByLabel(b.billingEmailLabel, { exact: true }).fill("not-an-email");
    await page.getByLabel(b.legalAddress.postalCode, { exact: true }).fill("12345");
    await details.click();
    await expect(page.getByText(b.fieldErrors.email, { exact: true })).toBeVisible();
    await expect(page.getByText(b.fieldErrors.postalCode, { exact: true })).toBeVisible();
    await page.getByLabel(b.billingEmailLabel, { exact: true }).fill("");
    await page.getByLabel(b.legalAddress.postalCode, { exact: true }).fill("");
    await details.click();
    await expect(page.getByText(strings.common.saved, { exact: true })).toBeVisible();

    await brand.logo.setInputFiles({
        name: "fake.png",
        mimeType: "image/png",
        buffer: Buffer.from("<!doctype html><script>alert(1)</script>"),
    });
    await expect(page.getByText(strings.api.fileTypeUnsupported, { exact: true })).toBeVisible();
    await brand.logo.setInputFiles({
        name: "huge.png",
        mimeType: "image/png",
        buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
    });
    await expect(page.getByText(strings.api.fileTooLarge, { exact: true })).toBeVisible();
    const hosted = await page.request.post(`${bookingApi()}/v1/files`, {
        headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
        data: {
            parent_type: "business",
            parent_id: business.id,
            purpose: "logo",
            content_type: "text/html",
            size: 100,
        },
    });
    expect(hosted.status()).toBe(422);

    await expect(page.getByLabel(b.nameLabel, { exact: true })).toHaveAttribute("maxlength", "100");
    expect((await patchBusiness(page, { name: "   " })).status()).toBe(422);
    expect((await patchBusiness(page, { name: "x".repeat(101) })).status()).toBe(422);
    expect((await businessEvidence(business.id)).business[0]?.name).toBe(business.name);
});

test("CFG-E2E-10 a new business's public page promises nothing it can't keep, and its links forgive capitals", async ({
    page,
    request,
}) => {
    test.setTimeout(240_000);
    const s = strings.publicLanding;
    const business = await newBusiness(page, request, "empty-page");
    await page.goto(connectUrl(business.slug));
    await expect(page.getByRole("heading", { level: 1, name: business.name })).toBeVisible();
    await expect(page).toHaveTitle(business.name);
    await expect(page.getByText(s.noServicesYet, { exact: true })).toBeVisible();
    await expect(page.getByText(s.noServices, { exact: true })).toHaveCount(0);
    await expect(page.getByText(s.visit, { exact: true })).toHaveCount(0);
    await expect(page.getByText(s.policies, { exact: true })).toHaveCount(0);
    await expect(page.getByText(s.lateCancelPolicy, { exact: true })).toHaveCount(0);
    await expect(page.locator("aside")).toHaveCount(0);

    const back = await page.context().newPage();
    await back.goto("/today");
    expect((await patchBusiness(back, { brand: { phone: "250 555 0199" } })).status()).toBe(200);
    await back.close();
    await page.reload();
    await expect(page.getByText(s.noServices, { exact: true })).toBeVisible();
    await expect(
        page.getByRole("button", { name: new RegExp(`^${s.call}`) }).first(),
    ).toBeVisible();

    await page.goto(connectUrl("book", business.slug.toUpperCase()));
    await expect(page.getByText(strings.publicBooking.notFoundTitle, { exact: true })).toHaveCount(
        0,
    );
    await expect(page).toHaveTitle(business.name);
});

test("CFG-E2E-11 hiding the setup list hides Today's guide, and each Start lands on its section", async ({
    page,
    request,
}) => {
    test.setTimeout(240_000);
    const business = await newBusiness(page, request, "first-run");
    const guide = page.getByText(g.gettingStarted, { exact: true });
    await expect(guide).toBeVisible({ timeout: 60_000 });
    await expect(
        page.getByRole("button", { name: strings.today.shareBookingPage, exact: true }),
    ).toHaveCount(0);

    await navigate(page, "/setup/start");
    await expect(page.getByText(g.notLive, { exact: true })).toBeVisible({ timeout: 60_000 });
    await page
        .getByRole("listitem")
        .filter({ hasText: g.tasks.brand.label })
        .getByRole("button", { name: g.tasks.brand.action, exact: true })
        .click();
    await expect(page).toHaveURL(/\/setup\/business#brand$/);
    const brand = await brandControls(page, business.name);
    await expect(page.locator("#brand")).toBeInViewport();
    await brand.save.click();
    await expect(page.getByText(g.saved, { exact: true })).toBeVisible();

    await navigate(page, "/setup/start");
    await expect(
        page
            .getByRole("listitem")
            .filter({ hasText: g.tasks.brand.label })
            .getByRole("button", { name: g.editBrand, exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    await page
        .getByRole("listitem")
        .filter({ hasText: g.tasks.hours.label })
        .getByRole("button", { name: g.tasks.hours.action, exact: true })
        .click();
    await expect(page).toHaveURL(/\/setup\/team#hours$/);
    await expect(page.locator("#hours")).toBeInViewport();

    await navigate(page, "/setup/start");
    await page.getByRole("button", { name: g.hide, exact: true }).click();
    await expect(page.getByRole("button", { name: g.showList, exact: true })).toBeVisible();
    await navigate(page, "/today");
    await expect(page.getByRole("heading", { name: strings.today.collected })).toHaveCount(0);
    await expect(guide).toHaveCount(0);
});

test("CFG-E2E-12 confirming the email from onboarding keeps what was typed and later errors", async ({
    page,
    request,
}) => {
    test.setTimeout(240_000);
    const account = newAccount("keep-form");
    await page.goto("/signup");
    await page.getByLabel(a.name, { exact: true }).fill(account.name);
    await page.getByRole("textbox", { name: a.email, exact: true }).fill(account.email);
    await page.getByLabel(a.newPassword, { exact: true }).fill(account.password);
    await page.getByRole("button", { name: a.createAccount, exact: true }).click();
    await expect(page.getByRole("heading", { name: a.verifyTitle })).toBeVisible();
    const first = await mailedCode(request, account.email, "verification");
    await page.goto("/today");
    const name = `${account.name} Keep`;
    await expect(page.getByRole("heading", { name: o.title })).toBeVisible({ timeout: 60_000 });
    await page.getByLabel(o.businessName, { exact: true }).fill(name);
    await page.getByRole("combobox", { name: o.province }).click();
    await page.getByRole("option", { name: o.provinceAB, exact: true }).click();
    await page.getByRole("combobox", { name: o.industryLabel }).click();
    await page.getByRole("option", { name: o.industry("other"), exact: true }).click();
    await page.getByRole("button", { name: o.createBusiness, exact: true }).click();
    await expect(page.getByText(o.verifyFirst, { exact: true })).toBeVisible();

    const code = await mailedCode(request, account.email, "verification", first);
    await page.getByLabel(a.code, { exact: true }).fill(code);
    await page.getByRole("button", { name: a.verify, exact: true }).click();
    await expect(page.getByText(a.verifyDone, { exact: true })).toBeVisible();
    await expect(page.getByText(o.verifyFirst, { exact: true })).toHaveCount(0);
    await expect(page.getByLabel(o.businessName, { exact: true })).toHaveValue(name);
    await expect(page.getByRole("combobox", { name: o.province })).toContainText(o.provinceAB);

    const address = page.getByLabel(o.webAddress, { exact: true });
    await address.fill("admin");
    await page.getByRole("button", { name: o.createBusiness, exact: true }).click();
    await expect(page.getByText(strings.api.slugReserved, { exact: true })).toBeVisible();

    await address.fill(`keep-${randomUUID().slice(0, 8)}`);
    await page.getByRole("button", { name: o.createBusiness, exact: true }).click();
    await expect(
        page
            .locator("aside")
            .getByRole("link", { name: strings.navigation.businessMenu, exact: true }),
    ).toBeVisible({ timeout: 60_000 });
});
