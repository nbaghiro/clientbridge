import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { on } from "./hosts";
import { links } from "./links";
import { ownAddress } from "./network";
import { documentApi, formEvidence, issueForm } from "./documents";
import { watchErrors } from "./errors";

test.beforeEach(async ({ context }, info) => {
    await ownAddress(context, info);
});

test("a client starts a form and a contract", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(`/form/${links.form}`);
    await expect(page.getByRole("progressbar")).toBeVisible();
    await page.getByRole("textbox").first().fill("Pepper");
    await expect(page.getByRole("button", { name: strings.publicForm.sendAnswers })).toBeVisible();

    const contract = strings.publicContract;
    await page.goto(`/contract/${links.contract}`);
    await page.getByRole("button", { name: contract.drawTab }).click();
    await expect(page.getByRole("button", { name: contract.drawTab })).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    await expect(page.getByRole("button", { name: contract.sign })).toBeVisible();
    expect(errors).toEqual([]);
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
