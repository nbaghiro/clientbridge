import { randomUUID } from "node:crypto";
import { addDays, combineDayAndTime, dateKey, strings } from "@clientbridge/app-core/public";
import { demoPerson } from "@clientbridge/config/e2e/demo";
import { expect, test, type Page } from "@playwright/test";

import { bookingApi, cancelOwnedBooking } from "./support/bookings";
import {
    addClientNote,
    addPet,
    clientCommand,
    createClient,
    editClient,
    expectClientSegment,
    openClient,
    type ClientFixture,
} from "./support/crm";
import { expectPhoto, filesApi, photoEvidence, portrait } from "./support/files";
import { returningEvidence, returningFixture, verifyReturning } from "./support/returning";
import { customerContext, navigate, signIn } from "./support/session";
import { apiCall, visitEvidence } from "./support/visits";
import { demoSlug, runEmail } from "@clientbridge/config/e2e/run";

test.use({ actionTimeout: 15_000 });

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

async function openMerge(page: Page, run: string, kept: ClientFixture, other: ClientFixture) {
    await navigate(page, "/today");
    await navigate(page, "/clients");
    await page.getByRole("searchbox").fill(run);
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
    const kept = await createClient(page, demoPerson(run), run);
    const names = [`${run}:duplicate`, `${run}:paid`, `${run}:other`]
        .map((seed) => demoPerson(seed))
        .filter((name, index, all) => name !== kept.name && all.indexOf(name) === index);
    const [duplicateName, paidName] = names;
    if (duplicateName === undefined || paidName === undefined)
        throw new Error("Not enough distinct demo names");
    const duplicate = await createClient(page, duplicateName, run);
    const paid = await createClient(page, paidName, run);
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

        const merge = await openMerge(page, run, kept, duplicate);
        await expect(merge.getByText(t.moves.bookings(1), { exact: true })).toBeVisible();
        await expect(
            merge.getByText(t.moves.subjects("pet", "Juniper"), { exact: true }),
        ).toBeVisible();
        await expect(merge.getByText(t.moves.notes(1), { exact: true })).toBeVisible();
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

        const refused = await openMerge(page, run, kept, paid);
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
        await expect(record).toContainText(paid.email);
        await testInfo.attach("merge-and-refusal", {
            body: JSON.stringify(moved),
            contentType: "application/json",
        });
    } finally {
        await cancelOwnedBooking(page, bookingId);
    }
});
