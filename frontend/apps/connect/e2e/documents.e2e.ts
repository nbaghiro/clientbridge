import { randomUUID } from "node:crypto";
import { formatMoney, strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";

import {
    contractEvidence,
    documentApi,
    estimateEvidence,
    formEvidence,
    issueContract,
    issueEstimate,
    issueForm,
} from "./documents";
import { on } from "./hosts";
import { ownAddress } from "./network";

test.beforeEach(async ({ context }, info) => {
    await ownAddress(context, info);
});

test("DOC-E2E-01 customer submits the issued form once with consent and exact answers", async ({
    page,
    request,
}) => {
    const f = strings.publicForm;
    const issued = await issueForm(request);
    await page.goto(on("book", `/form/${issued.token}`));
    await expect(page.getByRole("heading", { name: issued.definition.name })).toBeVisible();
    await page.getByRole("button", { name: f.sendAnswers }).click();
    await expect(page.getByText(f.signatureRequired, { exact: true })).toBeVisible();
    expect(await formEvidence(issued.id)).toMatchObject({
        status: "draft",
        answers: {},
        signature: null,
        submitted_at: null,
    });
    await page.getByRole("textbox", { name: f.signerName }).fill(issued.name);
    await page.getByRole("switch").check();
    await page.getByRole("button", { name: f.sendAnswers }).click();
    await expect(
        page.getByText(f.answerRequired("Care instructions"), { exact: true }),
    ).toBeVisible();
    const edited = await request.patch(`${documentApi}/v1/forms/${issued.formId}`, {
        headers: issued.headers,
        data: {
            name: `Updated pet care intake — ${issued.name}`,
            require_signature: false,
            fields: [{ input: "text", label: "Different question", required: true }],
        },
    });
    expect(edited.status()).toBe(200);
    await page
        .getByRole("textbox", { name: /Care instructions/ })
        .fill("Quiet room, no fragrance.");
    await page.getByRole("button", { name: f.sendAnswers }).click();
    await expect(page.getByRole("heading", { name: f.doneTitle })).toBeVisible();
    const saved = await formEvidence(issued.id);
    expect(saved).toMatchObject({
        status: "submitted",
        answers: { [issued.field]: "Quiet room, no fragrance." },
        signature: { name: issued.name },
        definition: { name: issued.definition.name, require_signature: true },
    });
    expect(saved.submitted_at).not.toBeNull();
    expect(saved.signature?.ip).toBeTruthy();
    await page.reload();
    await expect(page.getByRole("heading", { name: f.doneTitle })).toBeVisible();
    await expect(page.getByRole("button", { name: f.sendAnswers })).toHaveCount(0);
    const replay = await request.post(`${documentApi}/form/${issued.token}`, {
        data: {
            answers: { [issued.field]: "Must not replace the saved answer" },
            signature: { name: "Different signer", agreed: true },
        },
    });
    expect(replay.status()).toBe(409);
    expect(await formEvidence(issued.id)).toEqual(saved);
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

test("DOC-E2E-06 a ticked add-on is shown and accepted at the same discounted total", async ({
    page,
    request,
}) => {
    const pe = strings.publicEstimate;
    const money = (cents: number) => formatMoney(cents, "CAD");
    const issued = await issueEstimate(request);
    await page.goto(on("pay", `/e/${issued.token}`));
    // $100 less 10% plus 5% GST
    const accept = page.getByRole("button", { name: pe.acceptFor(money(9450)), exact: true });
    await expect(accept).toBeVisible();
    const quoted = page.waitForResponse(
        (response) =>
            response.url().includes(`/estimate/${issued.token}?`) && response.status() === 200,
    );
    await page.getByRole("checkbox", { name: "De-shedding treatment" }).check();
    await quoted;
    // $200 less 10% is $180, plus $9 GST
    const both = page.getByRole("button", { name: pe.acceptFor(money(18900)), exact: true });
    await expect(both).toBeVisible();
    await expect(page.getByText(money(18000), { exact: true })).toBeVisible();
    expect(await estimateEvidence(issued.id)).toMatchObject({ status: "sent", total_cents: 9450 });
    await both.click();
    await expect(page.getByRole("heading", { name: pe.acceptedTitle })).toBeVisible();
    const saved = await estimateEvidence(issued.id);
    expect(saved).toMatchObject({
        status: "accepted",
        subtotal_cents: 18000,
        tax_total_cents: 900,
        total_cents: 18900,
    });
    expect(saved.lines).toEqual([
        expect.objectContaining({ optional: false, amount_cents: 9000, sale_discount_cents: 1000 }),
        expect.objectContaining({
            optional: true,
            selected: true,
            amount_cents: 9000,
            sale_discount_cents: 1000,
        }),
    ]);
    await page.reload();
    await expect(page.getByRole("heading", { name: pe.acceptedTitle })).toBeVisible();
    await expect(page.getByText(money(18900), { exact: true }).first()).toBeVisible();
    const replay = await request.post(`${documentApi}/estimate/${issued.token}/accept`, {
        data: { line_ids: [], total_cents: 9450 },
    });
    expect(replay.status()).toBe(409);
    expect(await estimateEvidence(issued.id)).toEqual(saved);
});
