import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import {
    bookkeeperCsvs,
    bookkeeperFixture,
    bookkeeperUi,
    downloadPack,
    downloadReport,
    expectCsv,
    expectFinance,
    financeEvidence,
    financeFixture,
    fullRefundUi,
    incomeUi,
    PACK_KINDS,
    periodDates,
    reportFile,
    reports,
} from "./support/reports";
import { bookingApi } from "./support/bookings";
import { signIn } from "./support/session";

const s = strings.reports;

// API invoice/cash prerequisites support real report downloads and the FIN01 UI refund.
test("FIN-REPORT-01 recognized income and cash CSV reconcile after a real full refund", async ({
    page,
    browser,
}, info) => {
    const f = await financeFixture(page, true);
    const initial = await financeEvidence(f.businessId);
    expectFinance(initial, f, false);
    await reports(page);
    await incomeUi(page, true, false);
    expectCsv(
        await downloadReport(page, info, "income", "before"),
        await downloadReport(page, info, "salesByItem", "before"),
        f,
        false,
    );
    // All tenant financial records remain byte-for-byte identical through report reads.
    expect(await financeEvidence(f.businessId)).toEqual(initial);
    await fullRefundUi(page, f);
    const final = await financeEvidence(f.businessId);
    expectFinance(final, f, true);
    await reports(page);
    await incomeUi(page, true, true);
    expectCsv(
        await downloadReport(page, info, "income", "after"),
        await downloadReport(page, info, "salesByItem", "after"),
        f,
        true,
    );
    await page.reload();
    await reports(page);
    await incomeUi(page, true, true);
    const observer = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
        const other = await observer.newPage();
        await signIn(other, f.account);
        await reports(other);
        await incomeUi(other, true, true);
        expectCsv(
            await downloadReport(other, info, "income", "second-owner-session"),
            await downloadReport(other, info, "salesByItem", "second-owner-session"),
            f,
            true,
        );
        await other.reload();
        await reports(other);
        await incomeUi(other, true, true);
        expect(await financeEvidence(f.businessId)).toEqual(final);
        await info.attach("owned-finance-records", {
            body: JSON.stringify({ businessId: f.businessId, initial, final }),
            contentType: "application/json",
        });
    } finally {
        await observer.close();
    }
});

test("FIN-EXPORT-02 selected bookkeeper ZIP matches exact CSV cents and empty periods disable export", async ({
    page,
    browser,
}, info) => {
    const f = await financeFixture(page, false);
    const initial = await financeEvidence(f.businessId);
    expectFinance(initial, f, false);
    await reports(page);
    await incomeUi(page, false, false);
    const income = await downloadReport(page, info, "income", "individual");
    const items = await downloadReport(page, info, "salesByItem", "individual");
    expectCsv(income, items, f, false);
    const pack = await downloadPack(page, info, "selected-bookkeeper", true);
    const span = periodDates("thisMonth");
    const incomeName = `income-${span.start}-to-${span.end}.csv`;
    const itemsName = `sales-by-item-${span.start}-to-${span.end}.csv`;
    expect(pack.members.sort()).toEqual([incomeName, itemsName].sort());
    expect(pack.rows).toEqual({ [incomeName]: income, [itemsName]: items });
    expectCsv(pack.rows[incomeName] ?? [], pack.rows[itemsName] ?? [], f, false);
    expect(await financeEvidence(f.businessId)).toEqual(initial);
    // A real source-supported boundary: empty report load disables downloads, not empty CSV.
    await page.reload();
    await reports(page, "lastMonth");
    await expect(page.getByRole("button", { name: s.downloadCsv, exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: s.bookkeeperPack, exact: true })).toBeDisabled();
    const observer = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
        const other = await observer.newPage();
        await signIn(other, f.account);
        await reports(other);
        const again = await downloadPack(other, info, "second-session-pack");
        expect(again).toEqual(pack);
        await other.reload();
        await reports(other, "lastMonth");
        await expect(
            other.getByRole("button", { name: s.downloadCsv, exact: true }),
        ).toBeDisabled();
        await expect(
            other.getByRole("button", { name: s.bookkeeperPack, exact: true }),
        ).toBeDisabled();
        expect(await financeEvidence(f.businessId)).toEqual(initial);
        await info.attach("owned-export-ledger", {
            body: JSON.stringify(initial),
            contentType: "application/json",
        });
    } finally {
        await observer.close();
    }
});

test("FIN-REPORT-12 every report and its CSV match hand totals, in the business zone, owners only", async ({
    page,
    browser,
    baseURL,
}, info) => {
    test.slow();
    const origin = baseURL ?? "";
    const f = await bookkeeperFixture(page, browser, origin);
    try {
        const expected = bookkeeperCsvs(f);
        const span = periodDates("thisMonth");
        await reports(page);
        await bookkeeperUi(page, f);
        for (const kind of ["income", "salesByItem", "gstHst", "pst", "t4a"] as const)
            expect(await downloadReport(page, info, kind, "bookkeeper")).toEqual(expected[kind]);
        const pack = await downloadPack(page, info, "bookkeeper-pack", false, PACK_KINDS);
        expect(pack.members).toEqual(PACK_KINDS.map((kind) => reportFile(kind, span)));
        for (const kind of PACK_KINDS)
            if (kind !== "staffPay")
                expect(pack.rows[reportFile(kind, span)]).toEqual(expected[kind]);
        const [header, ...paid] = pack.rows[reportFile("staffPay", span)] ?? [];
        expect(header).toEqual([
            "paid_on",
            "staff_id",
            "name",
            "earning_id",
            "basis",
            "run",
            "amount_cents",
        ]);
        expect(paid.map((r) => [r[0], r[1], r[2], r[4], r[6]])).toEqual([
            [span.end, f.member.id, f.member.name, "adjustment", "25000"],
        ]);
        // a month with no activity offers nothing to download, though the year has a T4A payee
        await page.reload();
        await reports(page, "lastMonth");
        for (const name of [s.downloadCsv, s.bookkeeperPack])
            await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
        await expect(page.getByText(s.noSales, { exact: true })).toBeVisible();
        await page.getByRole("tab", { name: s.library.t4a, exact: true }).click();
        await expect(page.getByRole("row", { name: f.member.name })).toBeVisible();
        await expect(page.getByRole("button", { name: s.downloadCsv, exact: true })).toBeDisabled();

        // UTC+14 is a calendar day ahead of Vancouver for most of the day
        const away = await browser.newContext({
            baseURL: origin,
            timezoneId: "Pacific/Kiritimati",
        });
        try {
            const laptop = await away.newPage();
            await signIn(laptop, f.account);
            const reads: URL[] = [];
            laptop.on("request", (r) => {
                const url = new URL(r.url());
                if (url.pathname === "/v1/reports/summary") reads.push(url);
            });
            await reports(laptop);
            expect(Object.fromEntries(reads.at(-1)?.searchParams ?? [])).toEqual(span);
            await bookkeeperUi(laptop, f);
            expect(await downloadReport(laptop, info, "income", "away")).toEqual(expected.income);
        } finally {
            await away.close();
        }

        const staff = f.member.page;
        await staff.goto("/payments/reports");
        await expect(staff).not.toHaveURL(/\/payments\/reports/);
        await expect(staff.getByRole("tab", { name: s.title, exact: true })).toHaveCount(0);
        const refused = await staff.request.get(
            `${bookingApi()}/v1/reports/summary?start=${span.start}&end=${span.end}`,
            { headers: { Origin: new URL(staff.url()).origin } },
        );
        expect(refused.status()).toBe(403);
    } finally {
        await f.member.close();
    }
});
