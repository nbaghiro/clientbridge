import {
    formatParts,
    formatPhone,
    strings,
    addDays,
    combineDayAndTime,
    dateKey,
} from "@clientbridge/app-core/public";
import { expect, test, type Page } from "@playwright/test";
import { freshPhone } from "../support/auth";
import { cancelOwnedBooking, bookingApi } from "../support/bookings";
import {
    clientCommand,
    editClient,
    returningEvidence,
    returningFixture,
    verifyReturning,
    createClient,
    contactEvidence,
    addClientNote,
    addPet,
    expectClientSegment,
    openClient,
    type ClientFixture,
} from "../support/clients";
import { navigate, signIn, customerContext } from "../support/session";
import { demoSlug, runEmail } from "@clientbridge/config/e2e/run";
import { randomUUID } from "node:crypto";
import { demoPerson } from "@clientbridge/config/e2e/demo";
import { expectPhoto, filesApi, photoEvidence, portrait } from "../support/files";
import { apiCall, visitEvidence } from "../support/visit";

test.use({ actionTimeout: 15_000 });

test("CRM-E2E-05 verified returning customer books the selected existing pet and retains original contact data", async ({
    page,
    browser,
}) => {
    await signIn(page);
    const fixture = await returningFixture(page);
    const initial = await returningEvidence(fixture);
    const customerContext = await browser.newContext();
    let bookingId: string | undefined;
    try {
        const customer = await customerContext.newPage();
        await verifyReturning(customer, fixture, 0);
        await expect(
            customer.getByRole("textbox", { name: strings.publicBooking.name, exact: true }),
        ).toHaveValue(fixture.clientName);
        await expect(
            customer.getByRole("textbox", {
                name: `${strings.publicBooking.phone} *`,
                exact: true,
            }),
        ).toHaveValue(fixture.clientPhone);
        const submitted = customer.waitForResponse(
            (r) =>
                new URL(r.url()).pathname === `/book/${demoSlug("birchbark")}` &&
                r.request().method() === "POST",
        );
        await customer
            .getByRole("button", { name: strings.publicBooking.confirm, exact: true })
            .first()
            .click();
        const response = await submitted;
        const submittedBody = response.request().postDataJSON() as {
            returning_token: string | null;
            subject_id: string | null;
        };
        expect(submittedBody.returning_token).toEqual(expect.any(String));
        expect(submittedBody.returning_token?.length).toBeGreaterThan(0);
        expect(submittedBody.subject_id).toBe(fixture.petId);
        expect(response.status(), await response.text()).toBe(200);
        const result = (await response.json()) as { booking_id: string; status: string };
        bookingId = result.booking_id;
        expect(result.status).toBe("pending");
        await expect(
            customer.getByRole("heading", {
                name: strings.publicBooking.pendingTitle,
                exact: true,
            }),
        ).toBeVisible();
        const committed = await returningEvidence(fixture);
        expect(committed.clients).toEqual(initial.clients);
        expect(committed.subjects).toEqual(initial.subjects);
        expect(committed.bookings).toEqual([
            expect.objectContaining({
                id: bookingId,
                client_id: fixture.clientId,
                subject_id: fixture.petId,
                status: "pending",
                source: "online",
                price_cents: 1000,
                deposit_amount_cents: 0,
                deposit_status: "none",
            }),
        ]);
        expect(committed.slots).toEqual([
            expect.objectContaining({ item_id: fixture.itemId, staff_id: fixture.staffId }),
        ]);
        expect(committed.challenges).toEqual([
            expect.objectContaining({ client_id: fixture.clientId, verified: true }),
        ]);
        const observerContext = await browser.newContext();
        try {
            const observer = await observerContext.newPage();
            await signIn(observer);
            await navigate(observer, `/schedule?open=${bookingId}`);
            const heading = observer.getByRole("heading", {
                name: formatParts(["Clover", fixture.clientName]),
                exact: true,
            });
            const service = observer.getByText(fixture.itemName, { exact: true }).first();
            await expect(heading).toBeVisible({ timeout: 60_000 });
            await expect(service).toBeVisible();
            await observer.reload();
            await navigate(observer, `/schedule?open=${bookingId}`);
            await expect(heading).toBeVisible({ timeout: 60_000 });
            await expect(service).toBeVisible();
            expect(await returningEvidence(fixture)).toEqual(committed);
        } finally {
            await observerContext.close();
        }
    } finally {
        try {
            if (bookingId) await cancelOwnedBooking(page, bookingId);
        } finally {
            await customerContext.close();
        }
    }
});

test("CRM-E2E-06 archiving a verified customer revokes their proof before public booking", async ({
    page,
    browser,
}) => {
    await signIn(page);
    const fixture = await returningFixture(page);
    const customerContext = await browser.newContext();
    try {
        const customer = await customerContext.newPage();
        await verifyReturning(customer, fixture, 1);
        const editor = await editClient(page, fixture.client);
        await editor
            .getByRole("button", { name: strings.clients.edit.archive, exact: true })
            .click();
        const archived = clientCommand(page, `/${fixture.clientId}/archive`, "POST");
        await page
            .getByRole("dialog", {
                name: strings.clients.edit.archiveTitle(fixture.clientName),
                exact: true,
            })
            .getByRole("button", { name: strings.clients.edit.archiveConfirm, exact: true })
            .click();
        expect((await archived).status()).toBe(200);
        const before = await returningEvidence(fixture);
        expect(before.clients).toEqual([
            expect.objectContaining({ id: fixture.clientId, status: "inactive" }),
        ]);
        expect(before.bookings).toEqual([]);
        expect(before.slots).toEqual([]);
        const submitted = customer.waitForResponse(
            (r) =>
                new URL(r.url()).pathname === `/book/${demoSlug("birchbark")}` &&
                r.request().method() === "POST",
        );
        await customer
            .getByRole("button", { name: strings.publicBooking.confirm, exact: true })
            .first()
            .click();
        const rejected = await submitted;
        expect(rejected.status(), await rejected.text()).toBe(401);
        expect(await rejected.json()).toMatchObject({ error: "unauthorized" });
        await expect(
            customer.getByText(strings.publicBooking.bookError, { exact: true }).first(),
        ).toBeVisible();
        expect(await returningEvidence(fixture)).toEqual(before);
        await page.reload();
        expect(await returningEvidence(fixture)).toEqual(before);
    } finally {
        await customerContext.close();
    }
});

test("CRM-E2E-07 editing a verified phone clears proof, so the visit is booked for the number typed", async ({
    page,
    browser,
}) => {
    await signIn(page);
    const fixture = await returningFixture(page);
    const phone = freshPhone();
    const evidence = () => contactEvidence([fixture.clientPhone, phone], fixture.itemId);
    const customerContext = await browser.newContext();
    let bookingId: string | undefined;
    try {
        const customer = await customerContext.newPage();
        await verifyReturning(customer, fixture, 1);
        const baseline = await evidence();
        expect(baseline.clients.map((c) => c.id)).toEqual([fixture.clientId]);
        expect(baseline.bookings).toEqual([]);
        await customer
            .getByRole("textbox", { name: `${strings.publicBooking.phone} *`, exact: true })
            .fill(phone);
        const submitting = customer.waitForResponse(
            (r) =>
                new URL(r.url()).pathname === `/book/${demoSlug("birchbark")}` &&
                r.request().method() === "POST",
        );
        await customer
            .getByRole("button", { name: strings.publicBooking.confirm, exact: true })
            .first()
            .click();
        const response = await submitting;
        expect(response.request().postDataJSON()).toMatchObject({
            returning_token: null,
            subject_id: null,
            client: { name: fixture.clientName, phone },
        });
        expect(response.status(), await response.text()).toBe(200);
        bookingId = ((await response.json()) as { booking_id: string }).booking_id;
        const booked = await evidence();
        const typed = booked.clients.find((c) => c.phone === phone);
        expect(typed?.id).toBeDefined();
        expect(typed?.id).not.toBe(fixture.clientId);
        expect(booked.clients.find((c) => c.id === fixture.clientId)).toEqual(baseline.clients[0]);
        const pet = booked.subjects.find((x) => x.client_id === typed?.id);
        expect(pet?.id).toBeDefined();
        expect(booked.bookings).toEqual([
            expect.objectContaining({ id: bookingId, client_id: typed?.id, subject_id: pet?.id }),
        ]);
    } finally {
        try {
            if (bookingId) await cancelOwnedBooking(page, bookingId);
        } finally {
            await customerContext.close();
        }
    }
});

const h = strings.clients.history;
const t = strings.clients.tidy;
const ZONE = "America/Vancouver";

async function expectTimeline(
    page: Page,
    client: ClientFixture,
    entries: readonly string[],
): Promise<void> {
    await navigate(page, "/today");
    await navigate(page, `/clients/${client.id}/history`);
    await expect(page.getByRole("heading", { name: client.name, exact: true })).toBeVisible({
        timeout: 60_000,
    });
    for (const entry of entries)
        await expect(page.getByText(entry, { exact: true }).first()).toBeVisible({
            timeout: 60_000,
        });
}

async function archive(page: Page, client: ClientFixture): Promise<void> {
    const editor = await editClient(page, client);
    await editor.getByRole("button", { name: strings.clients.edit.archive, exact: true }).click();
    const archived = clientCommand(page, `/${client.id}/archive`, "POST");
    await page
        .getByRole("dialog", { name: strings.clients.edit.archiveTitle(client.name), exact: true })
        .getByRole("button", { name: strings.clients.edit.archiveConfirm, exact: true })
        .click();
    const response = await archived;
    expect(response.status(), await response.text()).toBe(200);
}

/** Books a staff visit for a client's pet at the first free hour some weeks out. */
async function bookVisit(
    page: Page,
    client: ClientFixture,
    subjectId: string,
    itemId: string,
    staffId: string,
): Promise<string> {
    for (let offset = 35; offset < 49; offset++) {
        const day = dateKey(addDays(new Date(), offset, ZONE), ZONE);
        for (const time of ["10:00", "11:00", "13:00", "14:00", "15:00"]) {
            const response = await page.request.post(`${bookingApi()}/v1/bookings`, {
                headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
                data: {
                    client_id: client.id,
                    subject_id: subjectId,
                    item_id: itemId,
                    staff_id: staffId,
                    starts_at: combineDayAndTime(day, time, ZONE).toISOString(),
                    notify: false,
                },
            });
            if (response.status() === 201) return ((await response.json()) as { id: string }).id;
            expect(response.status(), await response.text()).toBe(409);
        }
    }
    throw new Error("No free hour for the visit");
}

async function openMerge(page: Page, search: string, kept: ClientFixture, other: ClientFixture) {
    await navigate(page, "/today");
    await navigate(page, "/clients");
    await page.getByRole("searchbox").fill(search);
    await page.getByRole("button", { name: t.select, exact: true }).click();
    await page.getByRole("checkbox", { name: kept.name, exact: true }).check();
    await page.getByRole("checkbox", { name: other.name, exact: true }).check();
    await page.getByRole("button", { name: t.mergeSelected, exact: true }).click();
    const merge = page.getByRole("dialog", { name: t.mergeTitle, exact: true });
    await merge
        .getByRole("group", { name: t.whichToKeep, exact: true })
        .getByRole("button")
        .filter({ hasText: kept.name })
        .click();
    return merge;
}

test("FLOW-04-A a verified returning client's pet, note, photo and booking stay on their timeline after archive and reload", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(240_000);
    await signIn(page);
    const fixture = await returningFixture(page);
    const note = "Clover is nervous around the dryer. Use the quiet room and towel dry.";
    await addClientNote(page, fixture.client, note, "Clover");
    const photo = await portrait();
    const clear = `${filesApi()}/v1/files/photos/client/${fixture.clientId}`;
    const customer = await customerContext(browser);
    let bookingId: string | undefined;
    try {
        const editor = await editClient(page, fixture.client);
        const completed = page.waitForResponse(
            (response) =>
                /^\/v1\/files\/[^/]+\/complete$/.test(new URL(response.url()).pathname) &&
                response.request().method() === "POST",
        );
        await editor.locator('input[type="file"]').setInputFiles({
            name: photo.name,
            mimeType: photo.mimeType,
            buffer: photo.buffer,
        });
        expect((await completed).status()).toBe(200);
        await expectPhoto(editor, page, photo.sha256);
        await page.keyboard.press("Escape");
        await expect(editor).toHaveCount(0);

        const visitor = await customer.newPage();
        await verifyReturning(visitor, fixture, 0);
        const submitted = visitor.waitForResponse(
            (r) =>
                new URL(r.url()).pathname === `/book/${demoSlug("birchbark")}` &&
                r.request().method() === "POST",
        );
        await visitor
            .getByRole("button", { name: strings.publicBooking.confirm, exact: true })
            .first()
            .click();
        const booked = await submitted;
        expect(booked.status(), await booked.text()).toBe(200);
        expect(booked.request().postDataJSON()).toMatchObject({ subject_id: fixture.petId });
        bookingId = ((await booked.json()) as { booking_id: string }).booking_id;
        await expect(
            visitor.getByRole("heading", { name: strings.publicBooking.pendingTitle, exact: true }),
        ).toBeVisible();

        const visit = h.visit(fixture.itemName, "Clover");
        await expectTimeline(page, fixture.client, [visit, note]);
        const before = await returningEvidence(fixture);
        expect(before.clients).toEqual([
            expect.objectContaining({ id: fixture.clientId, status: "active" }),
        ]);
        expect(before.bookings).toEqual([
            expect.objectContaining({
                id: bookingId,
                subject_id: fixture.petId,
                status: "pending",
            }),
        ]);
        const stored = await photoEvidence(fixture.clientId);
        expect(stored).toEqual([
            expect.objectContaining({
                storage: { size: photo.buffer.length, sha256: photo.sha256 },
            }),
        ]);

        await archive(page, fixture.client);
        const after = await returningEvidence(fixture);
        expect(after.clients).toEqual([
            expect.objectContaining({ id: fixture.clientId, status: "inactive" }),
        ]);
        expect(after.subjects).toEqual(before.subjects);
        expect(after.bookings).toEqual(before.bookings);
        expect(await photoEvidence(fixture.clientId)).toEqual(stored);

        const observer = await browser.newContext({ baseURL: new URL(page.url()).origin });
        try {
            const other = await observer.newPage();
            await signIn(other);
            await expectClientSegment(other, fixture.client, true);
            await expectTimeline(other, fixture.client, [visit, note]);
            await other.reload();
            await expectTimeline(other, fixture.client, [visit, note]);
            const record = await openClient(other, fixture.client);
            await expect(
                record.getByText(strings.clients.record.archived, { exact: true }).first(),
            ).toBeVisible();
            for (const pet of ["Maple", "Clover"])
                await expect(
                    record.getByRole("button", {
                        name: strings.subjects.editNamed(pet),
                        exact: true,
                    }),
                ).toBeVisible();
            await expectPhoto(await editClient(other, fixture.client), other, photo.sha256);
        } finally {
            await observer.close();
        }
        expect(await returningEvidence(fixture)).toEqual(after);
        await testInfo.attach("archived-timeline", {
            body: JSON.stringify(after),
            contentType: "application/json",
        });
    } finally {
        try {
            if (bookingId !== undefined) await cancelOwnedBooking(page, bookingId);
            const removed = await page.request.delete(clear, {
                headers: { Origin: new URL(page.url()).origin },
            });
            expect(removed.status(), await removed.text()).toBe(204);
        } finally {
            await customer.close();
        }
    }
});

test("FLOW-04-B a merge moves a duplicate's pet, note and visit onto the kept timeline, and a record with payments is refused", async ({
    page,
}, testInfo) => {
    test.setTimeout(240_000);
    await signIn(page);
    const run = randomUUID();
    // the numbers share all but their last digit, so one search finds the three and nobody else
    const shared = freshPhone().slice(0, -1);
    const kept = await createClient(page, demoPerson(run), `${shared}1`);
    const names = [`${run}:duplicate`, `${run}:paid`, `${run}:other`]
        .map((seed) => demoPerson(seed))
        .filter((name, index, all) => name !== kept.name && all.indexOf(name) === index);
    const [duplicateName, paidName] = names;
    if (duplicateName === undefined || paidName === undefined)
        throw new Error("Not enough distinct demo names");
    const duplicate = await createClient(page, duplicateName, `${shared}2`);
    const paid = await createClient(page, paidName, `${shared}3`);
    const petId = await addPet(page, duplicate, "Juniper");
    const note = "Juniper prefers a short trim around the paws.";
    await addClientNote(page, duplicate, note, "Juniper");
    const service = await apiCall<{ id: string; name: string }>(
        page,
        "POST",
        "/v1/items",
        {
            kind: "service",
            name: `Puppy tidy for ${duplicate.name}`,
            duration_min: 30,
            price_cents: 4500,
            deposit_type: "none",
            online_bookable: false,
        },
        201,
    );
    const team = await page.request.get(`${bookingApi()}/v1/staff/team`);
    const owner = (
        (await team.json()) as { members: { id: string; email: string }[] }
    ).members.find((member) => member.email === runEmail("hannah@birchbark.example"));
    if (owner === undefined) throw new Error("The Birch & Bark owner is missing");
    const bookingId = await bookVisit(page, duplicate, petId, service.id, owner.id);
    const invoice = await apiCall<{ id: string; total_cents: number }>(
        page,
        "POST",
        "/v1/invoices",
        {
            client_id: paid.id,
            send: true,
            lines: [
                {
                    description: "Nail trim",
                    quantity: 1,
                    unit_amount_cents: 2000,
                    tax_class: "exempt",
                },
            ],
        },
        201,
    );
    await apiCall(
        page,
        "POST",
        `/v1/invoices/${invoice.id}/payments`,
        { method: "cash", amount_cents: 2000, tendered_cents: 2000, send_receipt: false },
        201,
    );
    try {
        const start = await visitEvidence([kept.id, duplicate.id, paid.id]);
        expect(start.bookings).toEqual([
            expect.objectContaining({ id: bookingId, client_id: duplicate.id, subject_id: petId }),
        ]);
        expect(start.payments).toEqual([
            expect.objectContaining({
                kind: "payment",
                amount_cents: 2000,
                invoice_id: invoice.id,
            }),
        ]);

        const merge = await openMerge(page, shared.slice(2), kept, duplicate);
        // the note is about Juniper, so it moves with the pet rather than counting on its own
        await expect(merge.getByRole("listitem")).toHaveText([
            t.moves.bookings(1),
            t.moves.subjects("pet", "Juniper"),
        ]);
        await merge.getByRole("button", { name: t.merge(kept.name), exact: true }).click();
        const merging = clientCommand(page, `/${kept.id}/merge`, "POST");
        await page
            .getByRole("dialog")
            .filter({ hasText: t.mergeConfirmBody(duplicate.name, kept.name) })
            .getByRole("button", { name: t.mergeConfirm, exact: true })
            .click();
        const merged = await merging;
        expect(merged.status(), await merged.text()).toBe(200);
        expect(merged.request().postDataJSON()).toMatchObject({ from_client_id: duplicate.id });
        const moved = await visitEvidence([kept.id, duplicate.id, paid.id]);
        expect(moved.bookings).toEqual([
            expect.objectContaining({ id: bookingId, client_id: kept.id, subject_id: petId }),
        ]);
        expect(moved.subjects).toEqual([
            expect.objectContaining({ id: petId, client_id: kept.id, name: "Juniper" }),
        ]);
        expect(moved.payments).toEqual(start.payments);
        await expectTimeline(page, kept, [h.visit(service.name, "Juniper"), note]);
        await navigate(page, `/clients/${duplicate.id}/history`);
        await expect(
            page.getByText(strings.clients.record.goneBody, { exact: true }),
        ).toBeVisible();
        await page.reload();
        await expectTimeline(page, kept, [h.visit(service.name, "Juniper"), note]);

        const refused = await openMerge(page, shared.slice(2), kept, paid);
        await expect(refused.getByText(t.blockedMoney, { exact: true })).toBeVisible();
        await expect(
            refused.getByRole("button", { name: t.merge(kept.name), exact: true }),
        ).toBeDisabled();
        const direct = await page.request.post(`${bookingApi()}/v1/clients/${kept.id}/merge`, {
            headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
            data: { from_client_id: paid.id, fields: {} },
        });
        expect(direct.status(), await direct.text()).toBe(409);
        expect(await visitEvidence([kept.id, duplicate.id, paid.id])).toEqual(moved);
        await page.keyboard.press("Escape");
        const record = await openClient(page, paid);
        await expect(record).toContainText(formatPhone(paid.phone));
        await testInfo.attach("merge-and-refusal", {
            body: JSON.stringify(moved),
            contentType: "application/json",
        });
    } finally {
        await cancelOwnedBooking(page, bookingId);
    }
});
