import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";

import { createClient, editClient } from "./support/crm";
import { expectPhoto, filesApi, photoEvidence, portrait } from "./support/files";
import { signIn } from "./support/session";

test.use({ actionTimeout: 15_000 });

test("FILES-E2E-01 client photo confirms real storage bytes and survives another replica", async ({
    page,
    browser,
}, testInfo) => {
    await signIn(page);
    const client = await createClient(page);
    const fixture = await portrait();
    const origin = new URL(page.url()).origin;
    const clear = `${filesApi()}/v1/files/photos/client/${client.id}`;
    try {
        let editor = await editClient(page, client);
        const rejected = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === "/v1/files" &&
                response.request().method() === "POST",
        );
        await editor.locator('input[type="file"]').setInputFiles({
            name: "Care notes.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("Brush gently after bathing."),
        });
        expect((await rejected).status()).toBe(422);
        await expect(
            editor.getByText(strings.common.fileUploadError, { exact: true }),
        ).toBeVisible();
        expect(await photoEvidence(client.id)).toEqual([]);

        const pending = await page.request.post(`${filesApi()}/v1/files`, {
            headers: { Origin: origin },
            data: {
                parent_type: "client",
                parent_id: client.id,
                purpose: "photo",
                content_type: "image/jpeg",
                size: fixture.buffer.length,
            },
        });
        expect(pending.status(), await pending.text()).toBe(201);
        const pendingBody = (await pending.json()) as { file: { id: string } };
        expect(await photoEvidence(client.id)).toEqual([
            expect.objectContaining({ id: pendingBody.file.id, uploaded_at: null, storage: null }),
        ]);
        const incomplete = await page.request.post(
            `${filesApi()}/v1/files/${pendingBody.file.id}/complete`,
            { headers: { Origin: origin }, data: {} },
        );
        expect(incomplete.status()).toBe(409);
        await page.reload();
        editor = await editClient(page, client);
        await expect(
            editor.getByRole("button", { name: strings.files.addPhoto, exact: true }),
        ).toBeVisible();
        await expect(editor.locator("img")).toHaveCount(0);

        const puts: { url: string; status: number }[] = [];
        page.on("response", (response) => {
            if (response.request().method() === "PUT")
                puts.push({ url: response.url(), status: response.status() });
        });
        const created = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === "/v1/files" &&
                response.request().method() === "POST",
        );
        const completed = page.waitForResponse(
            (response) =>
                /^\/v1\/files\/[^/]+\/complete$/.test(new URL(response.url()).pathname) &&
                response.request().method() === "POST",
        );
        await editor.locator('input[type="file"]').setInputFiles({
            name: fixture.name,
            mimeType: fixture.mimeType,
            buffer: fixture.buffer,
        });
        const minted = await created;
        expect(minted.status()).toBe(201);
        const upload = (await minted.json()) as { file: { id: string }; upload_url: string };
        const complete = await completed;
        expect(complete.status(), await complete.text()).toBe(200);
        expect(await complete.json()).toMatchObject({ id: upload.file.id, parent_id: client.id });
        expect(puts).toContainEqual({ url: upload.upload_url, status: 200 });
        const storedPhotoUrl = await expectPhoto(editor, page, fixture.sha256);
        const evidence = await photoEvidence(client.id);
        expect(evidence).toEqual([
            expect.objectContaining({
                id: upload.file.id,
                parent_id: client.id,
                content_type: "image/jpeg",
                size: fixture.buffer.length,
                uploaded_at: expect.any(String),
                storage: { size: fixture.buffer.length, sha256: fixture.sha256 },
            }),
        ]);
        await testInfo.attach("committed-photo-storage", {
            body: JSON.stringify(evidence),
            contentType: "application/json",
        });

        const observer = await browser.newContext({ baseURL: new URL(page.url()).origin });
        try {
            const other = await observer.newPage();
            await signIn(other);
            await expectPhoto(await editClient(other, client), other, fixture.sha256);
            await other.reload();
            await expectPhoto(await editClient(other, client), other, fixture.sha256);
            const removed = page.waitForResponse(
                (response) => response.url() === clear && response.request().method() === "DELETE",
            );
            await editor
                .getByRole("button", { name: strings.files.removePhoto, exact: true })
                .click();
            expect((await removed).status()).toBe(204);
            const deletedObject = await page.request.get(storedPhotoUrl);
            expect(deletedObject.status()).toBe(404);
            await expect(
                editor.getByRole("button", { name: strings.files.addPhoto, exact: true }),
            ).toBeVisible();
            expect(await photoEvidence(client.id)).toEqual([]);
            await expect(
                other
                    .getByRole("dialog")
                    .getByRole("button", { name: strings.files.addPhoto, exact: true }),
            ).toBeVisible();
            await other.reload();
            const cleared = await editClient(other, client);
            await expect(
                cleared.getByRole("button", { name: strings.files.addPhoto, exact: true }),
            ).toBeVisible();
            await expect(cleared.locator("img")).toHaveCount(0);
        } finally {
            await observer.close();
        }
    } finally {
        const response = await page.request.delete(clear, { headers: { Origin: origin } });
        expect(response.status(), await response.text()).toBe(204);
    }
});
