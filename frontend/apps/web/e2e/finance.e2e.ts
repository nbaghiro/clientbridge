import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import {
    downloadPack,
    downloadReport,
    expectCsv,
    expectFinance,
    financeEvidence,
    financeFixture,
    fullRefundUi,
    incomeUi,
    periodDates,
    reports,
} from "./support/finance";
import { signIn } from "./support/session";

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
    await expect(
        page.getByRole("button", { name: strings.reports.downloadCsv, exact: true }),
    ).toBeDisabled();
    await expect(
        page.getByRole("button", { name: strings.reports.bookkeeperPack, exact: true }),
    ).toBeDisabled();
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
            other.getByRole("button", { name: strings.reports.downloadCsv, exact: true }),
        ).toBeDisabled();
        await expect(
            other.getByRole("button", { name: strings.reports.bookkeeperPack, exact: true }),
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
