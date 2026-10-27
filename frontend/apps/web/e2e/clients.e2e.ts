import { randomUUID } from "node:crypto";
import { demoPerson } from "@clientbridge/config/e2e/demo";
import { strings, formatParts } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
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
import { navigate, signIn } from "./support/session";
import { runEmail } from "@clientbridge/config/e2e/run";
import { newAccount } from "./support/auth";
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
    const original = { name: demoPerson(run), email: runEmail(`crm-${run}@example.ca`) };
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
            .getByRole("textbox", { name: strings.clients.edit.emailLabel, exact: true })
            .fill(original.email);
        await add
            .getByRole("group", { name: strings.clients.edit.channelLabel })
            .getByRole("button", { name: strings.clients.edit.channelEmail, exact: true })
            .click();
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
            email: runEmail(`edited-${run}@example.ca`),
        };
        await test.step("edit contact fields through the UI and verify reload", async () => {
            const editor = await editClient(page, client);
            await editor
                .getByRole("textbox", { name: strings.clients.edit.nameLabel })
                .fill(updated.name);
            await editor
                .getByRole("textbox", { name: strings.clients.edit.emailLabel, exact: true })
                .fill(updated.email);
            const saving = clientCommand(page, `/${client.id}`, "PATCH");
            await editor
                .getByRole("button", { name: strings.clients.edit.save, exact: true })
                .click();
            const saved = await saving;
            expect(saved.status(), await saved.text()).toBe(200);
            expect(await saved.json()).toMatchObject({
                id: client.id,
                name: updated.name,
                email: updated.email,
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
    const target = await createClient(page, demoPerson(run), run);
    const otherName = demoPerson(`${run}:source`);
    const sourceName =
        otherName === target.name
            ? target.name === "Morgan Ellis"
                ? "Avery Patel"
                : "Morgan Ellis"
            : otherName;
    const source = await createClient(page, sourceName, run);
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
        await page.getByRole("searchbox").fill(run);
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
            email: target.email,
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
        await other.getByRole("searchbox").fill(source.email);
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
        clientEmail: client.email,
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
