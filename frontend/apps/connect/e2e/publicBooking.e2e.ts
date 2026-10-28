import { strings } from "@clientbridge/app-core/public";
import { expect, test, type Page } from "@playwright/test";
import { on } from "./support/hosts";
import { links } from "./support/links";
import { ownAddress, rewrite } from "./support/network";
import { demoSlug, runUrl, demoId } from "@clientbridge/config/e2e/run";
import { watchErrors } from "./support/errors";

/** Matches what a copy function renders before its first argument, whatever that argument is. */
const prefixOf = (copy: (value: string) => string): RegExp =>
    new RegExp(`^${(copy("\0").split("\0")[0] ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

async function bookVisit(
    page: Page,
    slug: string,
    service: RegExp,
    extras: "add an extra" | "no extras",
): Promise<void> {
    const b = strings.publicBooking;
    await page.goto(`/${slug}`);
    await expect(page.getByRole("heading", { name: b.stepService })).toBeVisible();
    const openingsResponse = page.waitForResponse(
        (response) => response.url().includes(`/book/${slug}/days?`) && response.ok(),
    );
    await page.getByRole("button", { name: service }).click();
    if (extras === "add an extra") {
        await expect(page.getByRole("heading", { name: b.stepExtras, level: 2 })).toBeVisible();
        await page
            .getByRole("button", { name: new RegExp(`^${b.addNamed("")}`) })
            .first()
            .click();
        await page.getByRole("button", { name: b.continue }).first().click();
    }
    await expect(page.getByRole("radiogroup", { name: b.date })).toBeVisible();
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
    await expect(page.getByRole("heading", { name: b.stepDetails, level: 2 })).toBeVisible();
    await page.getByRole("textbox", { name: b.name }).fill("Robin Bennett");
    await page.getByRole("textbox", { name: b.subject("pet") }).fill("Pepper");
    // fresh contact details, so an earlier run's booking never makes this client a returning one
    const fresh = String(Date.now() % 1_000_000).padStart(6, "0");
    await page.getByRole("textbox", { name: b.phone }).fill(`2507${fresh}`);
    await page.getByRole("button", { name: b.confirm, exact: true }).click();
}

async function cancelThroughManageLink(page: Page): Promise<void> {
    const m = strings.publicManage;
    await page.getByRole("button", { name: strings.publicBooking.manage }).click();
    await expect(page).toHaveURL(/\/m\//);
    await expect(page.getByText(m.title, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: m.cancel }).click();
    await page.getByRole("button", { name: m.cancelConfirm }).click();
    await expect(page.getByRole("heading", { name: m.canceledTitle })).toBeVisible();
}

const slug = demoSlug("birchbark");
const otherSlug = demoSlug("cedarcoast");
const booking = `/${slug}`;
const api = runUrl("VITE_API_URL");

test.beforeEach(async ({ context }, info) => {
    await ownAddress(context, info);
});

test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("a new client's online booking waits for approval and opens the manage link", async ({
    page,
}) => {
    const errors = watchErrors(page);
    // Birchbark approves new clients by hand, so a first booking is a request
    await bookVisit(page, links.slug, /^Bath & Tidy/, "add an extra");
    await expect(
        page.getByRole("heading", { name: strings.publicBooking.pendingTitle }),
    ).toBeVisible();
    await cancelThroughManageLink(page);
    expect(errors).toEqual([]);
});

test("a client books a confirmed visit where new clients need no approval", async ({ page }) => {
    const errors = watchErrors(page);
    await bookVisit(page, demoSlug("cedarcoast"), /^Dog Walk, 30 minutes/, "no extras");
    await expect(
        page.getByRole("heading", { name: strings.publicBooking.doneTitle }),
    ).toBeVisible();
    await cancelThroughManageLink(page);
    expect(errors).toEqual([]);
});

test("anyone books with any member, and a refused or unreachable booking reads as such", async ({
    page,
}) => {
    const b = strings.publicBooking;
    await page.goto(`/${links.slug}`);
    const openingsResponse = page.waitForResponse(
        (response) => response.url().includes(`/book/${links.slug}/days?`) && response.ok(),
    );
    await page.getByRole("button", { name: /^Full Groom — Large Dog/ }).click();
    await expect(page.getByRole("heading", { name: b.stepExtras, level: 2 })).toBeVisible();
    await page.getByRole("button", { name: b.continue }).first().click();
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
        await expect(page.getByRole("heading", { name: b.stepDetails, level: 2 })).toBeVisible();
    };
    await pickTime();
    await page.getByRole("textbox", { name: b.name }).fill("Robin Bennett");
    await page.getByRole("textbox", { name: b.subject("pet") }).fill("Pepper");
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

test(
    "XB-E2E-12 booking drafts restore contact details and remain scoped to their business",
    { tag: "@browsers" },
    async ({ page }) => {
        // drafts live in book.'s session storage, so they are written on that origin first
        await page.goto("/nowhere");
        await page.evaluate(
            ({ ours, theirs, saved }) => {
                sessionStorage.setItem(ours, JSON.stringify(saved));
                sessionStorage.setItem(theirs, JSON.stringify({ name: "Other Client" }));
            },
            {
                ours: `connect-booking:${slug}`,
                theirs: `connect-booking:${otherSlug}`,
                saved: {
                    name: "Booking Draft",
                    phone: "+16045550225",
                    itemId: demoId("it_bath"),
                    note: "Saved note",
                },
            },
        );
        await page.goto(on("book", booking));
        await expect(
            page.getByRole("heading", { name: strings.publicBooking.stepTime }),
        ).toBeVisible();
        const nav = page.getByRole("navigation", { name: strings.publicLanding.navigation });
        await nav.getByRole("link", { name: strings.publicLanding.shop, exact: true }).click();
        await nav.getByRole("link", { name: strings.publicLanding.booking, exact: true }).click();
        await expect(
            page.getByRole("heading", { name: strings.publicBooking.stepTime }),
        ).toBeVisible();
        const draft = await page.evaluate(
            (key) => JSON.parse(sessionStorage.getItem(key) ?? "{}") as Record<string, string>,
            `connect-booking:${slug}`,
        );
        expect(draft.name).toBe("Booking Draft");
        expect(draft.phone).toBe("+16045550225");
        expect(draft.returningToken).toBeUndefined();
        await page.reload();
        await expect(
            page.getByRole("heading", { name: strings.publicBooking.stepTime }),
        ).toBeVisible();
        await page.goto(`/${otherSlug}`);
        await expect(page.getByRole("button", { name: /^Dog Walk, 30 minutes/ })).toBeVisible();
        await expect(
            page
                .getByRole("navigation", { name: strings.publicLanding.navigation })
                .getByRole("link", { name: /Cedar Coast/ }),
        ).toBeVisible();
        const other = await page.evaluate(
            (key) => JSON.parse(sessionStorage.getItem(key) ?? "{}") as Record<string, string>,
            `connect-booking:${otherSlug}`,
        );
        expect(other.name).toBe("Other Client");
        expect(other.phone).toBeUndefined();
        expect(
            await page.evaluate(
                (key) => sessionStorage.getItem(key),
                `connect-booking:${otherSlug}`,
            ),
        ).toContain("Other Client");
    },
);

test("a business with nothing bookable online says so", async ({ page }) => {
    await page.route(`${api}/book/${slug}/services`, (route) =>
        rewrite(route, (body) => ({ ...body, services: [] })),
    );
    await page.goto(on("book", booking));
    await expect(page.getByText(strings.publicBooking.nothingBookable)).toBeVisible();
    await expect(
        page.getByRole("heading", { name: strings.publicBooking.stepService }),
    ).toHaveCount(0);
});
