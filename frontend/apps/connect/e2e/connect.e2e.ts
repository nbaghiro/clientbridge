import { createHash } from "node:crypto";

import { strings } from "@clientbridge/app-core/public";
import { expect, type Page, test } from "@playwright/test";

interface Links {
    slug: string;
    invoice: string;
    estimate: string;
    receipt: string;
    order: string;
    review: string;
    manage: string;
    form: string;
    contract: string;
    prefs: string;
}

// `make test-connect` mints these with backend/scripts/connect_links.py.
const links = JSON.parse(process.env.CONNECT_LINKS ?? "null") as Links | null;
if (links === null) throw new Error("run through `make test-connect`, which sets CONNECT_LINKS");

// Isolate each journey from localhost's 30-request public API budget.
const runKey = Date.now().toString();
test.beforeEach(async ({ context }, info) => {
    const suffix = createHash("sha256")
        .update(`${runKey}:${info.testId}`)
        .digest("hex")
        .slice(0, 16);
    const address = `2001:db8:${suffix.match(/.{4}/g)?.join(":")}::1`;
    await context.route(
        `${process.env.VITE_API_URL ?? "http://127.0.0.1:8701"}/**`,
        async (route) => {
            await route.continue({
                headers: { ...route.request().headers(), "X-Forwarded-For": address },
            });
        },
    );
});

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
    await expect(page.getByRole("heading", { name: b.stepService })).toBeVisible();
    const openingsResponse = page.waitForResponse(
        (response) => response.url().includes(`/book/${links.slug}/days?`) && response.ok(),
    );
    await page.getByRole("button", { name: /^Full Groom — Large Dog/ }).click();
    await expect(page.getByRole("heading", { name: b.stepTime })).toBeVisible();
    const openings = (await (await openingsResponse).json()) as {
        days: { count: number; closed: boolean }[];
    };
    // two days out keeps the visit past the 24-hour cancellation cutoff the manage link enforces
    const availableDay = openings.days.findIndex(
        (day, index) => index >= 2 && day.count > 0 && !day.closed,
    );
    expect(availableDay).toBeGreaterThanOrEqual(2);
    await page
        .getByRole("radiogroup", { name: b.date })
        .getByRole("radio")
        .nth(availableDay)
        .click();
    await page.getByRole("radiogroup", { name: b.openTimes }).getByRole("radio").first().click();
    await page.getByRole("button", { name: b.continue }).first().click();
    await expect(page.getByRole("heading", { name: b.stepExtras, level: 2 })).toBeVisible();
    await page
        .getByRole("button", { name: new RegExp(`^${b.addOne} `) })
        .first()
        .click();
    await page.getByRole("button", { name: b.continue }).first().click();
    await expect(page.getByRole("heading", { name: b.detailsTitle, level: 2 })).toBeVisible();
    await page.getByRole("textbox", { name: b.name }).fill("Robin Test");
    await page.getByRole("textbox", { name: b.pet }).fill("Pepper");
    await page.getByRole("textbox", { name: b.phone }).fill("2505550199");
    await page.getByRole("textbox", { name: new RegExp(`^${b.email}`) }).fill("robin@example.com");
    await page.getByRole("button", { name: b.confirmAndPay("$27.50") }).click();
    const outcome = page.getByRole("heading", {
        name: new RegExp(`^(${b.payTitle}|${b.doneTitle}|${b.pendingTitle})$`),
    });
    await expect(outcome).toHaveText(
        new RegExp(`^(${b.payTitle}|${b.doneTitle}|${b.pendingTitle})$`),
    );
    if ((await outcome.textContent()) !== b.payTitle) {
        const m = strings.publicManage;
        await page.getByRole("button", { name: b.manage }).click();
        await expect(page).toHaveURL(/\/m\//);
        await expect(page.getByText(m.title, { exact: true })).toBeVisible();
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
    await expect(page.getByText(m.title, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: m.reschedule }).click();
    await expect(page.getByRole("heading", { name: m.moveTitle })).toBeVisible();
    await page.getByRole("button", { name: m.back }).click();
    await expect(page.getByText(m.title, { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
});

test("a client finds the shop from the landing page and fills a cart", async ({ page }) => {
    const errors = watchErrors(page);
    const shop = strings.publicShop;
    await page.goto(`/b/${links.slug}`);
    await expect(
        page.getByRole("button", { name: strings.publicLanding.book }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: strings.publicBooking.shopLink }).click();
    await expect(page).toHaveURL(new RegExp(`/b/${links.slug}/shop$`));
    await expect(page.getByRole("heading", { name: shop.title, level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Self-Cleaning Slicker Brush", exact: true }).click();
    await page.getByRole("button", { name: shop.addToOrder }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("button", { name: shop.remove })).toBeVisible();
    await drawer.getByRole("button", { name: shop.checkout }).click();
    await expect(page).toHaveURL(/\/checkout$/);
    await expect(page.getByRole("heading", { name: shop.checkout, level: 1 })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: shop.remove })).toBeVisible();
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
    await page
        .getByRole("button", { name: new RegExp(`^(${pay.viewInvoice}|${pay.payByCardInstead})$`) })
        .click();
    await expect(page.getByRole("heading", { name: pay.chooseHowToPay })).toBeVisible();
    expect(errors).toEqual([]);
});

test("a client reads an estimate and a receipt", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(`/e/${links.estimate}`);
    await expect(
        page.getByRole("button", { name: new RegExp(`^${strings.publicEstimate.acceptFor("")}`) }),
    ).toBeVisible();
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
    await page.getByRole("switch").first().click();
    await expect(page.getByRole("button", { name: prefs.save })).toBeEnabled();
    await page.goto("/nowhere");
    await expect(
        page.getByRole("heading", { name: strings.publicLanding.pageNotFoundTitle }),
    ).toBeVisible();
    expect(errors).toEqual([]);
});

const PUBLIC_PAGES = [
    { name: "business", path: `/b/${links.slug}`, landmark: "Birchbark Pet Studio" },
    { name: "booking", path: `/book/${links.slug}`, landmark: strings.publicBooking.title },
    { name: "manage", path: `/m/${links.manage}`, landmark: strings.publicManage.title },
    { name: "invoice", path: `/i/${links.invoice}`, landmark: strings.publicPay.chooseHowToPay },
    {
        name: "e-transfer",
        path: `/i/${links.invoice}/etransfer`,
        landmark: strings.publicPay.steps,
    },
    {
        name: "estimate",
        path: `/e/${links.estimate}`,
        landmark: strings.publicEstimate.estimateTotal,
    },
    { name: "receipt", path: `/r/${links.receipt}`, landmark: strings.publicReceipt.print },
    { name: "review", path: `/review/${links.review}`, landmark: strings.publicReview.submit },
    { name: "form", path: `/form/${links.form}`, landmark: strings.publicForm.sendAnswers },
    {
        name: "contract",
        path: `/contract/${links.contract}`,
        landmark: strings.publicContract.sign,
    },
    {
        name: "preferences",
        path: `/prefs/${links.prefs}`,
        landmark: strings.publicPreferences.title,
    },
    { name: "order", path: `/order/${links.order}`, landmark: strings.publicOrder.title },
    { name: "shop", path: `/b/${links.slug}/shop`, landmark: strings.publicShop.subtitle },
];

for (const surface of PUBLIC_PAGES) {
    test(`the ${surface.name} page renders without overflow at phone width`, async ({ page }) => {
        const errors = watchErrors(page);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(surface.path);
        await expect(page.getByText(surface.landmark, { exact: true }).first()).toBeVisible();
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        ).toBeLessThanOrEqual(0);
        if (process.env.E2E_CAPTURE_SURFACES === "1") {
            await test.info().attach(surface.name, {
                body: await page.screenshot({ fullPage: true }),
                contentType: "image/png",
            });
        }
        expect(errors).toEqual([]);
    });
}

const MISSING_PAGES = [
    ["/b/missing-business", strings.publicLanding.notFoundTitle],
    ["/book/missing-business", strings.publicBooking.notFoundTitle],
    ["/shop/missing-business", strings.publicShop.notFoundTitle],
    ["/m/missing-token", strings.publicManage.notFoundTitle],
    ["/i/missing-token", strings.publicPay.notFoundTitle],
    ["/i/missing-token/etransfer", strings.publicPay.notFoundTitle],
    ["/e/missing-token", strings.publicEstimate.notFoundTitle],
    ["/r/missing-token", strings.publicReceipt.notFoundTitle],
    ["/review/missing-token", strings.publicReview.notFoundTitle],
    ["/form/missing-token", strings.publicForm.notFoundTitle],
    ["/contract/missing-token", strings.publicContract.notFoundTitle],
    ["/prefs/missing-token", strings.publicPreferences.notFoundTitle],
] as const;

test("every client page explains an invalid link without offering a transaction", async ({
    page,
}) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    const writes: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
        if (
            new URL(request.url()).origin ===
                new URL(process.env.VITE_API_URL ?? "http://127.0.0.1:8701").origin &&
            ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())
        ) {
            writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
        }
    });
    for (const [path, title] of MISSING_PAGES) {
        await test.step(path, async () => {
            await page.goto(path);
            await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
            await expect(page.getByRole("button")).toHaveCount(0);
        });
    }
    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
});

test("the single-script booking drawer opens, closes and restores focus", async ({ page }) => {
    await page.goto(`/c/${links.slug}`);
    await page.evaluate((slug) => {
        document.body.replaceChildren();
        const script = document.createElement("script");
        script.src = "/embed.js";
        script.dataset.slug = slug;
        script.dataset.label = "Book a visit";
        document.body.append(script);
    }, links.slug);
    const launch = page.getByRole("button", { name: "Book a visit" });
    await launch.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const widget = page.frameLocator("connect-booking iframe");
    await expect(
        widget.getByRole("button", { name: new RegExp(strings.publicBooking.guided.first) }),
    ).toBeVisible();
    await widget
        .getByRole("button", { name: new RegExp(strings.publicBooking.guided.first) })
        .click();
    await expect(
        widget.getByRole("heading", { name: strings.publicBooking.stepService, exact: true }),
    ).toBeVisible();
    await expect(page.locator("connect-booking iframe")).toHaveAttribute("allow", "payment");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(launch).toBeFocused();
    await launch.click();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(launch).toBeFocused();
});
