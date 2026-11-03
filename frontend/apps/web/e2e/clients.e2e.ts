import { randomUUID } from "node:crypto";
import { demoPerson } from "@clientbridge/config/e2e/demo";
import { strings, formatParts, formatPhone } from "@clientbridge/app-core/public";
import { expect, type Page, test } from "@playwright/test";
import {
    addClientNote,
    addPet,
    clientCommand,
    createClient,
    crmCommand,
    editClient,
    expectClientSegment,
    openClient,
} from "./support/clients";
import { runEmail } from "@clientbridge/config/e2e/run";
import { navigate, signIn } from "./support/session";
import { newAccount, freshPhone } from "./support/auth";
import {
    bookingApi,
    chooseFreeBookingTime,
    fillBookingComposer,
    openBooking,
    type BookingRecord,
} from "./support/bookings";
import { openBusiness, signUp } from "./support/business";
import { apiCall, visitEvidence } from "./support/visit";

test("CRM-E2E-01 create, edit, archive and restore persist across independent replicas", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(180_000);
    const run = randomUUID();
    const original = { name: demoPerson(run), phone: freshPhone() };
    await signIn(page);
    const observer = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        viewport: { width: 1440, height: 900 },
    });
    try {
        const other = await observer.newPage();
        await signIn(other);
        await navigate(page, "/clients");
        await page.getByRole("button", { name: strings.clients.add, exact: true }).click();
        const add = page.getByRole("dialog", { name: strings.clients.edit.addTitle, exact: true });
        await add
            .getByRole("textbox", { name: strings.clients.edit.nameLabel })
            .fill(original.name);
        await add
            .getByRole("textbox", { name: strings.clients.edit.phoneLabel })
            .fill(original.phone);
        const creating = clientCommand(page, "", "POST");
        await add.getByRole("button", { name: strings.clients.edit.add, exact: true }).click();
        const created = await creating;
        expect(created.status(), await created.text()).toBe(201);
        const body = (await created.json()) as { id: string };
        const client = { ...original, id: body.id };
        expect(client.id).toMatch(/^cl_/);
        await testInfo.attach("client-fixture", {
            body: JSON.stringify(client),
            contentType: "application/json",
        });
        await test.step("creation reaches both independent replicas", async () => {
            await openClient(page, client);
            await openClient(other, client);
            await other.reload();
            await openClient(other, client);
        });
        const updated = {
            ...client,
            name: demoPerson(`${run}:updated`),
            phone: freshPhone(),
        };
        await test.step("edit contact fields through the UI and verify reload", async () => {
            const editor = await editClient(page, client);
            await editor
                .getByRole("textbox", { name: strings.clients.edit.nameLabel })
                .fill(updated.name);
            await editor
                .getByRole("textbox", { name: strings.clients.edit.phoneLabel })
                .fill(updated.phone);
            const saving = clientCommand(page, `/${client.id}`, "PATCH");
            await editor
                .getByRole("button", { name: strings.clients.edit.save, exact: true })
                .click();
            const saved = await saving;
            expect(saved.status(), await saved.text()).toBe(200);
            expect(await saved.json()).toMatchObject({
                id: client.id,
                name: updated.name,
                phone: updated.phone,
            });
            await openClient(page, updated);
            await openClient(other, updated);
            await other.reload();
            const persisted = await editClient(other, updated);
            await expect(
                persisted.getByRole("button", { name: strings.clients.edit.save, exact: true }),
            ).toBeDisabled();
            await persisted
                .getByRole("button", { name: strings.common.cancel, exact: true })
                .click();
        });
        await test.step("archive with confirmation and preserve the record", async () => {
            const editor = await editClient(page, updated);
            await editor
                .getByRole("button", { name: strings.clients.edit.archive, exact: true })
                .click();
            const confirmation = page.getByRole("dialog", {
                name: strings.clients.edit.archiveTitle(updated.name),
                exact: true,
            });
            await confirmation
                .getByRole("button", { name: strings.common.cancel, exact: true })
                .click();
            await expect(
                editor.getByRole("button", { name: strings.clients.edit.restore, exact: true }),
            ).toHaveCount(0);
            await editor
                .getByRole("button", { name: strings.clients.edit.archive, exact: true })
                .click();
            const archiving = clientCommand(page, `/${client.id}/archive`, "POST");
            await confirmation
                .getByRole("button", { name: strings.clients.edit.archiveConfirm, exact: true })
                .click();
            const archived = await archiving;
            expect(archived.status(), await archived.text()).toBe(200);
            expect(await archived.json()).toMatchObject({
                id: client.id,
                status: "inactive",
                archived_at: expect.any(String),
            });
            await expect(
                editor.getByRole("button", { name: strings.clients.edit.restore, exact: true }),
            ).toBeVisible();
            await editor.getByRole("button", { name: strings.common.cancel, exact: true }).click();
            await expectClientSegment(other, updated, true);
            await other.reload();
            const persisted = await editClient(other, updated);
            await expect(
                persisted.getByRole("button", { name: strings.clients.edit.restore, exact: true }),
            ).toBeVisible();
            await persisted
                .getByRole("button", { name: strings.common.cancel, exact: true })
                .click();
        });
        await test.step("restore from the independent device and observe the original", async () => {
            const editor = await editClient(other, updated);
            const restoring = clientCommand(other, `/${client.id}/restore`, "POST");
            await editor
                .getByRole("button", { name: strings.clients.edit.restore, exact: true })
                .click();
            const restored = await restoring;
            expect(restored.status(), await restored.text()).toBe(200);
            expect(await restored.json()).toMatchObject({
                id: client.id,
                status: "active",
                archived_at: null,
            });
            await expect(
                editor.getByRole("button", { name: strings.clients.edit.archive, exact: true }),
            ).toBeVisible();
            await editor.getByRole("button", { name: strings.common.cancel, exact: true }).click();
            await expectClientSegment(page, updated, false);
            await page.reload();
            const persisted = await editClient(page, updated);
            await expect(
                persisted.getByRole("button", { name: strings.clients.edit.archive, exact: true }),
            ).toBeVisible();
            await expect(
                persisted.getByRole("button", { name: strings.clients.edit.restore, exact: true }),
            ).toHaveCount(0);
        });
    } finally {
        await observer.close();
    }
});

test("CRM-E2E-02 note creation, pinning and confirmed deletion reach another replica", async ({
    page,
    browser,
}) => {
    await signIn(page);
    const client = await createClient(page);
    const body =
        "Prefers a quiet room during grooming.\nPlease call when Maple is ready for pickup.";
    const observer = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        viewport: { width: 1440, height: 900 },
    });
    try {
        const other = await observer.newPage();
        await signIn(other);
        const noteId = await addClientNote(page, client, body);
        const record = await openClient(page, client);
        const remote = await openClient(other, client);
        const note = record.getByRole("listitem").filter({ hasText: body });
        const remoteNote = remote.getByRole("listitem").filter({ hasText: body });
        await expect(remoteNote).toBeVisible();
        await note
            .getByRole("button", { name: strings.clients.history.editNote, exact: true })
            .click();
        const pinning = crmCommand(page, `notes/${noteId}`, "PATCH");
        await page
            .getByRole("menuitem", { name: strings.clients.history.pinNote, exact: false })
            .click();
        expect((await pinning).status()).toBe(200);
        await expect(
            remoteNote.getByText(strings.clients.record.pinned, { exact: true }),
        ).toBeVisible();
        await other.reload();
        const persisted = await openClient(other, client);
        const persistedNote = persisted.getByRole("listitem").filter({ hasText: body });
        await expect(
            persistedNote.getByText(strings.clients.record.pinned, { exact: true }),
        ).toBeVisible();
        await persistedNote
            .getByRole("button", { name: strings.clients.history.editNote, exact: true })
            .click();
        const unpinning = crmCommand(other, `notes/${noteId}`, "PATCH");
        await other
            .getByRole("menuitem", { name: strings.clients.history.unpin, exact: false })
            .click();
        expect((await unpinning).status()).toBe(200);
        await expect(note.getByText(strings.clients.record.pinned, { exact: true })).toHaveCount(0);
        await note
            .getByRole("button", { name: strings.clients.history.editNote, exact: true })
            .click();
        await page
            .getByRole("menuitem", { name: strings.clients.history.deleteNote, exact: true })
            .click();
        const confirmation = page.getByRole("dialog", {
            name: strings.clients.history.deleteNoteTitle,
            exact: true,
        });
        await confirmation
            .getByRole("button", { name: strings.common.cancel, exact: true })
            .click();
        await expect(note).toBeVisible();
        await note
            .getByRole("button", { name: strings.clients.history.editNote, exact: true })
            .click();
        await page
            .getByRole("menuitem", { name: strings.clients.history.deleteNote, exact: true })
            .click();
        const deleting = crmCommand(page, `notes/${noteId}`, "DELETE");
        await confirmation
            .getByRole("button", { name: strings.clients.history.deleteNote, exact: true })
            .click();
        expect((await deleting).status()).toBe(204);
        await expect(note).toHaveCount(0);
        await expect(persistedNote).toHaveCount(0);
        await other.reload();
        await expect(
            (await openClient(other, client)).getByText(body, { exact: true }),
        ).toHaveCount(0);
        await navigate(other, `/clients/${client.id}/history`);
        await expect(other.getByRole("heading", { name: client.name, exact: true })).toBeVisible();
        await expect(other.getByText(body, { exact: true })).toHaveCount(0);
    } finally {
        await observer.close();
    }
});

test("CRM-E2E-03 pet validation, edit and removal persist across replicas", async ({
    page,
    browser,
}) => {
    await signIn(page);
    const client = await createClient(page);
    const name = "Maple";
    const subjectId = await addPet(page, client, name);
    const observer = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        viewport: { width: 1440, height: 900 },
    });
    try {
        const other = await observer.newPage();
        await signIn(other);
        const remote = await openClient(other, client);
        await expect(
            remote.getByRole("button", { name: strings.subjects.editNamed(name), exact: true }),
        ).toBeVisible();
        const record = await openClient(page, client);
        await record
            .getByRole("button", { name: strings.subjects.editNamed(name), exact: true })
            .click();
        const editor = page.getByRole("dialog");
        const weight = editor.getByRole("textbox", {
            name: strings.subjects.fields.pet.weight,
            exact: false,
        });
        await weight.fill("0");
        await editor
            .getByRole("button", { name: strings.subjects.save("pet"), exact: true })
            .click();
        await expect(
            editor.getByText(strings.subjects.fields.pet.weightInvalid, { exact: true }),
        ).toBeVisible();
        await weight.fill("12.5");
        const edited = "Maple Rose";
        await editor.getByRole("textbox", { name: strings.subjects.nameLabel }).fill(edited);
        await editor
            .getByRole("textbox", { name: strings.subjects.fields.pet.breed, exact: false })
            .fill("Standard poodle");
        const saving = crmCommand(page, `subjects/${subjectId}`, "PATCH");
        await editor
            .getByRole("button", { name: strings.subjects.save("pet"), exact: true })
            .click();
        const saved = await saving;
        expect(saved.status()).toBe(200);
        expect(await saved.json()).toMatchObject({
            id: subjectId,
            name: edited,
            attributes: { breed: "Standard poodle", weight_kg: 12.5 },
        });
        await expect(
            remote.getByRole("button", { name: strings.subjects.editNamed(edited), exact: true }),
        ).toBeVisible();
        await other.reload();
        const persisted = await openClient(other, client);
        await persisted
            .getByRole("button", { name: strings.subjects.editNamed(edited), exact: true })
            .click();
        const remoteEditor = other.getByRole("dialog");
        await expect(
            remoteEditor.getByRole("textbox", {
                name: strings.subjects.fields.pet.weight,
                exact: false,
            }),
        ).toHaveValue("12.5");
        await expect(
            remoteEditor.getByRole("textbox", {
                name: strings.subjects.fields.pet.breed,
                exact: false,
            }),
        ).toHaveValue("Standard poodle");
        await remoteEditor
            .getByRole("button", { name: strings.subjects.remove("pet"), exact: true })
            .click();
        const confirmation = other.getByRole("dialog", {
            name: strings.subjects.removeTitle(edited),
            exact: true,
        });
        await confirmation
            .getByRole("button", { name: strings.common.cancel, exact: true })
            .click();
        await expect(
            remoteEditor.getByRole("textbox", {
                name: strings.subjects.fields.pet.weight,
                exact: false,
            }),
        ).toHaveValue("12.5");
        await remoteEditor
            .getByRole("button", { name: strings.subjects.remove("pet"), exact: true })
            .click();
        const deleting = crmCommand(other, `subjects/${subjectId}`, "DELETE");
        await confirmation
            .getByRole("button", { name: strings.subjects.removeConfirm, exact: true })
            .click();
        expect((await deleting).status()).toBe(204);
        await expect(
            record.getByRole("button", { name: strings.subjects.editNamed(edited), exact: true }),
        ).toHaveCount(0);
        await expect(
            persisted.getByRole("button", {
                name: strings.subjects.editNamed(edited),
                exact: true,
            }),
        ).toHaveCount(0);
        await page.reload();
        await expect(
            (await openClient(page, client)).getByText(edited, { exact: true }),
        ).toHaveCount(0);
    } finally {
        await observer.close();
    }
});

test("CRM-E2E-04 directional merge preserves notes, pet and note history on the chosen record", async ({
    page,
    browser,
}) => {
    await signIn(page);
    const run = randomUUID();
    // the two numbers share all but their last digit, so one search finds both and nobody else
    const shared = freshPhone().slice(0, -1);
    const target = await createClient(page, demoPerson(run), `${shared}1`);
    const otherName = demoPerson(`${run}:source`);
    const sourceName =
        otherName === target.name
            ? target.name === "Morgan Ellis"
                ? "Avery Patel"
                : "Morgan Ellis"
            : otherName;
    const source = await createClient(page, sourceName, `${shared}2`);
    const pet = "Hazel";
    await addPet(page, source, pet);
    const sourceNote = "Prefers morning appointments and a quiet waiting area.";
    const targetNote = "Please call when grooming is complete.";
    const subjectNote = "Use fragrance-free shampoo for sensitive skin.";
    await addClientNote(page, source, sourceNote);
    await addClientNote(page, source, subjectNote, pet);
    await addClientNote(page, target, targetNote);
    const observer = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        viewport: { width: 1440, height: 900 },
    });
    try {
        const other = await observer.newPage();
        await signIn(other);
        await openClient(other, source);
        await navigate(page, "/today");
        await navigate(page, "/clients");
        await page.getByRole("searchbox").fill(shared.slice(2));
        await page.getByRole("button", { name: strings.clients.tidy.select, exact: true }).click();
        await page.getByRole("checkbox", { name: target.name, exact: true }).check();
        await page.getByRole("checkbox", { name: source.name, exact: true }).check();
        await page
            .getByRole("button", { name: strings.clients.tidy.mergeSelected, exact: true })
            .click();
        const merge = page.getByRole("dialog", {
            name: strings.clients.tidy.mergeTitle,
            exact: true,
        });
        await merge
            .getByRole("group", { name: strings.clients.tidy.whichToKeep, exact: true })
            .getByRole("button")
            .filter({ hasText: target.name })
            .click();
        await expect(
            merge.getByText(strings.clients.tidy.moves.subjects("pet", pet), { exact: true }),
        ).toBeVisible();
        await expect(
            merge.getByText(strings.clients.tidy.moves.notes(1), { exact: true }),
        ).toBeVisible();
        await merge
            .getByRole("button", { name: strings.clients.tidy.merge(target.name), exact: true })
            .click();
        const confirmation = page
            .getByRole("dialog")
            .filter({ hasText: strings.clients.tidy.mergeConfirmBody(source.name, target.name) });
        await confirmation
            .getByRole("button", { name: strings.common.cancel, exact: true })
            .click();
        await expect(merge).toBeVisible();
        await expect(
            (await openClient(other, source)).getByText(sourceNote, { exact: true }),
        ).toBeVisible();
        await merge
            .getByRole("button", { name: strings.clients.tidy.merge(target.name), exact: true })
            .click();
        const merging = clientCommand(page, `/${target.id}/merge`, "POST");
        await confirmation
            .getByRole("button", { name: strings.clients.tidy.mergeConfirm, exact: true })
            .click();
        const merged = await merging;
        expect(merged.status(), await merged.text()).toBe(200);
        expect(merged.request().postDataJSON()).toMatchObject({ from_client_id: source.id });
        expect(await merged.json()).toMatchObject({
            id: target.id,
            name: target.name,
            phone: target.phone,
        });
        await expect(merge).toHaveCount(0);
        for (const device of [page, other]) {
            const kept = await openClient(device, target);
            await expect(kept.getByText(sourceNote, { exact: true })).toBeVisible();
            await expect(kept.getByText(targetNote, { exact: true })).toBeVisible();
            await expect(kept.getByText(subjectNote, { exact: true })).toBeVisible();
            await expect(
                kept.getByRole("button", { name: strings.subjects.editNamed(pet), exact: true }),
            ).toBeVisible();
        }
        await other.reload();
        const persisted = await openClient(other, target);
        await expect(persisted.getByText(sourceNote, { exact: true })).toBeVisible();
        await expect(
            persisted.getByRole("button", { name: strings.subjects.editNamed(pet), exact: true }),
        ).toBeVisible();
        await navigate(other, `/clients/${target.id}/history`);
        await expect(other.getByRole("heading", { name: target.name, exact: true })).toBeVisible();
        await expect(other.getByText(sourceNote, { exact: true })).toBeVisible();
        await expect(other.getByText(targetNote, { exact: true })).toBeVisible();
        await expect(other.getByText(subjectNote, { exact: true })).toBeVisible();
        await navigate(other, `/clients/${source.id}/history`);
        await expect(
            other.getByText(strings.clients.record.goneBody, { exact: true }),
        ).toBeVisible();
        await navigate(other, "/clients");
        await other.getByRole("searchbox").fill(source.phone.slice(2));
        await expect(other.getByRole("button").filter({ hasText: source.name })).toHaveCount(0);
    } finally {
        await observer.close();
    }
});

const v = strings.subjects.fields.vehicle;

test("CRM-E2E-08 a detailing business books a client's parked vehicle as the visit's subject", async ({
    page,
    request,
}, testInfo) => {
    test.setTimeout(240_000);
    const account = newAccount("detailing");
    await signUp(page, request, account);
    await openBusiness(page, `${account.name} Mobile Detailing`, "detailing");
    const client = await createClient(page);
    const record = await openClient(page, client);
    await record
        .getByRole("button", { name: strings.subjects.add("vehicle"), exact: true })
        .click();
    const form = page.getByRole("dialog", { name: strings.subjects.add("vehicle"), exact: true });
    await expect(
        form.getByRole("textbox", { name: strings.subjects.fields.pet.breed, exact: false }),
    ).toHaveCount(0);
    await form.getByRole("textbox", { name: strings.subjects.nameLabel }).fill("Family Outback");
    await form.getByLabel(v.make, { exact: false }).fill("Subaru");
    await form.getByLabel(v.model, { exact: false }).fill("Outback");
    await form.getByLabel(v.year, { exact: false }).fill("2019");
    await form.getByLabel(v.colour, { exact: false }).fill("Forest green");
    await form.getByLabel(v.plate, { exact: false }).fill("RX4 21K");
    await form
        .getByRole("group", { name: v.size, exact: true })
        .locator('button[data-value="suv"]')
        .click();
    await form.getByLabel(v.address, { exact: false }).fill("1285 West Pender Street, Vancouver");
    const saving = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === "/v1/subjects" &&
            response.request().method() === "POST",
    );
    await form.getByRole("button", { name: strings.subjects.save("vehicle"), exact: true }).click();
    const saved = await saving;
    expect(saved.status(), await saved.text()).toBe(201);
    const vehicle = ((await saved.json()) as { id: string }).id;
    await expect(
        record.getByRole("button", {
            name: strings.subjects.editNamed("Family Outback"),
            exact: true,
        }),
    ).toBeVisible();
    const added = await visitEvidence([client.id]);
    expect(added.subjects).toEqual([
        {
            id: vehicle,
            client_id: client.id,
            name: "Family Outback",
            attributes: {
                make: "Subaru",
                model: "Outback",
                year: 2019,
                colour: "Forest green",
                plate: "RX4 21K",
                size: "suv",
                address: "1285 West Pender Street, Vancouver",
            },
        },
    ]);
    const boat = await page.request.post(`${bookingApi()}/v1/subjects`, {
        headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
        data: { client_id: client.id, name: "Lake boat", attributes: { size: "boat" } },
    });
    expect(boat.status(), await boat.text()).toBe(422);
    expect((await visitEvidence([client.id])).subjects).toEqual(added.subjects);

    const team = await page.request.get(`${bookingApi()}/v1/staff/team`);
    expect(team.status()).toBe(200);
    const owner = ((await team.json()) as { members: { id: string; name: string }[] }).members[0];
    if (owner === undefined) throw new Error("The new business has no owner on its team");
    const service = await apiCall<{ id: string; name: string }>(
        page,
        "POST",
        "/v1/items",
        {
            kind: "service",
            name: "Interior detail",
            duration_min: 30,
            price_cents: 14900,
            deposit_type: "none",
            online_bookable: false,
        },
        201,
    );
    const fixture = {
        clientId: client.id,
        clientName: client.name,
        clientPhone: client.phone,
        itemId: service.id,
        itemName: service.name,
        staffId: owner.id,
        staffName: owner.name,
        zone: "America/Vancouver",
    };
    await fillBookingComposer(page, fixture);
    await chooseFreeBookingTime(page, fixture);
    const creating = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === "/v1/bookings" &&
            response.request().method() === "POST",
    );
    await page.getByRole("button", { name: strings.bookings.composerBook, exact: true }).click();
    const created = await creating;
    expect(created.status(), await created.text()).toBe(201);
    expect(created.request().postDataJSON()).toMatchObject({
        client_id: client.id,
        subject_id: vehicle,
        item_id: service.id,
    });
    const booking = (await created.json()) as BookingRecord;
    const booked = await visitEvidence([client.id]);
    expect(booked.bookings).toEqual([
        expect.objectContaining({
            id: booking.id,
            subject_id: vehicle,
            item_id: service.id,
            staff_id: owner.id,
            status: "confirmed",
            source: "manual",
        }),
    ]);
    expect(booked.subjects).toEqual(added.subjects);
    await openBooking(page, fixture, booking.id, formatParts(["Family Outback", client.name]));
    await expect(
        page.getByText("Family Outback", { exact: false }).filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
        page
            .getByText("1285 West Pender Street, Vancouver", { exact: false })
            .filter({ visible: true })
            .first(),
    ).toBeVisible();
    await testInfo.attach("vehicle-visit", {
        body: JSON.stringify(booked),
        contentType: "application/json",
    });
});

test("CRM-E2E-15 a phone another client holds is refused, and the form offers to open that client", async ({
    page,
}) => {
    const e = strings.clients.edit;
    await signIn(page);
    const holder = await createClient(page);
    const refused = await page.request.post(`${bookingApi()}/v1/clients`, {
        headers: { Origin: new URL(page.url()).origin },
        data: { name: demoPerson(randomUUID()), phone: holder.phone },
    });
    expect(refused.status(), await refused.text()).toBe(409);
    expect(await refused.json()).toMatchObject({
        error: "phone_taken",
        detail: { client_id: holder.id },
    });
    await openClient(page, holder);
    await navigate(page, "/clients");
    await page.getByRole("button", { name: strings.clients.add, exact: true }).click();
    const add = page.getByRole("dialog", { name: e.addTitle, exact: true });
    await add.getByRole("textbox", { name: e.nameLabel }).fill(demoPerson(randomUUID()));
    await add.getByRole("textbox", { name: e.phoneLabel }).fill(holder.phone);
    await expect(add.getByText(e.phoneTakenTitle(holder.name), { exact: true })).toBeVisible();
    await expect(add.getByText(e.phoneTakenBody, { exact: true })).toBeVisible();
    await expect(add.getByRole("button", { name: e.duplicateKeep, exact: true })).toHaveCount(0);
    let posted = 0;
    page.on("request", (request) => {
        if (request.method() === "POST" && new URL(request.url()).pathname === "/v1/clients")
            posted += 1;
    });
    await add.getByRole("button", { name: e.add, exact: true }).click();
    await expect(add.getByText(e.phoneTakenTitle(holder.name), { exact: true })).toBeVisible();
    expect(posted).toBe(0);
    await add.getByRole("button", { name: e.duplicateOpen, exact: true }).click();
    await expect(
        page
            .getByRole("complementary", { name: holder.name, exact: true })
            .getByRole("heading", { name: holder.name, exact: true }),
    ).toBeVisible();
});

async function paletteRow(page: Page, query: string, name: string) {
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog");
    await expect(palette.getByText(strings.search.jumpTo)).toBeVisible();
    await page.keyboard.type(query);
    return palette.getByRole("button").filter({ hasText: name });
}

async function closePalette(page: Page): Promise<void> {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("CRM-E2E-09 directory and palette find a client the same ways, and only managers see lifetime value", async ({
    page,
    browser,
}) => {
    test.setTimeout(240_000);
    const r = strings.clients.record;
    await signIn(page);
    const line = freshPhone();
    const digits = line.slice(2);
    const formatted = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    const run = randomUUID().slice(0, 6);
    const client = await createClient(page, `Émile Côté ${run}`, line);
    await addPet(page, client, `Archibald${run}`);
    const queries = [
        client.name,
        client.name.toUpperCase(),
        `emile cote ${run}`,
        digits,
        line,
        `1${digits}`,
        `+1 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`,
        formatted,
        digits.slice(-7),
        `archibald${run}`,
    ];
    await test.step("directory", async () => {
        await navigate(page, "/clients");
        const search = page.getByRole("searchbox");
        for (const query of queries) {
            await search.fill(query);
            await expect(
                page.getByRole("button").filter({ hasText: client.name }),
                query,
            ).toHaveCount(1);
        }
        await search.fill(`no client ${run}`);
        await expect(page.getByRole("button").filter({ hasText: client.name })).toHaveCount(0);
    });
    await test.step("palette", async () => {
        await navigate(page, "/today");
        for (const query of queries) {
            await expect(await paletteRow(page, query, client.name), query).not.toHaveCount(0);
            await closePalette(page);
        }
        await expect(await paletteRow(page, `archibald${run}`, `Archibald${run}`)).toHaveCount(1);
        await expect(
            page.getByRole("dialog").getByText(strings.search.addClientNamed(`archibald${run}`)),
        ).toHaveCount(0);
        await closePalette(page);
    });
    await test.step("booking picker", async () => {
        await navigate(page, "/schedule?new=1");
        const form = page.getByRole("form", { name: strings.bookings.composerTitle });
        for (const query of [`emile cote ${run}`, formatted, `1${digits}`, `archibald${run}`]) {
            await form.getByRole("searchbox").fill(query);
            await expect(
                form.getByRole("button").filter({ hasText: client.name }),
                query,
            ).toHaveCount(1);
        }
    });
    await test.step("the owner sees lifetime value and every visit", async () => {
        const record = await openClient(page, client);
        await expect(record.getByText(r.lifetime, { exact: true })).toBeVisible();
        await expect(record.getByText(r.visits, { exact: true })).toBeVisible();
    });
    for (const [who, email, manager] of [
        ["admin", "admin@birchbark.example", true],
        ["staff", "diego@birchbark.example", false],
    ] as const) {
        await test.step(`${who} sees the record`, async () => {
            const context = await browser.newContext({
                baseURL: new URL(page.url()).origin,
                viewport: { width: 1440, height: 900 },
            });
            try {
                const other = await context.newPage();
                await signIn(other, { email: runEmail(email), password: "demo1234" });
                const record = await openClient(other, client);
                await expect(record.getByText(r.lifetime, { exact: true })).toHaveCount(
                    manager ? 1 : 0,
                );
                await expect(record.getByText(r.balance, { exact: true })).toHaveCount(
                    manager ? 1 : 0,
                );
                await expect(
                    record.getByText(manager ? r.visits : r.yourVisits, { exact: true }),
                ).toBeVisible();
                await expect(
                    record.getByText(manager ? r.upcoming : r.yourUpcoming, { exact: true }),
                ).toBeVisible();
            } finally {
                await context.close();
            }
        });
    }
});

test("CRM-E2E-16 an archived client leaves search and pickers, can't take new work and keeps their invoices", async ({
    page,
}) => {
    test.setTimeout(240_000);
    const r = strings.clients.record;
    await signIn(page);
    const client = await createClient(page);
    const invoice = await page.request.post(`${bookingApi()}/v1/invoices`, {
        headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
        data: {
            client_id: client.id,
            lines: [{ description: "Full groom", quantity: 1, unit_amount_cents: 5000 }],
        },
    });
    expect(invoice.status(), await invoice.text()).toBe(201);
    const invoiceId = ((await invoice.json()) as { id: string }).id;
    const digits = client.phone.slice(2);
    const phoneLabel = formatPhone(client.phone);
    const picker = async (shown: 0 | 1): Promise<void> => {
        await navigate(page, "/schedule?new=1");
        const form = page.getByRole("form", { name: strings.bookings.composerTitle });
        for (const query of [client.name, digits]) {
            await form.getByRole("searchbox").fill(query);
            await expect(form.getByRole("button").filter({ hasText: client.name })).toHaveCount(
                shown,
            );
        }
        await navigate(page, "/today");
    };
    await picker(1);
    const archived = await page.request.post(`${bookingApi()}/v1/clients/${client.id}/archive`, {
        headers: { Origin: new URL(page.url()).origin },
    });
    expect(archived.status(), await archived.text()).toBe(200);
    await test.step("gone from the palette and the picker", async () => {
        await expectClientSegment(page, client, true);
        await navigate(page, "/today");
        for (const query of [client.name, digits]) {
            await expect
                .poll(async () => {
                    const count = await (await paletteRow(page, query, phoneLabel)).count();
                    await closePalette(page);
                    return count;
                })
                .toBe(0);
        }
        await picker(0);
    });
    await test.step("the record offers Restore instead of new work", async () => {
        const record = await openClient(page, client);
        await expect(record.getByText(r.archived, { exact: true })).toBeVisible();
        for (const name of [r.book, r.message, r.invoice])
            await expect(record.getByRole("button", { name, exact: true })).toHaveCount(0);
        await expect(
            record.getByRole("button", { name: strings.clients.edit.restore, exact: true }),
        ).toBeVisible();
    });
    await test.step("the wallet and the full page offer no new work either", async () => {
        const record = await openClient(page, client);
        await record.getByRole("button", { name: r.manageWallet, exact: true }).click();
        await expect(
            page.getByText(strings.clients.wallet.archived, { exact: true }),
        ).toBeVisible();
        for (const name of [
            strings.clients.sellPackageLink,
            strings.clients.startSubscriptionLink,
            strings.clients.addCard,
            strings.clients.addBankWeb,
        ])
            await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
        await navigate(page, `/clients/${client.id}/history`);
        await expect(
            page.getByRole("button", { name: strings.clients.edit.restore, exact: true }),
        ).toBeVisible();
        for (const name of [r.book, r.message])
            await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
        await navigate(page, "/today");
    });
    await test.step("the server refuses new work and keeps the invoice", async () => {
        const headers = { Origin: new URL(page.url()).origin };
        const refused = await page.request.post(`${bookingApi()}/v1/invoices`, {
            headers,
            data: { client_id: client.id, lines: [] },
        });
        expect(refused.status(), await refused.text()).toBe(409);
        expect(await refused.json()).toMatchObject({ error: "client_archived" });
        await navigate(page, `/payments/invoices?open=${invoiceId}`);
        await expect(
            page.getByText(client.name, { exact: false }).filter({ visible: true }).first(),
        ).toBeVisible();
        await navigate(page, "/today");
    });
    await test.step("restore from the record brings them back everywhere", async () => {
        const record = await openClient(page, client);
        const restoring = clientCommand(page, `/${client.id}/restore`, "POST");
        await record
            .getByRole("button", { name: strings.clients.edit.restore, exact: true })
            .click();
        expect((await restoring).status()).toBe(200);
        await expect(record.getByRole("button", { name: r.book, exact: true })).toBeVisible();
        await expect(record.getByText(r.archived, { exact: true })).toHaveCount(0);
        await expectClientSegment(page, client, false);
        await navigate(page, "/today");
        await expect(await paletteRow(page, digits, phoneLabel)).toHaveCount(1);
        await closePalette(page);
        await picker(1);
    });
});

test("CRM-E2E-17 archive two clients in bulk, then restore one, and each ends in the state chosen", async ({
    page,
    browser,
}) => {
    test.setTimeout(180_000);
    const t = strings.clients.tidy;
    await signIn(page);
    const shared = freshPhone().slice(0, -1);
    const first = await createClient(page, demoPerson(randomUUID()), `${shared}1`);
    const second = await createClient(page, demoPerson(randomUUID()), `${shared}2`);
    const observer = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        viewport: { width: 1440, height: 900 },
    });
    try {
        const other = await observer.newPage();
        await signIn(other);
        await navigate(page, "/clients");
        await page.getByRole("searchbox").fill(shared.slice(2));
        await page.getByRole("button", { name: t.select, exact: true }).click();
        await page.getByRole("checkbox", { name: first.name, exact: true }).check();
        await page.getByRole("checkbox", { name: second.name, exact: true }).check();
        await page.getByRole("button", { name: t.archive, exact: true }).click();
        const confirmation = page.getByRole("dialog", { name: t.archiveTitle(2), exact: true });
        await confirmation
            .getByRole("button", { name: strings.common.cancel, exact: true })
            .click();
        await expect(confirmation).toHaveCount(0);
        await page.getByRole("button", { name: t.archive, exact: true }).click();
        const archiving = clientCommand(page, "/archive", "POST");
        await confirmation.getByRole("button", { name: t.archiveConfirm, exact: true }).click();
        const archived = await archiving;
        expect(archived.status(), await archived.text()).toBe(200);
        expect(await archived.json()).toEqual({ count: 2 });
        await expect(page.getByText(t.archived(2), { exact: true })).toBeVisible();
        await test.step("the archived tab offers no second archive", async () => {
            const tab = strings.clients.edit
                .segmentArchived(0)
                .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
                .replace("0", "[\\d,]+");
            await page.getByRole("button", { name: new RegExp(`^${tab}$`) }).click();
            await page.getByRole("checkbox", { name: first.name, exact: true }).check();
            await expect(page.getByRole("button", { name: t.tag, exact: true })).toBeVisible();
            await expect(page.getByRole("button", { name: t.archive, exact: true })).toHaveCount(0);
            await page.getByRole("button", { name: strings.common.done, exact: true }).click();
        });
        await expectClientSegment(other, first, true);
        await expectClientSegment(other, second, true);
        const record = await openClient(other, first);
        const restoring = clientCommand(other, `/${first.id}/restore`, "POST");
        await record
            .getByRole("button", { name: strings.clients.edit.restore, exact: true })
            .click();
        expect((await restoring).status()).toBe(200);
        await expectClientSegment(page, first, false);
        await expectClientSegment(page, second, true);
        await page.reload();
        await expectClientSegment(page, first, false);
        await expectClientSegment(page, second, true);
    } finally {
        await observer.close();
    }
});
