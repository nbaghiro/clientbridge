import { strings } from "@clientbridge/app-core/public";
import { axeIssues, unmarkedFocus, unreadableHover } from "@clientbridge/config/e2e/accessibility";
import { type ConsoleMessage, expect, type Page, test } from "@playwright/test";

import { links, ownAddress } from "./links";

test.beforeEach(async ({ context }, info) => {
    await ownAddress(context, info);
});

/** Matches what a copy function renders before its first argument, whatever that argument is. */
const prefixOf = (copy: (value: string) => string): RegExp =>
    new RegExp(`^${(copy("\0").split("\0")[0] ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

// a third-party asset (fonts, Stripe) failing on the network is not an app error
const offsiteLoadFailure = (m: ConsoleMessage): boolean => {
    if (!m.text().startsWith("Failed to load resource")) return false;
    try {
        return !["localhost", "127.0.0.1"].includes(new URL(m.location().url).hostname);
    } catch {
        return false;
    }
};

function watchErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
        if (m.type() === "error" && !offsiteLoadFailure(m)) errors.push(`console: ${m.text()}`);
    });
    return errors;
}

test("a client books a visit online and opens the manage link", async ({ page }) => {
    const errors = watchErrors(page);
    const b = strings.publicBooking;
    await page.goto(`/b/${links.slug}/book`);
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
        .getByRole("button", { name: new RegExp(`^${b.addNamed("")}`) })
        .first()
        .click();
    await page.getByRole("button", { name: b.continue }).first().click();
    await expect(page.getByRole("heading", { name: b.stepDetails, level: 2 })).toBeVisible();
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

test("anyone books with any member, and a refused or unreachable booking reads as such", async ({
    page,
}) => {
    const b = strings.publicBooking;
    await page.goto(`/b/${links.slug}/book`);
    const openingsResponse = page.waitForResponse(
        (response) => response.url().includes(`/book/${links.slug}/days?`) && response.ok(),
    );
    await page.getByRole("button", { name: /^Full Groom — Large Dog/ }).click();
    const openings = (await (await openingsResponse).json()) as {
        days: { count: number; closed: boolean }[];
    };
    const availableDay = openings.days.findIndex((day) => day.count > 0 && !day.closed);
    expect(availableDay).toBeGreaterThanOrEqual(0);
    const times = page.getByRole("radiogroup", { name: b.openTimes });
    const pickTime = async (): Promise<void> => {
        await page
            .getByRole("radiogroup", { name: b.date })
            .getByRole("radio")
            .nth(availableDay)
            .click();
        await times.getByRole("radio").first().click();
        await page.getByRole("button", { name: b.continue }).first().click();
        await expect(page.getByRole("heading", { name: b.stepExtras, level: 2 })).toBeVisible();
        await page.getByRole("button", { name: b.continue }).first().click();
        await expect(page.getByRole("heading", { name: b.stepDetails, level: 2 })).toBeVisible();
    };
    await pickTime();
    await page.getByRole("textbox", { name: b.name }).fill("Robin Test");
    await page.getByRole("textbox", { name: b.pet }).fill("Pepper");
    await page.getByRole("textbox", { name: b.phone }).fill("2505550199");
    const sent: { staff_id?: string }[] = [];
    let attempt = 0;
    await page.route(`**/book/${links.slug}`, async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        sent.push(route.request().postDataJSON() as { staff_id?: string });
        attempt++;
        if (attempt === 1)
            return route.fulfill({
                status: 409,
                contentType: "application/json",
                body: JSON.stringify({ error: "slot_unavailable", message: "taken" }),
            });
        return route.abort("internetdisconnected");
    });
    const confirm = page.getByRole("button", { name: prefixOf(b.confirmAndPay) });
    await confirm.click();
    await expect(page.getByText(b.slotTaken)).toBeVisible();
    await expect(times.getByRole("radio", { checked: true })).toHaveCount(0);
    await pickTime();
    await confirm.click();
    await expect(page.getByText(b.connectionError)).toBeVisible();
    await expect(page.getByRole("heading", { name: b.stepDetails, level: 2 })).toBeVisible();
    expect(sent.map((x) => x.staff_id)).toEqual(["any", "any"]);
    await page.unroute(`**/book/${links.slug}`);
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
    await page
        .getByRole("group", { name: "Self-Cleaning Slicker Brush", exact: true })
        .getByRole("button", { name: shop.addNamed("Self-Cleaning Slicker Brush") })
        .click();
    const summary = page.locator("aside");
    await expect(summary.getByRole("button", { name: shop.remove })).toBeVisible();
    await summary.getByRole("button", { name: shop.checkout }).click();
    await expect(page).toHaveURL(/\/checkout$/);
    await expect(page.getByRole("heading", { name: shop.checkout, level: 1 })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: shop.remove })).toBeVisible();
    expect(errors).toEqual([]);
});

test("a client opens an invoice and sees how to pay it", async ({ page }) => {
    const errors = watchErrors(page);
    const pay = strings.publicPay;
    await page.goto(`/i/${links.invoice}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("#");
    await expect(
        page.getByRole("heading", { name: new RegExp(`^(${pay.cardLabel}|${pay.offlineTitle})$`) }),
    ).toBeVisible();
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
    { name: "booking", path: `/b/${links.slug}/book`, landmark: strings.publicBooking.title },
    { name: "manage", path: `/m/${links.manage}`, landmark: strings.publicManage.title },
    { name: "invoice", path: `/i/${links.invoice}`, landmark: strings.publicPay.balanceDue },
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

for (const surface of PUBLIC_PAGES) {
    test(`the ${surface.name} page passes axe, shows keyboard focus and keeps hovered text readable`, async ({
        page,
    }) => {
        await page.goto(surface.path);
        await expect(page.getByText(surface.landmark, { exact: true }).first()).toBeVisible();
        await page.getByRole("heading", { level: 1 }).first().click();
        expect(await axeIssues(page)).toEqual([]);
        expect(await unmarkedFocus(page, "body")).toEqual([]);
        expect(await unreadableHover(page, "body")).toEqual([]);
    });
}

test("the business cover photo keeps its hovered actions readable", async ({ page }) => {
    const cover = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600"><rect width="1600" height="600" fill="#f4efe4"/></svg>`;
    await page.route("**/e2e-cover.svg", (route) =>
        route.fulfill({ contentType: "image/svg+xml", body: cover }),
    );
    await page.route(`**/book/${links.slug}/profile`, async (route) => {
        const response = await route.fetch();
        const profile = (await response.json()) as { brand: Record<string, unknown> };
        profile.brand.cover_url = new URL("/e2e-cover.svg", page.url()).href;
        await route.fulfill({ response, json: profile });
    });
    await page.goto(`/b/${links.slug}`);
    const header = page.locator("header", { has: page.locator('img[src$="/e2e-cover.svg"]') });
    await expect(header.getByRole("button", { name: strings.publicLanding.book })).toBeVisible();
    expect(await unreadableHover(page, "header")).toEqual([]);
    // a profile refetch still in flight at teardown would read a disposed response
    await page.unrouteAll({ behavior: "ignoreErrors" });
});

const MISSING_PAGES = [
    ["/b/missing-business", strings.publicLanding.notFoundTitle],
    ["/b/missing-business/book", strings.publicBooking.notFoundTitle],
    ["/b/missing-business/shop", strings.publicShop.notFoundTitle],
    ["/m/missing-token", strings.publicManage.notFoundTitle],
    ["/i/missing-token", strings.publicPay.notFoundTitle],
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
