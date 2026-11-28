import { readFile } from "node:fs/promises";
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

/** From the service list to the details step, two days out so a manage-link cancel still works. */
async function bookUpToDetails(page: Page, business: string, service: RegExp): Promise<void> {
    const b = strings.publicBooking;
    await page.goto(`/${business}`);
    const openings = page.waitForResponse(
        (response) => response.url().includes(`/book/${business}/days?`) && response.ok(),
    );
    await page.getByRole("button", { name: service }).click();
    if (await page.getByRole("heading", { name: b.stepExtras, level: 2 }).isVisible()) {
        await page.getByRole("button", { name: b.continue }).first().click();
    }
    const days = ((await (await openings).json()) as { days: { count: number; closed: boolean }[] })
        .days;
    const open = days.findIndex((day, index) => index >= 2 && day.count > 0 && !day.closed);
    expect(open).toBeGreaterThanOrEqual(2);
    await page.getByRole("radiogroup", { name: b.date }).getByRole("radio").nth(open).click();
    await page.getByRole("radiogroup", { name: b.openTimes }).getByRole("radio").first().click();
    await page.getByRole("button", { name: b.continue }).first().click();
    await expect(page.getByRole("heading", { name: b.stepDetails, level: 2 })).toBeVisible();
}

async function cancelThroughManageLink(page: Page): Promise<void> {
    const m = strings.publicManage;
    await page.getByRole("button", { name: strings.publicBooking.manage }).click();
    await expect(page).toHaveURL(/\/m\//);
    await expect(
        page
            .getByText(m.title, { exact: true })
            .or(page.getByText(m.requestLabel, { exact: true })),
    ).toBeVisible();
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
        // WebKit aborts a navigation that starts while routed API calls are still in flight
        await page.waitForLoadState("networkidle");
        await page.reload();
        await expect(
            page.getByRole("heading", { name: strings.publicBooking.stepTime }),
        ).toBeVisible();
        await page.waitForLoadState("networkidle");
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

        const b = strings.publicBooking;
        await page.evaluate(() => {
            sessionStorage.clear();
        });
        await bookUpToDetails(page, slug, /^Bath & Tidy/);
        await page.getByRole("textbox", { name: b.name }).fill("Robin Typed");
        await page.getByRole("textbox", { name: b.subject("pet") }).fill("Biscuit");
        await page.getByRole("textbox", { name: b.phone }).fill("2505550188");
        await page.waitForLoadState("networkidle");
        await page.reload();
        await expect(page.getByRole("heading", { name: b.stepDetails, level: 2 })).toBeVisible();
        await expect(page.getByRole("textbox", { name: b.name })).toHaveValue("Robin Typed");
        await expect(page.getByRole("textbox", { name: b.subject("pet") })).toHaveValue("Biscuit");
        await expect(page.getByRole("textbox", { name: b.phone })).toHaveValue("2505550188");
        await bookUpToDetails(page, otherSlug, /^Dog Walk, 30 minutes/);
        await expect(page.getByRole("textbox", { name: b.name })).toHaveValue("");
        await expect(page.getByRole("textbox", { name: b.phone })).toHaveValue("");
    },
);

test(
    "XB-E2E-24 in the embedded page on a phone, a returning client tries another number, sees every code button and one welcome, and an edit asks for a code again",
    { tag: "@browsers" },
    async ({ browser }, info) => {
        const b = strings.publicBooking;
        const g = b.guided;
        const t = strings.publicReturning;
        const base = info.project.use.baseURL;
        const context = await browser.newContext({
            viewport: { width: 390, height: 844 },
            ...(base === undefined ? {} : { baseURL: base }),
        });
        await ownAddress(context, info);
        const page = await context.newPage();
        const errors = watchErrors(page);
        const found = {
            token: "proof",
            profile: {
                name: "Pat Lee",
                phone: "+12505550199",
                subjects: [{ id: "sj_rex", name: "Rex" }],
                last_visit: null,
                photo_url: null,
            },
        };
        const requested: string[] = [];
        let answer: typeof found | { token: null; profile: null } = { token: null, profile: null };
        // the code endpoints are answered here, so no text is sent and no number's budget is spent
        await page.route(`**/book/${slug}/returning/request`, (route) => {
            requested.push((route.request().postDataJSON() as { phone: string }).phone);
            return route.fulfill({ json: { challenge_id: "rtc_phone" } });
        });
        await page.route(`**/book/${slug}/returning/verify`, (route) =>
            route.fulfill({ json: answer }),
        );
        await page.goto(`/${slug}?embed=1&presentation=guided`);
        const business = (await page.getByRole("heading", { level: 1 }).textContent()) ?? "";
        await page.getByRole("button", { name: new RegExp(`^${g.returning}`) }).click();
        const contact = page.getByRole("textbox", { name: t.contact });
        const verify = async (number: string): Promise<void> => {
            await contact.fill(number);
            await page.getByRole("button", { name: t.sendCode, exact: true }).click();
            await page.getByRole("textbox", { name: t.code, exact: true }).fill("123456");
            await page.getByRole("button", { name: t.verify, exact: true }).click();
        };
        await contact.fill("2505550198");
        await page.getByRole("button", { name: t.sendCode, exact: true }).click();
        for (const name of [t.verify, t.changeContact]) {
            const box = await page.getByRole("button", { name, exact: true }).boundingBox();
            expect(box, name).not.toBeNull();
            expect((box?.x ?? 0) + (box?.width ?? 0), name).toBeLessThanOrEqual(390);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
            390,
        );
        await page.getByRole("textbox", { name: t.code, exact: true }).fill("123456");
        await page.getByRole("button", { name: t.verify, exact: true }).click();
        await expect(page.getByText(t.missing, { exact: true })).toBeVisible();
        await page.getByRole("button", { name: t.changeContact, exact: true }).click();
        await expect(contact).toHaveValue("2505550198");
        answer = found;
        await verify("2505550199");
        expect(requested).toEqual(["2505550198", "2505550199"]);
        const welcome = page.getByRole("heading", { name: t.welcome("Pat Lee") });
        await expect(welcome).toHaveCount(1);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(business);
        await expect(page.getByRole("button", { name: "Rex", exact: true })).toBeVisible();

        await page.getByRole("button", { name: g.different, exact: true }).click();
        const openings = page.waitForResponse(
            (response) => response.url().includes(`/book/${slug}/days?`) && response.ok(),
        );
        await page.getByRole("button", { name: /^Bath & Tidy/ }).click();
        const extras = page.getByRole("heading", { name: b.stepExtras });
        await expect(extras.or(page.getByRole("radiogroup", { name: b.date }))).toBeVisible();
        if (await extras.isVisible())
            await page.getByRole("button", { name: b.continue, exact: true }).click();
        const days = (
            (await (await openings).json()) as { days: { count: number; closed: boolean }[] }
        ).days;
        const open = days.findIndex((day) => day.count > 0 && !day.closed);
        expect(open).toBeGreaterThanOrEqual(0);
        await page.getByRole("radiogroup", { name: b.date }).getByRole("radio").nth(open).click();
        await page
            .getByRole("radiogroup", { name: b.openTimes })
            .getByRole("radio")
            .first()
            .click();
        await page.getByRole("button", { name: b.continue, exact: true }).click();
        await expect(page.getByRole("heading", { name: b.stepDetails })).toBeVisible();
        const name = page.getByRole("textbox", { name: b.name });
        await expect(name).toHaveValue("Pat Lee");
        await expect(contact).toBeHidden();
        await name.fill("Pat Leigh");
        await expect(page.getByRole("heading", { name: t.title, exact: true })).toBeVisible();
        await expect(contact).toHaveValue("2505550199");
        await expect(welcome).toBeHidden();
        // clearing the number to retype it keeps the panel open
        await contact.fill("");
        await expect(contact).toBeVisible();
        await verify("2505550199");
        await expect(welcome).toHaveCount(1);
        await expect(name).toHaveValue("Pat Lee");
        expect(errors).toEqual([]);
        await context.close();
    },
);

test("XB-E2E-22 a confirmed visit's calendar file keeps the business's clock on a phone in another zone", async ({
    browser,
}) => {
    const b = strings.publicBooking;
    const context = await browser.newContext({
        baseURL: on("book", "/"),
        timezoneId: "Europe/Warsaw",
        acceptDownloads: true,
    });
    const page = await context.newPage();
    await bookUpToDetails(page, otherSlug, /^Dog Walk, 30 minutes/);
    await page.getByRole("textbox", { name: b.name }).fill("Sam Calendar");
    await page.getByRole("textbox", { name: b.subject("pet") }).fill("Clover");
    const fresh = String(Date.now() % 1_000_000).padStart(6, "0");
    await page.getByRole("textbox", { name: b.phone }).fill(`2507${fresh}`);
    await page.getByRole("button", { name: b.confirm, exact: true }).click();
    await expect(page.getByRole("heading", { name: b.doneTitle })).toBeVisible();
    // the confirmation names the visit's time on the business's clock; the file must say the same
    const shown = /(\d{1,2}):(\d{2})\s*([ap])\.?m\.?/i.exec(
        await page
            .getByText(/ at \d{1,2}:\d{2}/)
            .first()
            .innerText(),
    );
    expect(shown).not.toBeNull();
    const [, hour = "0", minute = "00", half = "a"] = shown ?? [];
    const clock = `${String((Number(hour) % 12) + (half.toLowerCase() === "p" ? 12 : 0)).padStart(2, "0")}${minute}`;
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: b.addToCalendar }).click();
    const file = await download;
    const ics = (await readFile(await file.path())).toString("utf8").split("\r\n");
    expect(ics).toContain("TZID:America/Vancouver");
    const start = ics.find((line) => line.startsWith("DTSTART;"));
    expect(start).toMatch(new RegExp(`^DTSTART;TZID=America/Vancouver:\\d{8}T${clock}00$`));
    await cancelThroughManageLink(page);
    await context.close();
});

test("the booking summary mentions tax only when the business charges it", async ({ browser }) => {
    const b = strings.publicBooking;
    const business = demoSlug("birchbark");
    const chooseGroom = async (page: Page): Promise<void> => {
        await page.goto(`/${business}`);
        await page.getByRole("button", { name: /^Full Groom — Large Dog/ }).click();
        await expect(page.getByText(b.dueNow).first()).toBeVisible();
    };
    const options = { baseURL: on("book", "/") };
    const charging = await browser.newContext(options);
    const taxed = await charging.newPage();
    await chooseGroom(taxed);
    await expect(taxed.getByText(b.taxNote).first()).toBeVisible();
    await charging.close();
    const exempting = await browser.newContext(options);
    const untaxed = await exempting.newPage();
    await untaxed.route(`${runUrl("VITE_API_URL")}/book/${business}/services`, (route) =>
        rewrite(route, (body) => ({ ...body, charges_tax: false })),
    );
    await chooseGroom(untaxed);
    await expect(untaxed.getByText(b.taxNote)).toHaveCount(0);
    await exempting.close();
});

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

test("TEAM-E2E-04 each member's title shows with their name where a client picks who to book", async ({
    page,
}) => {
    const b = strings.publicBooking;
    await page.goto(`/${links.slug}`);
    await page.getByRole("button", { name: /^Full Groom — Large Dog/ }).click();
    await page.getByRole("button", { name: b.continue }).first().click();
    const who = page.getByRole("group", { name: b.with });
    await expect(who.getByRole("button", { name: b.anyone, exact: true })).toBeVisible();
    for (const [name, title] of [
        ["Diego Ramirez", "Senior Groomer"],
        ["Priya Patel", "Bather & Front Desk"],
    ])
        await expect(who.getByRole("button", { name: `${name} ${title}` })).toBeVisible();
});
