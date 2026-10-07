import { strings } from "@clientbridge/app-core/public";
import { expect, type Page, test } from "@playwright/test";

interface Links {
    slug: string;
    invoice: string;
    estimate: string;
    receipt: string;
    review: string;
    manage: string;
    form: string;
    contract: string;
    prefs: string;
}

// `make test-connect` mints these with backend/scripts/connect_links.py.
const links = JSON.parse(process.env.CONNECT_LINKS ?? "null") as Links | null;
if (links === null) throw new Error("run through `make test-connect`, which sets CONNECT_LINKS");

function watchErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
        if (m.type() === "error") errors.push(`console: ${m.text()}`);
    });
    return errors;
}

test("a client books a visit online and opens the manage link", async ({ page }) => {
    const errors = watchErrors(page);
    const b = strings.publicBooking;
    await page.goto(`/book/${links.slug}`);
    await expect(page.getByRole("heading", { name: b.chooseService })).toBeVisible();
    await page.getByRole("button", { name: /^Full Groom — Large Dog/ }).click();
    await page.getByRole("button", { name: b.continue }).first().click();
    await expect(page.getByRole("heading", { name: b.chooseTime })).toBeVisible();
    await page
        .getByRole("group", { name: b.date })
        .getByRole("button", { disabled: false })
        .nth(3)
        .click();
    await page.getByRole("radiogroup", { name: b.openTimes }).getByRole("radio").first().click();
    await page.getByRole("button", { name: b.continue }).first().click();
    await expect(page.getByRole("heading", { name: b.detailsTitle, level: 1 })).toBeVisible();
    await page
        .getByRole("button", { name: new RegExp(`^${b.addOne} `) })
        .first()
        .click();
    await page.getByRole("textbox", { name: b.name }).fill("Robin Test");
    await page.getByRole("textbox", { name: b.pet }).fill("Pepper");
    await page.getByRole("textbox", { name: b.phone }).fill("2505550199");
    await page.getByRole("textbox", { name: new RegExp(`^${b.email}`) }).fill("robin@example.com");
    await page.getByRole("button", { name: b.confirmAndPay("$27.50") }).click();
    const outcome = page.getByRole("heading", { level: 1 });
    await expect(outcome).toHaveText(
        new RegExp(`^(${b.payTitle}|${b.doneTitle}|${b.pendingTitle})$`),
    );
    if ((await outcome.textContent()) !== b.payTitle) {
        const m = strings.publicManage;
        await page.getByRole("button", { name: b.manage }).click();
        await expect(page).toHaveURL(/\/m\//);
        await expect(page.getByRole("heading", { name: m.title })).toBeVisible();
        await page.getByRole("button", { name: m.cancel }).click();
        await page.getByRole("button", { name: m.cancelConfirm }).click();
        await expect(page.getByRole("heading", { name: m.canceledTitle })).toBeVisible();
    }
    expect(errors).toEqual([]);
});

test("a client opens the manage link and the move picker", async ({ page }) => {
    const errors = watchErrors(page);
    const m = strings.publicManage;
    await page.goto(`/m/${links.manage}`);
    await expect(page.getByRole("heading", { name: m.title })).toBeVisible();
    await page.getByRole("button", { name: m.reschedule }).click();
    await expect(page.getByRole("heading", { name: m.moveTitle })).toBeVisible();
    await page.getByRole("button", { name: m.back }).click();
    await expect(page.getByRole("heading", { name: m.title })).toBeVisible();
    expect(errors).toEqual([]);
});

test("a client finds the shop from the landing page and fills a cart", async ({ page }) => {
    const errors = watchErrors(page);
    const shop = strings.publicShop;
    await page.goto(`/b/${links.slug}`);
    await expect(page.getByRole("button", { name: strings.publicLanding.book })).toBeVisible();
    await page.getByRole("button", { name: strings.publicBooking.shopLink }).click();
    await expect(page).toHaveURL(new RegExp(`/shop/${links.slug}$`));
    await expect(page.getByRole("heading", { name: shop.title, level: 1 })).toBeVisible();
    const cart = page.getByRole("complementary");
    await expect(cart.getByRole("heading", { name: shop.cart })).toBeVisible();
    await page.locator("main").getByRole("button").first().click();
    await expect(cart.getByRole("button", { name: shop.remove })).toBeVisible();
    expect(errors).toEqual([]);
});

test("a client opens an invoice and starts an e-Transfer", async ({ page }) => {
    const errors = watchErrors(page);
    const pay = strings.publicPay;
    await page.goto(`/i/${links.invoice}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("#");
    await expect(page.getByRole("heading", { name: pay.chooseHowToPay })).toBeVisible();
    await page
        .getByRole("button", { name: new RegExp(`^(${pay.payByInterac}|${pay.seeSteps})$`) })
        .click();
    await expect(page).toHaveURL(/\/etransfer$/);
    await expect(page.getByText(pay.statusWaiting)).toBeVisible();
    await page.getByRole("button", { name: pay.viewInvoice }).click();
    await expect(page.getByRole("heading", { name: pay.chooseHowToPay })).toBeVisible();
    expect(errors).toEqual([]);
});

test("a client reads an estimate and a receipt", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(`/e/${links.estimate}`);
    await expect(page.getByRole("button", { name: strings.publicEstimate.accept })).toBeVisible();
    await expect(page.getByRole("button", { name: strings.publicEstimate.decline })).toBeVisible();
    await page.goto(`/r/${links.receipt}`);
    await expect(page.getByRole("button", { name: strings.publicReceipt.print })).toBeVisible();
    expect(errors).toEqual([]);
});

test("a client starts a review, a form and a contract", async ({ page }) => {
    const errors = watchErrors(page);
    const review = strings.publicReview;
    await page.goto(`/review/${links.review}`);
    await page.getByRole("radio", { name: strings.common.stars(4) }).click();
    await page.getByRole("textbox", { name: review.tellMoreOptional }).fill("Lovely visit");
    await expect(page.getByRole("button", { name: review.submit })).toBeEnabled();

    await page.goto(`/form/${links.form}`);
    await expect(page.getByRole("progressbar")).toBeVisible();
    await page.getByRole("textbox").first().fill("Pepper");
    await expect(page.getByRole("button", { name: strings.publicForm.sendAnswers })).toBeVisible();

    const contract = strings.publicContract;
    await page.goto(`/contract/${links.contract}`);
    await page.getByRole("button", { name: contract.drawTab }).click();
    await expect(page.getByRole("button", { name: contract.drawTab })).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    await expect(page.getByRole("button", { name: contract.sign })).toBeVisible();
    expect(errors).toEqual([]);
});

test("a client opens their message preferences and an unknown link", async ({ page }) => {
    const errors = watchErrors(page);
    const prefs = strings.publicPreferences;
    await page.goto(`/prefs/${links.prefs}`);
    await expect(page.getByRole("heading", { name: prefs.title })).toBeVisible();
    await page.getByRole("checkbox").first().click();
    await expect(page.getByRole("button", { name: prefs.save })).toBeEnabled();
    await page.goto("/nowhere");
    await expect(
        page.getByRole("heading", { name: strings.publicLanding.pageNotFoundTitle }),
    ).toBeVisible();
    expect(errors).toEqual([]);
});
