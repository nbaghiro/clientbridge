import { strings } from "@clientbridge/app-core/public";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { openClient } from "./support/crm";
import { formEvidence, sendToClient, signatureEvidence } from "./support/documents";
import { createDocumentClient, type DocumentClient } from "./support/invoices";
import { mailedLinks } from "./support/messaging";
import { customerContext, navigate, signIn } from "./support/session";
import { stackUrl } from "./support/visits";

test.use({ actionTimeout: 15_000 });

const c = strings.contracts;
const pc = strings.publicContract;
const f = strings.forms;
const pf = strings.publicForm;

const firstTerms =
    "Drop-off and pickup\nWe use gentle handling and fragrance-free products when asked.";
const secondTerms =
    "Drop-off and pickup\nPlease collect your pet within thirty minutes of our pickup message.";
const clause = (terms: string): string => terms.split("\n")[1] ?? terms;

async function openContract(page: Page, name: string): Promise<Locator> {
    await navigate(page, "/today");
    await navigate(page, "/inbox?segment=contracts");
    await page.getByRole("main").getByText(name, { exact: true }).click({ timeout: 60_000 });
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name, exact: true })).toBeVisible();
    return main;
}

async function expectSignedCopy(
    page: Page,
    main: Locator,
    client: DocumentClient,
    terms: string,
    other: string,
    version: number,
): Promise<void> {
    const row = main.getByRole("listitem").filter({ hasText: client.name });
    await row.getByRole("button", { name: c.signedCopy, exact: true }).click();
    const copy = page.getByRole("dialog");
    await expect(copy.getByText(clause(terms), { exact: true })).toBeVisible();
    await expect(copy.getByText(clause(other), { exact: true })).toHaveCount(0);
    await expect(copy.getByText(c.version(version), { exact: true }).first()).toBeVisible();
    await expect(copy.getByText(client.name, { exact: true }).first()).toBeVisible();
    await copy.getByRole("button", { name: c.close, exact: true }).click();
}

async function signTyped(page: Page, name: string): Promise<void> {
    await page.getByRole("textbox", { name: pc.nameLabel }).fill(name);
    await page.getByRole("switch").check();
}

test("FLOW-05-A a contract signed before the owner publishes new terms keeps its version, and one open during the change is signed on the new terms", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(240_000);
    await signIn(page);
    const early = await createDocumentClient(page);
    const late = await createDocumentClient(page);
    const name = `Grooming agreement for ${early.name} and ${late.name}`;

    await navigate(page, "/inbox?segment=contracts");
    await page.getByRole("button", { name: c.newContract, exact: true }).first().click();
    const drawer = page.getByRole("dialog").filter({ hasText: c.newTitle });
    await drawer.getByRole("textbox", { name: c.nameLabel, exact: true }).fill(name);
    await drawer.getByRole("textbox", { name: c.text, exact: true }).fill(firstTerms);
    const creating = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === "/v1/contracts" &&
            response.request().method() === "POST",
    );
    await drawer.getByRole("button", { name: c.create, exact: true }).click();
    const created = await creating;
    expect(created.status(), await created.text()).toBe(201);
    const contract = (await created.json()) as { id: string; version: number; body: string };
    expect(contract).toMatchObject({ version: 1, body: firstTerms });
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name, exact: true })).toBeVisible({ timeout: 60_000 });

    const first = await sendToClient(page, c.send, "/v1/contracts/send", early);
    const second = await sendToClient(page, c.send, "/v1/contracts/send", late);
    const [earlyLink] = await mailedLinks(page.request, early.email, "/contract/");
    const [lateLink] = await mailedLinks(page.request, late.email, "/contract/");
    expect(earlyLink?.pathname).toBe(`/contract/${first.token}`);
    expect(lateLink?.pathname).toBe(`/contract/${second.token}`);
    expect(earlyLink?.host).toBe(stackUrl("BOOK_BASE_URL").host);

    const earlyContext = await customerContext(browser);
    const lateContext = await customerContext(browser);
    try {
        const signer = await earlyContext.newPage();
        await signer.goto(earlyLink?.href ?? "");
        await expect(signer.getByText(clause(firstTerms), { exact: true })).toBeVisible();
        await signTyped(signer, early.name);
        await signer.getByRole("button", { name: pc.sign, exact: true }).click();
        await expect(
            signer.getByRole("heading", { name: pc.signedTitle, exact: true }),
        ).toBeVisible();
        const kept = await signatureEvidence(first.id);
        expect(kept).toMatchObject({
            status: "signed",
            signed_body: firstTerms,
            contract_version: 1,
            signer_name: early.name,
            method: "typed",
        });

        const reader = await lateContext.newPage();
        await reader.goto(lateLink?.href ?? "");
        await expect(reader.getByText(clause(firstTerms), { exact: true })).toBeVisible();
        await signTyped(reader, late.name);

        await main.getByRole("button", { name: c.editText, exact: true }).click();
        await main.getByRole("textbox", { name: c.text, exact: true }).fill(secondTerms);
        const publishing = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === `/v1/contracts/${contract.id}/versions` &&
                response.request().method() === "POST",
        );
        await main.getByRole("button", { name: c.publish(2), exact: true }).click();
        const published = await publishing;
        expect(published.status(), await published.text()).toBe(200);
        expect(await published.json()).toMatchObject({ version: 2, body: secondTerms });
        await expect(main.getByText(clause(secondTerms), { exact: true })).toBeVisible();

        const refused = reader.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === `/contract/${second.token}/sign` &&
                response.request().method() === "POST",
        );
        await reader.getByRole("button", { name: pc.sign, exact: true }).click();
        expect((await refused).status()).toBe(409);
        await expect(reader.getByText(clause(secondTerms), { exact: true })).toBeVisible();
        await expect(reader.getByText(clause(firstTerms), { exact: true })).toHaveCount(0);
        await expect(reader.getByRole("switch")).not.toBeChecked();
        expect(await signatureEvidence(second.id)).toMatchObject({
            status: expect.stringMatching(/^(pending|opened)$/),
            signed_body: null,
            signed_at: null,
        });
        await reader.getByRole("switch").check();
        await reader.getByRole("button", { name: pc.sign, exact: true }).click();
        await expect(
            reader.getByRole("heading", { name: pc.signedTitle, exact: true }),
        ).toBeVisible();
        const renewed = await signatureEvidence(second.id);
        expect(renewed).toMatchObject({
            status: "signed",
            signed_body: secondTerms,
            contract_version: 2,
            signer_name: late.name,
        });
        expect(await signatureEvidence(first.id)).toEqual(kept);

        await signer.reload();
        await expect(
            signer.getByRole("heading", { name: pc.signedTitle, exact: true }),
        ).toBeVisible();
        await expect(signer.getByText(clause(firstTerms), { exact: true })).toBeVisible();
        await expect(signer.getByText(clause(secondTerms), { exact: true })).toHaveCount(0);

        const observer = await browser.newContext({ baseURL: new URL(page.url()).origin });
        try {
            const other = await observer.newPage();
            await signIn(other);
            const library = await openContract(other, name);
            await expect(library.getByText(clause(secondTerms), { exact: true })).toBeVisible();
            await expect(
                library
                    .getByRole("listitem")
                    .filter({ hasText: early.name })
                    .getByText(c.versionShort(1), { exact: true }),
            ).toBeVisible();
            await expectSignedCopy(other, library, early, firstTerms, secondTerms, 1);
            await expectSignedCopy(other, library, late, secondTerms, firstTerms, 2);
            await other.reload();
            const reloaded = await openContract(other, name);
            await expectSignedCopy(other, reloaded, early, firstTerms, secondTerms, 1);
        } finally {
            await observer.close();
        }
        await testInfo.attach("contract-versions", {
            body: JSON.stringify({ kept, renewed }),
            contentType: "application/json",
        });
    } finally {
        await earlyContext.close();
        await lateContext.close();
    }
});

test("FLOW-05-B a form edited while the client has it open keeps the questions they answered, and the next send asks the new ones", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(240_000);
    await signIn(page);
    const client = await createDocumentClient(page);
    const name = `Pet care intake for ${client.name}`;

    await navigate(page, "/inbox?segment=forms");
    await page.getByRole("button", { name: f.newForm, exact: true }).first().click();
    const main = page.getByRole("main");
    await main.getByRole("textbox", { name: f.formName, exact: true }).fill(name);
    await main.getByRole("switch", { name: f.requireSignature }).check();
    await main.getByRole("button", { name: f.addQuestion, exact: true }).click();
    await main
        .getByRole("textbox", { name: f.questionLabel, exact: true })
        .fill("Care instructions");
    await main.getByRole("switch", { name: f.required, exact: true }).check();
    const creating = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === "/v1/forms" &&
            response.request().method() === "POST",
    );
    await main.getByRole("button", { name: f.save, exact: true }).click();
    const created = await creating;
    expect(created.status(), await created.text()).toBe(201);
    const form = (await created.json()) as {
        id: string;
        send_on: string;
        require_signature: boolean;
        fields: { id: string; name: string; label: string; required: boolean }[];
    };
    expect(form).toMatchObject({
        send_on: "manual",
        require_signature: true,
        fields: [{ label: "Care instructions", required: true }],
    });
    const question = form.fields[0];
    if (question === undefined) throw new Error("The saved form has no question");
    await expect(main.getByRole("heading", { name, exact: true })).toBeVisible({ timeout: 60_000 });

    const issued = await sendToClient(page, f.send, "/v1/forms/send", client);
    const [link] = await mailedLinks(page.request, client.email, "/form/");
    expect(link?.pathname).toBe(`/form/${issued.token}`);
    const context = await customerContext(browser);
    try {
        const customer = await context.newPage();
        await customer.goto(link?.href ?? "");
        await expect(customer.getByRole("heading", { name })).toBeVisible();
        const answer = customer.getByRole("textbox", { name: /Care instructions/ });
        await expect(answer).toBeVisible();

        await main.getByText("Care instructions", { exact: true }).first().click();
        await main
            .getByRole("textbox", { name: f.questionLabel, exact: true })
            .fill("Feeding notes");
        await main.getByRole("switch", { name: f.requireSignature }).uncheck();
        const saving = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === `/v1/forms/${form.id}` &&
                response.request().method() === "PATCH",
        );
        await main.getByRole("button", { name: f.save, exact: true }).click();
        const saved = await saving;
        expect(saved.status(), await saved.text()).toBe(200);
        expect(await saved.json()).toMatchObject({
            require_signature: false,
            fields: [{ id: question.id, name: question.name, label: "Feeding notes" }],
        });

        await answer.fill("Quiet room, no fragrance.");
        await customer.getByRole("textbox", { name: pf.signerName }).fill(client.name);
        await customer.getByRole("switch").check();
        await customer.getByRole("button", { name: pf.sendAnswers, exact: true }).click();
        await expect(customer.getByRole("heading", { name: pf.doneTitle })).toBeVisible();
        const submitted = await formEvidence(issued.id);
        expect(submitted).toMatchObject({
            status: "submitted",
            answers: { [question.name]: "Quiet room, no fragrance." },
            signature: { name: client.name },
            definition: {
                name,
                require_signature: true,
                fields: [{ name: question.name, label: "Care instructions", required: true }],
            },
        });
        expect(submitted.submitted_at).not.toBeNull();

        const record = await openClient(page, client);
        await record.getByRole("button", { name: f.viewAnswers, exact: true }).click({
            timeout: 60_000,
        });
        const answers = page.getByRole("dialog");
        await expect(answers.getByText("Care instructions", { exact: true })).toBeVisible();
        await expect(answers.getByText("Quiet room, no fragrance.", { exact: true })).toBeVisible();
        await expect(answers.getByText("Feeding notes", { exact: true })).toHaveCount(0);
        await answers.getByRole("button", { name: strings.common.close, exact: true }).click();

        await navigate(page, "/today");
        await navigate(page, "/inbox?segment=forms");
        await main.getByText(name, { exact: true }).click({ timeout: 60_000 });
        const again = await sendToClient(page, f.send, "/v1/forms/send", client);
        const links = await mailedLinks(page.request, client.email, "/form/", 2);
        const next = links.find((url) => url.pathname === `/form/${again.token}`);
        expect(next).toBeDefined();
        await customer.goto(next?.href ?? "");
        await expect(customer.getByRole("textbox", { name: /Feeding notes/ })).toBeVisible();
        await expect(customer.getByRole("textbox", { name: /Care instructions/ })).toHaveCount(0);
        await expect(customer.getByRole("textbox", { name: pf.signerName })).toHaveCount(0);
        expect(await formEvidence(issued.id)).toEqual(submitted);
        await testInfo.attach("form-snapshot", {
            body: JSON.stringify(submitted),
            contentType: "application/json",
        });
    } finally {
        await context.close();
    }
});
