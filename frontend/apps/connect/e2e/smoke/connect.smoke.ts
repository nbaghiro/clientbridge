import { strings } from "@clientbridge/app-core/public";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { businessPage, deployment, expectNoWrites, pageErrors, readOnly } from "./deployment";

const { slug, business } = deployment;
const host = "https://smoke-host.example/";

async function head(request: APIRequestContext, target: string) {
    const response = await request.get(target, { maxRedirects: 0 });
    return { status: response.status(), headers: response.headers() };
}

async function embedOn(page: Page, markup: string) {
    const body = `<!doctype html><html><body>${markup}<script src="${deployment.book}/embed.js" async></script></body></html>`;
    await page.route(host, (route) => route.fulfill({ contentType: "text/html", body }));
    await page.goto(host);
}

test.describe("web server", () => {
    test("each host serves config.js naming every Connect URL", async ({ request }) => {
        for (const origin of [
            deployment.app,
            deployment.book,
            deployment.shop,
            deployment.pay,
            businessPage(),
        ]) {
            const response = await request.get(`${origin}/config.js`);
            expect(response.status(), origin).toBe(200);
            const body = await response.text();
            expect(body, origin).toContain(`"pageUrl":"${deployment.pageTemplate}"`);
            expect(body, origin).toContain(`"bookUrl":"${deployment.book}"`);
            expect(body, origin).toContain(`"shopUrl":"${deployment.shop}"`);
            expect(body, origin).toContain(`"payUrl":"${deployment.pay}"`);
        }
    });

    test("the bare Connect hosts redirect to the marketing site", async ({ request }) => {
        for (const origin of [deployment.book, deployment.shop, deployment.pay]) {
            const { status, headers } = await head(request, `${origin}/`);
            expect(status, origin).toBe(302);
            expect(headers.location?.replace(/\/$/, ""), origin).toBe(
                deployment.site.replace(/\/$/, ""),
            );
        }
    });

    test("only embeddable pages may be framed", async ({ request }) => {
        const framed = [
            businessPage(),
            `${deployment.book}/${slug}`,
            `${deployment.book}/form/x`,
            `${deployment.book}/contract/x`,
            `${deployment.shop}/${slug}`,
            `${deployment.shop}/${slug}/checkout`,
            `${deployment.pay}/i/x`,
        ];
        const unframed = [
            `${deployment.book}/m/x`,
            `${deployment.book}/prefs/x`,
            `${deployment.shop}/order/x`,
            `${deployment.pay}/e/x`,
            `${deployment.pay}/r/x`,
            `${deployment.pay}/setup`,
            `${deployment.app}/`,
        ];
        for (const target of framed) {
            const { status, headers } = await head(request, target);
            expect(status, target).toBe(200);
            expect(headers["x-frame-options"], target).toBeUndefined();
        }
        for (const target of unframed) {
            const { headers } = await head(request, target);
            expect(headers["x-frame-options"], target).toBe("DENY");
            expect(headers["content-security-policy"], target).toContain("frame-ancestors 'none'");
        }
    });

    test("the marketing site's demo link opens the business page", async ({ request }) => {
        const response = await request.get(deployment.site);
        expect(response.status()).toBe(200);
        const html = await response.text();
        expect(html).toContain(`href="${businessPage()}"`);
        expect(html).not.toContain("base.invalid");
        expect(html).not.toContain("/b/");
    });

    test("the API is healthy and ready", async ({ request }) => {
        for (const path of ["/health", "/ready"]) {
            expect((await request.get(`${deployment.api}${path}`)).status(), path).toBe(200);
        }
    });
});

test.describe("Connect", () => {
    test("the business page links to booking and the shop on their own hosts", async ({
        page,
        context,
    }) => {
        const writes = await readOnly(context);
        const errors = pageErrors(page);
        await page.goto(businessPage());
        await expect(page.getByRole("heading", { name: business }).first()).toBeVisible();
        await page.getByRole("button", { name: strings.publicLanding.book }).first().click();
        await expect(page).toHaveURL(`${deployment.book}/${slug}`);
        await expect(
            page.getByRole("heading", { name: strings.publicBooking.stepService }),
        ).toBeVisible();
        await page
            .getByRole("navigation", { name: strings.publicLanding.navigation })
            .getByRole("link", { name: business })
            .click();
        await expect(page).toHaveURL(businessPage());
        await page.getByRole("button", { name: strings.publicBooking.shopLink }).click();
        await expect(page).toHaveURL(`${deployment.shop}/${slug}`);
        await expect(
            page.getByRole("heading", { name: strings.publicShop.title, level: 1 }),
        ).toBeVisible();
        expect(errors).toEqual([]);
        expectNoWrites(writes);
    });

    test("a booking deep link from a service keeps the service", async ({ page, context }) => {
        const writes = await readOnly(context);
        await page.goto(businessPage());
        const times = page.locator("#services").getByRole("button").filter({ hasText: /\d/ });
        await expect(times.first()).toBeVisible();
        await times.first().click();
        await expect(page).toHaveURL((url) => url.href.startsWith(`${deployment.book}/${slug}?`));
        expect(new URL(page.url()).searchParams.get("service")).not.toBeNull();
        expectNoWrites(writes);
    });

    test("pages on the wrong host or for no business are not found", async ({ page, context }) => {
        const writes = await readOnly(context);
        const missing = strings.publicLanding.pageNotFoundTitle;
        const cases: [string, string][] = [
            [`${deployment.pay}/${slug}`, missing],
            [`${deployment.book}/i/missing`, missing],
            [`${deployment.shop}/m/missing`, missing],
            [businessPage(slug, "/book"), missing],
            [`${deployment.book}/b/${slug}/book`, missing],
            [businessPage("smoke-missing-business"), strings.publicLanding.notFoundTitle],
        ];
        for (const [target, title] of cases) {
            await page.goto(target);
            await expect(
                page.getByRole("heading", { name: title, exact: true }),
                target,
            ).toBeVisible();
        }
        expectNoWrites(writes);
    });

    test("the booking and shop widgets load from their own hosts on another site", async ({
        page,
        context,
    }) => {
        const writes = await readOnly(context);
        await embedOn(
            page,
            `<connect-booking slug="${slug}"></connect-booking><connect-shop slug="${slug}"></connect-shop>`,
        );
        const frames = page.locator("iframe");
        await expect(frames).toHaveCount(2);
        await expect(frames.nth(0)).toHaveAttribute("src", `${deployment.book}/${slug}?embed=1`);
        await expect(frames.nth(1)).toHaveAttribute("src", `${deployment.shop}/${slug}?embed=1`);
        await expect(
            frames
                .nth(0)
                .contentFrame()
                .getByRole("heading", { name: strings.publicBooking.stepService }),
        ).toBeVisible();
        await expect(
            frames
                .nth(1)
                .contentFrame()
                .getByRole("heading", { name: strings.publicShop.title, level: 1 }),
        ).toBeAttached();
        for (const index of [0, 1]) {
            await expect
                .poll(async () => (await frames.nth(index).boundingBox())?.height ?? 0)
                .toBeGreaterThan(300);
        }
        expectNoWrites(writes);
    });

    test("a widget below the fold sizes to its content before it is scrolled into view", async ({
        page,
        context,
    }) => {
        const writes = await readOnly(context);
        await embedOn(
            page,
            `<div style="height:2400px"></div><connect-shop slug="${slug}"></connect-shop>`,
        );
        const frame = page.locator("iframe");
        await expect(
            frame.contentFrame().getByRole("heading", { name: strings.publicShop.title, level: 1 }),
        ).toBeAttached();
        await expect
            .poll(async () => (await frame.boundingBox())?.height ?? 0)
            .toBeGreaterThan(300);
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
        expectNoWrites(writes);
    });
});
