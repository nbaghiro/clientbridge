import { randomUUID } from "node:crypto";
import { addDays, dateKey, formatMoney, strings } from "@clientbridge/app-core/public";
import { demoPerson } from "@clientbridge/config/e2e/demo";
import { demoSlug, runEmail } from "@clientbridge/config/e2e/run";
import { expect, test, type Page, type Route } from "@playwright/test";
import { bookingApi, cancelOwnedBooking } from "./support/bookings";
import {
    catalogEvidence,
    catalogFixture,
    expectCatalogCommitted,
    expectStockReplica,
    fillProduct,
    itemCurrency,
    newBookable,
    newProduct,
    saveItem,
} from "./support/catalog";
import { customerContext, signIn } from "./support/session";
import { select } from "./support/db";
import { choiceKeys, connectUrl, onlineBooker, teamMember } from "./support/visit";
const s = strings.catalog;
const b = strings.publicBooking;
const MIN = 60_000;
const ZONE = "America/Vancouver";

interface SavedItem {
    id: string;
    price_cents: number;
    duration_min: number;
    buffer_after_min: number;
    deposit_type: string;
    deposit_value: number;
    staff_ids: string[];
}

test("CFG-E2E-01 product validation and opening stock persist across replicas", async ({
    page,
    browser,
}) => {
    await signIn(page);
    const fixture = catalogFixture(page);
    const { name } = fixture;
    const editor = await newProduct(page);
    const submit = editor.getByRole("button", { name: s.add, exact: true });
    await submit.click();
    await expect(editor.getByText(s.nameRequired, { exact: true })).toBeVisible();
    await fillProduct(editor, name, "-1");
    await submit.click();
    await expect(editor.getByText(s.stockInvalid, { exact: true })).toBeVisible();
    expect(await catalogEvidence(fixture)).toEqual({
        items: [],
        movements: [],
        audits: [],
        receipts: [],
    });
    await editor.getByRole("textbox", { name: s.stockOnHand, exact: true }).fill("7");
    await submit.click();
    await expect(editor).toBeHidden();
    const evidence = await expectCatalogCommitted(fixture, 7, s.openingStockNote);
    const observer = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        viewport: { width: 1440, height: 900 },
    });
    try {
        const other = await observer.newPage();
        await signIn(other);
        await expectStockReplica(other, fixture, 7);
        await other.reload();
        await expectStockReplica(other, fixture, 7);
        await page.reload();
        await expectStockReplica(page, fixture, 7);
        expect(await catalogEvidence(fixture)).toEqual(evidence);
    } finally {
        await observer.close();
    }
});

test("CFG-E2E-02 retry after opening-stock transport failure cannot duplicate a SKU-less product", async ({
    page,
    browser,
}, testInfo) => {
    await signIn(page);
    const fixture = catalogFixture(page);
    const { name } = fixture;
    const editor = await newProduct(page);
    await fillProduct(editor, name);
    let restockAttempts = 0;
    await page.route("**/v1/items/*/restock", async (route) => {
        restockAttempts += 1;
        // First command never reaches API. Item creation was already committed by the real API.
        if (restockAttempts === 1) await route.abort("connectionreset");
        else await route.continue();
    });
    const submit = editor.getByRole("button", { name: s.add, exact: true });
    await submit.click();
    await expect(editor.getByText(s.addError, { exact: true })).toBeVisible();
    const partial = await expectCatalogCommitted(fixture, 0, s.openingStockNote);
    await submit.click();
    await expect(editor).toBeHidden();
    const observed = await catalogEvidence(fixture);
    await testInfo.attach("catalog-after-create-retry", {
        body: JSON.stringify({ partial, observed }),
        contentType: "application/json",
    });
    const committed = await expectCatalogCommitted(fixture, 7, s.openingStockNote);
    expect(committed.items[0]?.id).toBe(partial.items[0]?.id);
    expect(restockAttempts).toBe(2);
    const observer = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        viewport: { width: 1440, height: 900 },
    });
    try {
        const other = await observer.newPage();
        await signIn(other);
        await expectStockReplica(other, fixture, 7);
        await page.reload();
        await expectStockReplica(page, fixture, 7);
        expect(await catalogEvidence(fixture)).toEqual(committed);
    } finally {
        await observer.close();
    }
});

test("CFG-E2E-03 lost committed opening-stock response preserves edited quantity and description", async ({
    page,
    browser,
}, testInfo) => {
    await signIn(page);
    const fixture = catalogFixture(page);
    const { name } = fixture;
    const editor = await newProduct(page);
    await fillProduct(editor, name);
    const commands: { key: string | undefined; body: string | null; url: string }[] = [];
    await page.route("**/v1/items/*/restock", async (route) => {
        commands.push({
            key: route.request().headers()["idempotency-key"],
            body: route.request().postData(),
            url: route.request().url(),
        });
        // Real API commits the initial seven units; only its browser response is lost.
        const response = await route.fetch();
        expect(response.status(), await response.text()).toBe(200);
        if (commands.length === 1) await route.abort("connectionreset");
        else await route.fulfill({ response });
    });
    const submit = editor.getByRole("button", { name: s.add, exact: true });
    await submit.click();
    await expect(editor.getByText(s.addError, { exact: true })).toBeVisible();
    const initial = await expectCatalogCommitted(fixture, 7, s.openingStockNote);
    const description = "Unscented care for sensitive paws.";
    await editor.getByRole("textbox", { name: s.stockOnHand, exact: true }).fill("9");
    await editor.getByRole("textbox", { name: s.description, exact: true }).fill(description);
    await submit.click();
    await expect(editor).toBeHidden();
    expect(commands).toHaveLength(3);
    expect(commands[0]?.key).toBeTruthy();
    expect(commands[1]).toEqual(commands[0]);
    expect(commands[2]?.key).not.toBe(commands[0]?.key);
    expect(commands[2]?.url).toBe(commands[0]?.url);
    expect(JSON.parse(commands[2]?.body ?? "{}")).toEqual({
        quantity: 2,
        note: s.openingStockNote,
    });
    const committed = await expectCatalogCommitted(
        fixture,
        9,
        s.openingStockNote,
        description,
        [7, 2],
    );
    expect(committed.items[0]?.id).toBe(initial.items[0]?.id);
    const observer = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        viewport: { width: 1440, height: 900 },
    });
    try {
        const other = await observer.newPage();
        await signIn(other);
        await expectStockReplica(other, fixture, 9);
        await other.getByRole("tab", { name: s.views.products, exact: true }).click();
        await other.locator(`button[data-row-key="${committed.items[0]?.id ?? ""}"]`).click();
        await expect(
            other.getByRole("dialog").getByRole("textbox", { name: s.description, exact: true }),
        ).toHaveValue(description);
        await page.reload();
        await expectStockReplica(page, fixture, 9);
        expect(await catalogEvidence(fixture)).toEqual(committed);
        await testInfo.attach("recovered-edited-catalog", {
            body: JSON.stringify(committed),
            contentType: "application/json",
        });
    } finally {
        await observer.close();
    }
});

test("CFG-E2E-04 lost initial create response replays original command before saving edited product", async ({
    page,
    browser,
}, testInfo) => {
    await signIn(page);
    const fixture = catalogFixture(page);
    const { name } = fixture;
    const editor = await newProduct(page);
    await fillProduct(editor, name);
    const creates: { key: string | undefined; body: string | null; id: string }[] = [];
    await page.route("**/v1/items", async (route) => {
        if (route.request().method() !== "POST") {
            await route.continue();
            return;
        }
        const response = await route.fetch();
        expect(response.status(), await response.text()).toBe(201);
        creates.push({
            key: route.request().headers()["idempotency-key"],
            body: route.request().postData(),
            id: ((await response.json()) as { id: string }).id,
        });
        if (creates.length === 1) await route.abort("connectionreset");
        else await route.fulfill({ response });
    });
    const submit = editor.getByRole("button", { name: s.add, exact: true });
    await submit.click();
    await expect(editor.getByText(s.addError, { exact: true })).toBeVisible();
    const initial = await expectCatalogCommitted(fixture, 0, s.openingStockNote);
    const description = "Gentle fragrance-free care for winter walks.";
    await editor.getByRole("textbox", { name: s.stockOnHand, exact: true }).fill("9");
    await editor.getByRole("textbox", { name: s.description, exact: true }).fill(description);
    await editor.getByRole("textbox", { name: s.cost, exact: true }).fill("7");
    await submit.click();
    await expect(editor).toBeHidden();
    expect(creates).toHaveLength(2);
    expect(creates[0]?.key).toBeTruthy();
    expect(creates[1]).toEqual(creates[0]);
    const committed = await expectCatalogCommitted(
        fixture,
        9,
        s.openingStockNote,
        description,
        [9],
        700,
    );
    expect(committed.items[0]?.id).toBe(initial.items[0]?.id);
    expect(committed.receipts).toEqual(initial.receipts);
    expect(committed.audits).toEqual(initial.audits);
    const observer = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        viewport: { width: 1440, height: 900 },
    });
    try {
        const other = await observer.newPage();
        await signIn(other);
        await expectStockReplica(other, fixture, 9);
        await other.getByRole("tab", { name: s.views.products, exact: true }).click();
        await other.locator(`button[data-row-key="${committed.items[0]?.id ?? ""}"]`).click();
        const saved = other.getByRole("dialog");
        await expect(saved.getByRole("textbox", { name: s.description, exact: true })).toHaveValue(
            description,
        );
        await expect(saved.getByRole("textbox", { name: s.cost, exact: true })).toHaveValue("7.00");
        await page.reload();
        await expectStockReplica(page, fixture, 9);
        expect(await catalogEvidence(fixture)).toEqual(committed);
        await testInfo.attach("initial-create-recovery", {
            body: JSON.stringify(committed),
            contentType: "application/json",
        });
    } finally {
        await observer.close();
    }
});

test("STR-E10 a price in another currency is refused with the catalog copy and nothing is saved", async ({
    page,
}, testInfo) => {
    await signIn(page);
    const fixture = catalogFixture(page);
    const editor = await newProduct(page);
    await fillProduct(editor, fixture.name);
    const refusals: { method: string; status: number; error: unknown }[] = [];
    // The editor only offers the business currency, so the request carries the foreign one.
    const inUsd = async (route: Route): Promise<void> => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        const response = await route.fetch({ postData: { ...body, currency: "USD" } });
        const answer = (await response.json()) as { error?: unknown };
        refusals.push({
            method: route.request().method(),
            status: response.status(),
            error: answer.error,
        });
        await route.fulfill({ response });
    };
    await page.route("**/v1/items", inUsd);
    const submit = editor.getByRole("button", { name: s.add, exact: true });
    await submit.click();
    await expect(editor.getByText(strings.api.unsupportedCurrency, { exact: true })).toBeVisible();
    expect(refusals).toEqual([{ method: "POST", status: 422, error: "unsupported_currency" }]);
    expect(await catalogEvidence(fixture)).toEqual({
        items: [],
        movements: [],
        audits: [],
        receipts: [],
    });
    await page.unroute("**/v1/items", inUsd);
    await submit.click();
    await expect(editor).toBeHidden();
    const created = await expectCatalogCommitted(fixture, 7, s.openingStockNote);
    const id = created.items[0]?.id ?? "";
    expect(await itemCurrency(id)).toBe("CAD");

    await page.route(`**/v1/items/${id}`, inUsd);
    await page.locator(`button[data-row-key="${id}"]`).click();
    const edit = page.getByRole("dialog");
    await edit.getByRole("textbox", { name: s.price, exact: true }).fill("18");
    const save = edit.getByRole("button", { name: s.save, exact: true });
    await save.click();
    await expect(edit.getByText(strings.api.unsupportedCurrency, { exact: true })).toBeVisible();
    expect(refusals.at(-1)).toEqual({
        method: "PATCH",
        status: 422,
        error: "unsupported_currency",
    });
    expect(await catalogEvidence(fixture)).toEqual(created);
    expect(await itemCurrency(id)).toBe("CAD");
    await testInfo.attach("currency-refusals", {
        body: JSON.stringify({ refusals, item: created.items[0] }),
        contentType: "application/json",
    });
});

test("CFG-E2E-13 the length, clean-up, deposit and members set on a service are what Connect offers, and a new price reaches it", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(180_000);
    await signIn(page);
    const slug = demoSlug("birchbark");
    const name = `Coat refresh for ${demoPerson(randomUUID())}`;
    const hannah = await teamMember(page, runEmail("hannah@birchbark.example"));
    const diego = await teamMember(page, runEmail("diego@birchbark.example"));
    const priya = await teamMember(page, runEmail("priya@birchbark.example"));
    const editor = await newBookable(page, "service");
    await editor.getByRole("textbox", { name: s.name, exact: true }).fill(name);
    await editor.getByRole("textbox", { name: s.price, exact: true }).fill("80");
    await editor.getByRole("textbox", { name: s.durationLabel, exact: true }).fill("60");
    await editor.getByRole("textbox", { name: s.bufferAfter, exact: true }).fill("10");
    const offeredBy = editor.getByRole("group", { name: s.offeredBy, exact: true });
    await offeredBy.locator(`button[data-value="${hannah.id}"]`).click();
    await offeredBy.locator(`button[data-value="${diego.id}"]`).click();
    await editor
        .getByRole("group", { name: s.sectionDeposit, exact: true })
        .locator('button[data-value="percent"]')
        .click();
    await editor.getByRole("textbox", { name: s.depositPercentLabel, exact: true }).fill("25");
    await expect(
        editor.getByText(s.depositSummary(formatMoney(2000, "CAD"), formatMoney(6000, "CAD"))),
    ).toBeVisible();
    const item = await saveItem<SavedItem>(page, editor, "POST");
    expect(item).toMatchObject({
        price_cents: 8000,
        duration_min: 60,
        buffer_after_min: 10,
        deposit_type: "percent",
        deposit_value: 25,
        staff_ids: [diego.id, hannah.id].sort(),
    });

    const context = await customerContext(browser);
    try {
        const client = await context.newPage();
        const card = async (visitor: Page) => {
            await visitor.goto(connectUrl(slug));
            await expect(visitor.getByRole("heading", { name: b.stepService })).toBeVisible();
            return visitor.getByRole("button").filter({ hasText: name });
        };
        const listed = await card(client);
        await expect(listed).toContainText(b.deposit(formatMoney(2000, "CAD")));
        await expect(listed).toContainText(formatMoney(8000, "CAD"));
        await listed.click();
        const extras = client.getByText(b.oftenAdded, { exact: true });
        const days = client.getByRole("radiogroup", { name: b.date, exact: true });
        await expect(days.or(extras)).toBeVisible();
        if (await extras.isVisible())
            await client.getByRole("button", { name: b.continue, exact: true }).first().click();
        expect(await choiceKeys(client.getByRole("group", { name: b.with, exact: true }))).toEqual(
            ["any", diego.id, hannah.id].sort(),
        );

        const slots = async (staffId: string, date: string) =>
            context.request.get(`${bookingApi()}/book/${slug}/slots`, {
                params: { item_id: item.id, staff_id: staffId, date },
            });
        // each visit blocks its hour and the clean-up, so open starts sit 70 minutes apart or more
        let starts: number[] = [];
        let adjacent = false;
        for (let offset = 14; offset < 28 && !adjacent; offset++) {
            const date = dateKey(addDays(new Date(), offset, ZONE), ZONE);
            const response = await slots(diego.id, date);
            expect(response.status(), await response.text()).toBe(200);
            const open = (
                (await response.json()) as { slots: { starts_at: string; ends_at: string }[] }
            ).slots;
            for (const slot of open)
                expect(Date.parse(slot.ends_at) - Date.parse(slot.starts_at)).toBe(60 * MIN);
            starts = open.map((slot) => Date.parse(slot.starts_at));
            const gaps = starts.slice(1).map((start, k) => (start - (starts[k] ?? 0)) / MIN);
            for (const gap of gaps) expect(gap, date).toBeGreaterThanOrEqual(70);
            adjacent = gaps.includes(70);
        }
        expect(adjacent).toBe(true);
        const unoffered = await slots(priya.id, dateKey(new Date(starts[0] ?? 0), ZONE));
        expect(unoffered.status(), await unoffered.text()).toBe(422);
        expect(((await unoffered.json()) as { error: string }).error).toBe("service_not_offered");

        await page.locator(`button[data-row-key="${item.id}"]`).click();
        const edit = page.getByRole("dialog");
        await edit.getByRole("textbox", { name: s.price, exact: true }).fill("95");
        const repriced = await saveItem<SavedItem>(page, edit, "PATCH");
        expect(repriced.price_cents).toBe(9500);
        // a returning visitor resumes their draft, so a new one reads the list again
        const relisted = await card(await context.newPage());
        await expect(relisted).toContainText(formatMoney(9500, "CAD"));
        await expect(relisted).toContainText(b.deposit(formatMoney(2375, "CAD")));
        await testInfo.attach("service-on-connect", {
            body: JSON.stringify({ item, repriced, starts }),
            contentType: "application/json",
        });
    } finally {
        await context.close();
    }
});

test("CFG-E2E-15 a class needs a size and a program room for more than one, and a class of six seats two online bookers in one session", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(180_000);
    await signIn(page);
    const slug = demoSlug("birchbark");
    const name = `Agility basics for ${demoPerson(randomUUID())}`;
    const saved = () => select<{ id: string }>`SELECT id FROM items WHERE name = ${name}`;
    const posts: string[] = [];
    page.on("request", (request) => {
        if (request.method() === "POST" && new URL(request.url()).pathname === "/v1/items")
            posts.push(request.url());
    });
    const editor = await newBookable(page, "class");
    await editor.getByRole("textbox", { name: s.name, exact: true }).fill(name);
    await editor.getByRole("textbox", { name: s.durationLabel, exact: true }).fill("60");
    const add = editor.getByRole("button", { name: s.add, exact: true });
    const refusal = async (copy: string) => {
        await add.click();
        await expect(editor.getByText(copy, { exact: true })).toBeVisible();
    };
    await refusal(s.capacityRequired);
    const size = editor.getByRole("textbox", { name: s.capacity, exact: true });
    const days = editor.getByRole("textbox", { name: s.programDays, exact: true });
    await size.fill("1");
    await days.fill("3");
    await refusal(s.programCapacity);
    await days.fill("");
    await size.fill("6");
    await editor.getByRole("textbox", { name: s.bufferBefore, exact: true }).fill("-5");
    await refusal(s.bufferInvalid);
    expect(posts).toEqual([]);
    expect(await saved()).toEqual([]);
    await editor.getByRole("textbox", { name: s.bufferBefore, exact: true }).fill("0");
    const item = await saveItem<{ id: string; capacity: number; session_count: number | null }>(
        page,
        editor,
        "POST",
    );
    expect(item).toMatchObject({ capacity: 6, session_count: null });
    await expect(page.locator(`button[data-row-key="${item.id}"]`)).toContainText(s.classSize(6));

    for (const [sizes, error] of [
        [{ capacity: null, session_count: null }, "class_size"],
        [{ capacity: 1, session_count: 3 }, "program_size"],
    ] as const) {
        const refused = await page.request.post(`${bookingApi()}/v1/items`, {
            headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
            data: { kind: "class", name, duration_min: 60, ...sizes },
        });
        expect(refused.status(), await refused.text()).toBe(422);
        expect(((await refused.json()) as { error: string }).error).toBe(error);
    }
    expect(await saved()).toEqual([{ id: item.id }]);

    const context = await customerContext(browser);
    const booked: string[] = [];
    try {
        const client = await context.newPage();
        await client.goto(connectUrl(slug));
        await expect(client.getByRole("button").filter({ hasText: name })).toBeVisible();
        let start: string | undefined;
        for (let offset = 14; offset < 28 && start === undefined; offset++) {
            const date = dateKey(addDays(new Date(), offset, ZONE), ZONE);
            const response = await context.request.get(`${bookingApi()}/book/${slug}/slots`, {
                params: { item_id: item.id, staff_id: "any", date },
            });
            expect(response.status(), await response.text()).toBe(200);
            start = ((await response.json()) as { slots: { starts_at: string }[] }).slots[0]
                ?.starts_at;
        }
        if (start === undefined) throw new Error("Connect offered no time for the class");
        for (const pet of ["Pickle", "Juniper"]) {
            const booker = onlineBooker(pet);
            const response = await context.request.post(`${bookingApi()}/book/${slug}`, {
                headers: { "Idempotency-Key": randomUUID() },
                data: {
                    item_id: item.id,
                    staff_id: "any",
                    starts_at: start,
                    client: { name: booker.name, phone: booker.phone },
                    subject_name: booker.subject,
                },
            });
            expect(response.status(), await response.text()).toBe(200);
            booked.push(((await response.json()) as { booking_id: string }).booking_id);
        }
        const seats = await select<{ slot_id: string; capacity: number }>`
            SELECT b.slot_id, s.capacity FROM bookings b JOIN slots s ON s.id = b.slot_id
            WHERE b.id = ANY(${booked}::text[])`;
        await testInfo.attach("class-seats", {
            body: JSON.stringify({ item, start, booked, seats }),
            contentType: "application/json",
        });
        expect(seats).toHaveLength(2);
        expect(new Set(seats.map((seat) => seat.slot_id)).size).toBe(1);
        expect(seats[0]?.capacity).toBe(6);
    } finally {
        for (const id of booked) await cancelOwnedBooking(page, id);
        await context.close();
    }
});
