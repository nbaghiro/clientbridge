import { randomUUID } from "node:crypto";
import { formatMoney, strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { bookingApi } from "./support/bookings";
import { type FilingEvidence, filingEvidence as evidence } from "./support/reports";
import { navigate, signIn } from "./support/session";
import { demoId, runEmail } from "@clientbridge/config/e2e/run";

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
            dialog.getByRole("heading", { name: s.recordFiled, exact: true }),
        ).toBeVisible();
        await expect(dialog.getByText(title)).toBeVisible();
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

const day = (key: string, days: number): string =>
    new Date(Date.parse(`${key}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

test("FIN-RETURN-13 refuse overlapping, open and early returns, file partial ranges and refresh a stale form", async ({
    page,
    browser,
}) => {
    test.setTimeout(120_000);
    const s = strings.remittances;
    const owner = { email: runEmail("owner@northlight.example"), password: "demo1234" };
    const baseline = await evidence("bz_northlight");
    expect(baseline.returns).toEqual([]);
    const owed = (code: string) =>
        -baseline.raw_tax.filter((e) => e.code === code).reduce((n, e) => n + e.amount_cents, 0);
    expect(owed("GST")).toBeGreaterThan(0);
    expect(owed("PST")).toBeGreaterThan(0);
    const [year, month] = baseline.start.split("-").map(Number);
    const title = s.quarter(Math.floor(((month ?? 1) - 1) / 3) + 1, year ?? 0);
    const quarter = { period_start: baseline.start, period_end: baseline.end };
    const api = `${bookingApi()}/v1/payments/remittances`;

    await signIn(page, owner);
    const origin = () => ({ Origin: new URL(page.url()).origin });
    const setAside = async () =>
        (await (await page.request.get(api, { headers: origin() })).json()) as {
            federal_set_aside_cents: number;
            provincial_set_aside_cents: number;
        };
    await navigate(page, "/payments/tax");
    const csv = page.waitForEvent("download");
    await page.getByRole("button", { name: s.downloadCsv, exact: true }).click();
    expect((await csv).suggestedFilename()).toBe(
        `gst-hst-${baseline.start}-to-${baseline.end}.csv`,
    );
    const setAsideBefore = await setAside();
    // a second tab opens the same return before the first records it
    const recordBesideStaleTab = async (): Promise<FilingEvidence> => {
        const staleContext = await browser.newContext();
        try {
            const stale = await staleContext.newPage();
            await signIn(stale, owner);
            for (const p of [page, stale]) {
                await navigate(p, "/payments/tax");
                await p.getByRole("button", { name: s.recordFiled, exact: true }).click();
                await p
                    .getByRole("dialog")
                    .getByRole("textbox", { name: s.confirmationField, exact: true })
                    .fill(`CRA-${p === page ? "WEB" : "STALE"}`);
            }
            const sent = page.waitForResponse(
                (r) => r.url() === api && r.request().method() === "POST",
            );
            await page
                .getByRole("dialog")
                .getByRole("button", { name: s.record, exact: true })
                .click();
            expect((await sent).status()).toBe(201);
            await expect(page.getByRole("dialog")).toBeHidden();
            // the period's GST/HST is filed, so it leaves what is owed to the CRA while its PST is due
            await expect(page.getByRole("listitem").filter({ hasText: title })).toHaveCount(0);
            await expect(page.getByRole("term").filter({ hasText: /^GST\/HST$/ })).toHaveCount(0);
            await expect(page.getByRole("term").filter({ hasText: /^PST$/ })).toBeVisible();
            const filed = await evidence("bz_northlight");
            expect(new Set(filed.returns.map((e) => e.journal_id)).size).toBe(1);

            const refused = stale.waitForResponse(
                (r) => r.url() === api && r.request().method() === "POST",
            );
            await stale
                .getByRole("dialog")
                .getByRole("button", { name: s.record, exact: true })
                .click();
            const answer = await refused;
            expect([answer.status(), ((await answer.json()) as { error: string }).error]).toEqual([
                409,
                "return_filed",
            ]);
            await expect(stale.getByText(strings.api.returnFiled, { exact: true })).toBeVisible();
            await stale.keyboard.press("Escape");
            await expect(stale.getByRole("listitem").filter({ hasText: title })).toHaveCount(0);
            expect(await evidence("bz_northlight")).toEqual(filed);
            return filed;
        } finally {
            await staleContext.close();
        }
    };
    const filed = await recordBesideStaleTab();
    // Today's sales tax set aside, GST/HST and PST together, drops by the GST/HST the return filed
    const setAsideAfter = await setAside();
    expect(setAsideAfter.federal_set_aside_cents).toBe(
        setAsideBefore.federal_set_aside_cents - owed("GST"),
    );
    expect(setAsideAfter.provincial_set_aside_cents).toBe(
        setAsideBefore.provincial_set_aside_cents,
    );
    await navigate(page, "/");
    await expect(
        page.getByText(strings.today.setAside, { exact: true }).locator("xpath=ancestor::div[2]"),
    ).toContainText(
        formatMoney(
            setAsideAfter.federal_set_aside_cents + setAsideAfter.provincial_set_aside_cents,
            "CAD",
        ),
    );

    const post = (data: Record<string, unknown>) =>
        page.request.post(api, {
            headers: { ...origin(), "Idempotency-Key": randomUUID() },
            data,
        });
    const firstMonthEnd = day(
        `${baseline.start.slice(0, 5)}${String((month ?? 1) + 1).padStart(2, "0")}-01`,
        -1,
    );
    for (const [data, status, error] of [
        [{ ...quarter, family: "federal" }, 409, "return_filed"],
        [quarter, 409, "return_filed"],
        [
            {
                period_start: day(baseline.start, 14),
                period_end: day(baseline.start, 20),
                family: "federal",
            },
            409,
            "return_filed",
        ],
        [
            {
                period_start: day(baseline.start, -3),
                period_end: day(baseline.start, 3),
                family: "federal",
            },
            409,
            "return_filed",
        ],
        [
            {
                period_start: day(baseline.end, 1),
                period_end: baseline.filed_on,
                family: "federal",
            },
            422,
            "period_open",
        ],
        [
            { period_start: baseline.end, period_end: baseline.start, family: "federal" },
            422,
            "invalid_period",
        ],
        [{ ...quarter, family: "provincial", filed_on: baseline.end }, 422, "invalid_filed_on"],
    ] as const) {
        const res = await post(data);
        expect(
            [res.status(), ((await res.json()) as { error: string }).error],
            JSON.stringify(data),
        ).toEqual([status, error]);
    }
    const afterRefusals = await evidence("bz_northlight");
    expect(afterRefusals).toEqual(filed);

    const partial = await post({
        period_start: baseline.start,
        period_end: firstMonthEnd,
        family: "provincial",
    });
    expect(partial.status(), await partial.text()).toBe(201);
    const statusOf = async () => {
        const res = await page.request.get(api, { headers: origin() });
        const body = (await res.json()) as {
            federal_set_aside_cents: number;
            provincial_set_aside_cents: number;
            periods: {
                start: string;
                federal_cents: number;
                provincial_cents: number;
                federal_status: string;
                provincial_status: string;
            }[];
        };
        const unfiled = (family: "federal" | "provincial") =>
            body.periods
                .filter((p) => p[`${family}_status`] !== "filed")
                .reduce((n, p) => n + p[`${family}_cents`], 0);
        expect(body.federal_set_aside_cents).toBe(unfiled("federal"));
        expect(body.provincial_set_aside_cents).toBe(unfiled("provincial"));
        return body.periods.find((p) => p.start === baseline.start)?.provincial_status;
    };
    expect(await statusOf()).toBe("due");
    // the whole quarter, as the app records it, files only the days the first month left
    const rest = await post({ ...quarter, family: "provincial" });
    expect(rest.status(), await rest.text()).toBe(201);
    expect(((await rest.json()) as { period_start: string }).period_start).toBe(
        day(firstMonthEnd, 1),
    );
    expect(await statusOf()).toBe("filed");
    const twice = await post({ ...quarter, family: "provincial" });
    expect([twice.status(), ((await twice.json()) as { error: string }).error]).toEqual([
        409,
        "return_filed",
    ]);
    const final = await evidence("bz_northlight");
    const pst = final.returns.filter((e) => e.category === "tax" && e.code === "PST");
    expect(pst.reduce((n, e) => n + e.amount_cents, 0)).toBe(owed("PST"));

    await navigate(page, "/payments/tax");
    await expect(page.getByRole("button", { name: s.downloadCsv, exact: true })).toBeVisible();
    // the quarter in progress can't be recorded until it ends
    await expect(page.getByRole("button", { name: s.recordFiled, exact: true })).toHaveCount(0);
    const row = page.getByRole("row").filter({ has: page.getByText(title, { exact: true }) });
    await expect(row).toContainText("CRA-WEB");
    // the PST filed in two parts shows as one total
    await expect(row).toContainText(
        strings.common.labelValue("PST", formatMoney(owed("PST"), "CAD")),
    );
});
