import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { on } from "./support/hosts";
import { ownAddress } from "./support/network";
import { randomUUID } from "node:crypto";
import { contractEvidence, documentApi, issueContract } from "./support/documents";

test.beforeEach(async ({ context }, info) => {
    await ownAddress(context, info);
});

test("DOC-E2E-02 typed contract validates consent, persists its snapshot and rejects later reversal", async ({
    page,
    request,
}) => {
    const c = strings.publicContract;
    const issued = await issueContract(request);
    await page.goto(on("book", `/contract/${issued.token}`));
    const name = page.getByRole("textbox", { name: c.nameLabel });
    await name.fill("   ");
    await page.getByRole("button", { name: c.sign, exact: true }).click();
    await expect(page.getByText(c.errors["name-missing"], { exact: true })).toBeVisible();
    await name.fill(issued.name);
    await page.getByRole("button", { name: c.sign, exact: true }).click();
    await expect(page.getByText(c.errors["consent-missing"], { exact: true })).toBeVisible();
    expect(await contractEvidence(issued.id)).toMatchObject({
        status: "pending",
        signed_at: null,
        signed_body: null,
    });
    await page.getByRole("switch").check();
    await page.getByRole("button", { name: c.sign, exact: true }).click();
    await expect(page.getByRole("heading", { name: c.signedTitle, exact: true })).toBeVisible();
    const saved = await contractEvidence(issued.id);
    expect(saved).toMatchObject({
        status: "signed",
        signed_body: issued.body,
        contract_version: 1,
        signer_name: issued.name,
        method: "typed",
        strokes: null,
    });
    expect(saved.signed_at).not.toBeNull();
    const published = await request.post(
        `${documentApi}/v1/contracts/${issued.contractId}/versions`,
        {
            headers: { ...issued.headers, "Idempotency-Key": randomUUID() },
            data: { body: "Replacement terms must not rewrite this signature." },
        },
    );
    expect(published.status()).toBe(200);
    await page.reload();
    await expect(page.getByRole("heading", { name: c.signedTitle, exact: true })).toBeVisible();
    await expect(
        page.getByText(issued.body.split("\n").slice(1).join("\n"), { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: c.decline, exact: true })).toHaveCount(0);
    const decline = await request.post(`${documentApi}/contract/${issued.token}/decline`);
    expect(decline.status()).toBe(409);
    const replay = await request.post(`${documentApi}/contract/${issued.token}/sign`, {
        data: { version: 1, typed_name: "Another signer", strokes: null, agreed: true },
    });
    expect(replay.status()).toBe(409);
    expect(await contractEvidence(issued.id)).toEqual(saved);
});

test("DOC-E2E-03 customer declines and a stale second tab cannot sign the declined request", async ({
    page,
    context,
    request,
}) => {
    const c = strings.publicContract;
    const issued = await issueContract(request);
    const stale = await context.newPage();
    await page.goto(on("book", `/contract/${issued.token}`));
    await stale.goto(page.url());
    await stale.getByRole("textbox", { name: c.nameLabel }).fill(issued.name);
    await stale.getByRole("switch").check();
    await page.getByRole("button", { name: c.decline, exact: true }).click();
    await expect(page.getByRole("heading", { name: c.declinedTitle })).toBeVisible();
    await stale.getByRole("button", { name: c.sign, exact: true }).click();
    await expect(stale.getByRole("heading", { name: c.declinedTitle })).toBeVisible();
    const saved = await contractEvidence(issued.id);
    expect(saved).toMatchObject({
        status: "declined",
        signed_at: null,
        signed_body: null,
        method: null,
        signer_name: null,
    });
    await page.reload();
    await expect(page.getByRole("heading", { name: c.declinedTitle })).toBeVisible();
    const replay = await request.post(`${documentApi}/contract/${issued.token}/decline`);
    expect(replay.status()).toBe(409);
    expect(await contractEvidence(issued.id)).toEqual(saved);
    await stale.close();
});

test("DOC-E2E-04 changed terms require review and renewed consent before signing", async ({
    page,
    request,
}) => {
    const c = strings.publicContract;
    const issued = await issueContract(request);
    await page.goto(on("book", `/contract/${issued.token}`));
    await page.getByRole("switch").check();
    const body =
        "Updated grooming care agreement\nPlease collect your pet within thirty minutes of our pickup message.";
    const published = await request.post(
        `${documentApi}/v1/contracts/${issued.contractId}/versions`,
        {
            headers: { ...issued.headers, "Idempotency-Key": randomUUID() },
            data: { body },
        },
    );
    expect(published.status()).toBe(200);
    const conflict = page.waitForResponse(
        (response) =>
            response.url().endsWith(`/contract/${issued.token}/sign`) && response.status() === 409,
    );
    await page.getByRole("button", { name: c.sign, exact: true }).click();
    await conflict;
    await expect(
        page.getByText(body.split("\n").slice(1).join("\n"), { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("switch")).not.toBeChecked();
    expect(await contractEvidence(issued.id)).toMatchObject({ status: "pending", signed_at: null });
    await page.getByRole("switch").check();
    await page.getByRole("button", { name: c.sign, exact: true }).click();
    await expect(page.getByRole("heading", { name: c.signedTitle, exact: true })).toBeVisible();
    expect(await contractEvidence(issued.id)).toMatchObject({
        status: "signed",
        signed_body: body,
        contract_version: 2,
        signer_name: issued.name,
    });
});

test("DOC-E2E-05 drawing can be cleared and only the replacement stroke is signed", async ({
    page,
    request,
}) => {
    const c = strings.publicContract;
    const issued = await issueContract(request);
    await page.goto(on("book", `/contract/${issued.token}`));
    await page.getByRole("button", { name: c.drawTab, exact: true }).click();
    await page.getByRole("switch").check();
    await page.getByRole("button", { name: c.sign, exact: true }).click();
    await expect(page.getByText(c.errors["drawing-missing"], { exact: true })).toBeVisible();
    const pad = page.getByRole("img", { name: c.drawLabel });
    await pad.scrollIntoViewIfNeeded();
    const bounds = await pad.boundingBox();
    if (!bounds) throw new Error("signature drawing surface is missing");
    for (const y of [0.3, 0.7]) {
        await page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * y);
        await page.mouse.down();
        await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * y, {
            steps: 8,
        });
        await page.mouse.up();
        await expect(pad.locator("path")).toHaveCount(1);
        if (y === 0.3) {
            await page.getByRole("button", { name: c.clear, exact: true }).click();
            await expect(pad.locator("path")).toHaveCount(0);
        }
    }
    await page.getByRole("button", { name: c.sign, exact: true }).click();
    await expect(page.getByRole("heading", { name: c.signedTitle, exact: true })).toBeVisible();
    const saved = await contractEvidence(issued.id);
    expect(saved).toMatchObject({
        status: "signed",
        signed_body: issued.body,
        signer_name: issued.name,
        method: "drawn",
    });
    expect(saved.strokes).toHaveLength(1);
    const stroke = saved.strokes?.[0];
    if (!stroke) throw new Error("committed signature stroke is missing");
    expect(stroke.length).toBeGreaterThan(1);
    for (const point of stroke) {
        expect(point[0]).toBeGreaterThanOrEqual(0);
        expect(point[0]).toBeLessThanOrEqual(1);
        expect(point[1]).toBeCloseTo(0.7, 1);
    }
    await page.reload();
    await expect(page.getByRole("heading", { name: c.signedTitle, exact: true })).toBeVisible();
    expect(await contractEvidence(issued.id)).toEqual(saved);
});
