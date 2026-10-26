import { randomUUID } from "node:crypto";
import { formatMoney, strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { bookingApi } from "./support/bookings";
import { filingEvidence as evidence } from "./support/reports";
import { navigate, signIn } from "./support/session";
import { demoId } from "@clientbridge/config/e2e/run";

test("FIN-RETURN-03 record both completed-quarter filings with exact ledger and replay evidence", async ({
    page,
    browser,
}, info) => {
    test.setTimeout(120_000);
    await signIn(page);
    const baseline = await evidence();
    expect(baseline.business).toEqual([
        {
            id: demoId("bz_birchbark"),
            province: "BC",
            timezone: "America/Vancouver",
            tax_registered: true,
            filing_frequency: "quarterly",
        },
    ]);
    expect(baseline.returns).toEqual([]);
    expect(baseline.raw_tax.length).toBeGreaterThan(0);
    expect([...new Set(baseline.raw_tax.map((e) => e.code))].sort()).toEqual(["GST", "PST"]);
    const gst = -baseline.raw_tax
        .filter((e) => e.code === "GST")
        .reduce((sum, e) => sum + e.amount_cents, 0);
    const pst = -baseline.raw_tax
        .filter((e) => e.code === "PST")
        .reduce((sum, e) => sum + e.amount_cents, 0);
    expect(gst).toBeGreaterThan(100);
    expect(pst).toBeGreaterThan(0);
    await info.attach("raw-quarter-tax-baseline", {
        body: JSON.stringify(baseline),
        contentType: "application/json",
    });
    const s = strings.remittances;
    const [year, month] = baseline.start.split("-").map(Number);
    const title = s.quarter(Math.floor(((month ?? 1) - 1) / 3) + 1, year ?? 0);
    await navigate(page, "/payments/tax");
    const open = async () => {
        await page.getByRole("button", { name: s.recordFiled, exact: true }).click();
        const dialog = page.getByRole("dialog");
        await expect(
            dialog.getByRole("heading", { name: s.recordTitle(title), exact: true }),
        ).toBeVisible();
        return dialog;
    };
    let dialog = await open();
    await dialog.getByRole("button", { name: s.record, exact: true }).click();
    await expect(dialog.getByText(s.errors.needConfirmation, { exact: true })).toBeVisible();
    expect(await evidence()).toEqual(baseline);
    await dialog
        .getByRole("textbox", { name: s.itcField, exact: true })
        .fill(((gst + 1) / 100).toFixed(2));
    await dialog.getByRole("button", { name: s.record, exact: true }).click();
    await expect(dialog.getByText(s.errors.itcTooHigh, { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(await evidence()).toEqual(baseline);
    for (const [family, code, owed, itc, confirmation] of [
        ["federal", "GST", gst, 100, "CRA-482716"],
        ["provincial", "PST", pst, 0, "BC-639281"],
    ] as const) {
        dialog = await open();
        if (family === "federal")
            await dialog.getByRole("textbox", { name: s.itcField, exact: true }).fill("1.00");
        else
            await expect(
                dialog.getByRole("textbox", { name: s.itcField, exact: true }),
            ).toHaveCount(0);
        await dialog
            .getByRole("textbox", {
                name: family === "federal" ? s.confirmationField : s.provincialConfirmationField,
                exact: true,
            })
            .fill(confirmation);
        const sent = page.waitForResponse(
            (r) =>
                new URL(r.url()).pathname === "/v1/payments/remittances" &&
                r.request().method() === "POST",
        );
        await dialog.getByRole("button", { name: s.record, exact: true }).click();
        const response = await sent;
        expect(response.status(), await response.text()).toBe(201);
        const body = response.request().postDataJSON() as Record<string, unknown>;
        expect(body).toMatchObject({
            period_start: baseline.start,
            period_end: baseline.end,
            family,
            itc_cents: itc,
            confirmation,
            filed_on: baseline.filed_on,
        });
        const committed = await evidence();
        expect(committed.raw_tax).toEqual(baseline.raw_tax);
        const legs = committed.returns.filter((e) => e.meta.family === family);
        expect(new Set(legs.map((e) => e.journal_id)).size).toBe(1);
        expect(legs.map((e) => [e.category, e.code, e.amount_cents]).sort()).toEqual(
            [
                ["tax", code, owed],
                ...(itc ? [["itc", "GST", -itc]] : []),
                ["bank", "", -(owed - itc)],
            ].sort(),
        );
        expect(legs.reduce((sum, e) => sum + e.amount_cents, 0)).toBe(0);
        for (const leg of legs)
            expect(leg.meta).toMatchObject({
                family,
                start: baseline.start,
                end: baseline.end,
                itc_cents: itc,
                confirmation,
                filed_on: baseline.filed_on,
            });
        const count = family === "federal" ? 1 : 2;
        expect(committed.commands.length - baseline.commands.length).toBe(count);
        expect(committed.audits.length - baseline.audits.length).toBe(count);
        const headers = {
            Origin: new URL(page.url()).origin,
            "Idempotency-Key": response.request().headers()["idempotency-key"] ?? "",
        };
        expect(headers["Idempotency-Key"]).not.toBe("");
        const replay = await page.request.post(`${bookingApi()}/v1/payments/remittances`, {
            headers,
            data: body,
        });
        expect(replay.status()).toBe(201);
        expect(await replay.json()).toEqual(await response.json());
        expect(await evidence()).toEqual(committed);
        const duplicate = await page.request.post(`${bookingApi()}/v1/payments/remittances`, {
            headers: { ...headers, "Idempotency-Key": randomUUID() },
            data: body,
        });
        expect(duplicate.status()).toBe(409);
        expect(await evidence()).toEqual(committed);
    }
    const final = await evidence();
    const observerContext = await browser.newContext();
    try {
        const observer = await observerContext.newPage();
        await signIn(observer);
        await navigate(observer, "/payments/tax");
        const row = observer
            .getByRole("row")
            .filter({ has: observer.getByText(title, { exact: true }) });
        await expect(row).toHaveCount(1);
        await expect(row).toContainText(formatMoney(gst - 100, "CAD"));
        await expect(row).toContainText(formatMoney(pst, "CAD"));
        await observer.reload();
        await expect(row).toContainText(formatMoney(gst - 100, "CAD"));
        await expect(row).toContainText(formatMoney(pst, "CAD"));
        expect(await evidence()).toEqual(final);
    } finally {
        await observerContext.close();
    }
});
