import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { on } from "./support/hosts";
import { links } from "./support/links";
import { ownAddress } from "./support/network";
import { documentApi, formEvidence, formFiles, issueForm } from "./support/documents";
import { watchErrors } from "./support/errors";

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

const PDF = Buffer.from(
    "%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n",
);
const RECORD = [
    { input: "text", label: "Pet's name", required: true },
    { input: "file", label: "Vaccine record", required: true },
];

test("DOC-E2E-08 a client on a phone attaches a real PDF; a file over 10 MB or of another type is refused before it uploads, and a failed upload retries the same file", async ({
    browser,
    request,
}, info) => {
    const f = strings.publicForm;
    const issued = await issueForm(request, RECORD, false);
    const fileField = issued.fields.find((field) => field.input === "file");
    if (fileField === undefined) throw new Error("issued form has no file question");
    const phone = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
    });
    await ownAddress(phone, info);
    const page = await phone.newPage();
    const errors = watchErrors(page);
    const puts: string[] = [];
    let dropUploads = false;
    await page.route("**/*", (route) => {
        if (route.request().method() !== "PUT") return route.continue();
        puts.push(route.request().url());
        return dropUploads ? route.abort("internetdisconnected") : route.continue();
    });
    await page.goto(on("book", `/form/${issued.token}`));
    const record = page.getByLabel("Vaccine record", { exact: true });
    const chosen = page.locator("label").filter({ has: record });

    await record.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: PDF });
    await expect(page.getByText(f.uploadWrongType, { exact: true })).toBeVisible();
    const tenMegabytes = 10 * 1024 * 1024;
    await record.setInputFiles({
        name: "scan.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.alloc(tenMegabytes + 1),
    });
    await expect(page.getByText(f.uploadTooBig, { exact: true })).toBeVisible();
    expect(puts).toEqual([]);
    expect(await formFiles(issued.id)).toEqual([]);
    // the server holds the same line for a page that skips its own check
    const upload = `${documentApi}/form/${issued.token}/upload`;
    const big = await request.post(upload, {
        data: { content_type: "application/pdf", size: tenMegabytes + 1 },
    });
    expect([big.status(), ((await big.json()) as { error: string }).error]).toEqual([
        422,
        "file_too_large",
    ]);
    const text = await request.post(upload, { data: { content_type: "text/plain", size: 10 } });
    expect(text.status()).toBe(422);

    dropUploads = true;
    await record.setInputFiles({ name: "vaccines.pdf", mimeType: "application/pdf", buffer: PDF });
    await expect(page.getByText(f.fileUploadOffline, { exact: true })).toBeVisible();
    await expect(chosen).toContainText(f.chooseFile);
    // cleared, so the browser fires a change when the same file is picked again
    expect(await record.inputValue()).toBe("");
    dropUploads = false;
    const completed = page.waitForResponse((response) =>
        /\/upload\/[^/]+\/complete$/.test(new URL(response.url()).pathname),
    );
    await record.setInputFiles({ name: "vaccines.pdf", mimeType: "application/pdf", buffer: PDF });
    expect((await completed).status()).toBe(200);
    await expect(chosen).toContainText("vaccines.pdf");
    await expect(page.getByText(f.fileUploadOffline, { exact: true })).toHaveCount(0);

    await page.getByRole("textbox", { name: /Pet's name/ }).fill("Pepper");
    await page.getByRole("button", { name: f.sendAnswers }).click();
    await expect(page.getByRole("heading", { name: f.doneTitle })).toBeVisible();
    const files = await formFiles(issued.id);
    const attached = files.filter((file) => file.uploaded);
    expect(attached).toEqual([
        {
            id: expect.any(String),
            content_type: "application/pdf",
            size: PDF.length,
            uploaded: true,
        },
    ]);
    expect(await formEvidence(issued.id)).toMatchObject({
        status: "submitted",
        answers: { [issued.field]: "Pepper", [fileField.name]: attached[0]?.id },
    });
    // only the upload this case cut off may fail to load
    expect(errors.filter((e) => !e.includes("net::ERR_INTERNET_DISCONNECTED"))).toEqual([]);
    await phone.close();
});

test("DOC-E2E-10 a form sent from another tab shows as done in the first, which keeps the answers that went first", async ({
    browser,
    request,
}, info) => {
    const f = strings.publicForm;
    const issued = await issueForm(
        request,
        [{ input: "text", label: "Pet's name", required: true }],
        false,
    );
    const context = await browser.newContext();
    await ownAddress(context, info);
    const first = await context.newPage();
    const second = await context.newPage();
    for (const tab of [first, second]) await tab.goto(on("book", `/form/${issued.token}`));
    await second.getByRole("textbox", { name: /Pet's name/ }).fill("Pepper");
    await second.getByRole("button", { name: f.sendAnswers }).click();
    await expect(second.getByRole("heading", { name: f.doneTitle })).toBeVisible();
    const saved = await formEvidence(issued.id);
    expect(saved).toMatchObject({ status: "submitted", answers: { [issued.field]: "Pepper" } });

    await first.getByRole("textbox", { name: /Pet's name/ }).fill("Biscuit");
    const refused = first.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === `/form/${issued.token}` &&
            response.request().method() === "POST",
    );
    await first.getByRole("button", { name: f.sendAnswers }).click();
    const conflict = await refused;
    expect([conflict.status(), ((await conflict.json()) as { error: string }).error]).toEqual([
        409,
        "form_submitted",
    ]);
    await expect(first.getByRole("heading", { name: f.doneTitle })).toBeVisible();
    await expect(first.getByText(f.submitAnswersError, { exact: true })).toHaveCount(0);
    expect(await formEvidence(issued.id)).toEqual(saved);
    await context.close();
});
