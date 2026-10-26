import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { inflateRawSync } from "node:zlib";
import { formatCredit, formatMoney, strings } from "@clientbridge/app-core/public";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { newAccount } from "../identity";
import { bookingApi } from "./bookings";
import { createClient } from "./crm";
import { select } from "./db";
import { requireLocalMail } from "./evidence";
import { signUp, openBusiness } from "./onboarding";
import { openRefund, type RefundFixture } from "./refunds";
import { navigate } from "./session";
import { demoId, runSetting } from "@clientbridge/config/e2e/run";

const s = strings.reports;
export interface FinanceFixture extends RefundFixture {
    account: ReturnType<typeof newAccount>;
    businessId: string;
    itemId: string;
    itemName: string;
    unpaidId: string | null;
}
export interface FinanceEvidence {
    business: { id: string; province: string; timezone: string; tax_registered: boolean }[];
    entries: {
        id: string;
        journal_id: string;
        event: string;
        subject_type: string;
        subject_id: string;
        source_type: string | null;
        source_id: string | null;
        owner_type: string;
        owner_id: string;
        amount_cents: number;
        category: string;
        code: string;
    }[];
    invoices: {
        id: string;
        status: string;
        subtotal_cents: number;
        tax_total_cents: number;
        total_cents: number;
    }[];
    payments: {
        id: string;
        invoice_id: string;
        kind: string;
        status: string;
        method: string;
        amount_cents: number;
        parent_payment_id: string | null;
        credit_note: string | null;
    }[];
    lines: {
        id: string;
        invoice_id: string;
        item_id: string;
        quantity: string | number;
        amount_cents: number;
        tax_amount_cents: number;
    }[];
    commands: { id: string; scope: string; key: string }[];
}
interface Artifact {
    members: string[];
    rows: Record<string, string[][]>;
}
export async function financeEvidence(businessId: string): Promise<FinanceEvidence> {
    type Evidence = FinanceEvidence;
    return {
        business: await select<Evidence["business"][number]>`
            SELECT id, province, timezone, tax_registered FROM businesses WHERE id = ${businessId}`,
        entries: await select<Evidence["entries"][number]>`
            SELECT e.id, e.journal_id, e.event, e.subject_type, e.subject_id, e.source_type,
                e.source_id, e.amount_cents, a.category, a.code, a.owner_type, a.owner_id
            FROM entries e JOIN accounts a ON a.id = e.account_id
            WHERE e.business_id = ${businessId} ORDER BY e.id`,
        invoices: await select<Evidence["invoices"][number]>`
            SELECT id, status, subtotal_cents, tax_total_cents, total_cents FROM invoices
            WHERE business_id = ${businessId} ORDER BY id`,
        payments: await select<Evidence["payments"][number]>`
            SELECT id, invoice_id, kind, status, method, amount_cents, parent_payment_id,
                credit_note
            FROM payments WHERE business_id = ${businessId} ORDER BY id`,
        lines: await select<Evidence["lines"][number]>`
            SELECT id, invoice_id, item_id, quantity, amount_cents, tax_amount_cents FROM lines
            WHERE business_id = ${businessId} ORDER BY id`,
        commands: await select<Evidence["commands"][number]>`
            SELECT id, scope, key FROM commands WHERE business_id = ${businessId} ORDER BY id`,
    };
}

function csvRows(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let quoted = false;
    let started = false;
    const body = text.replace(/^\uFEFF/, "");
    for (let index = 0; index < body.length; index++) {
        const char = body.charAt(index);
        if (quoted) {
            if (char === '"' && body.charAt(index + 1) === '"') {
                field += '"';
                index++;
            } else if (char === '"') quoted = false;
            else field += char;
        } else if (char === '"') {
            quoted = true;
            started = true;
        } else if (char === ",") {
            row.push(field);
            field = "";
            started = true;
        } else if (char === "\r" || char === "\n") {
            if (char === "\r" && body.charAt(index + 1) === "\n") index++;
            rows.push(started || field !== "" ? [...row, field] : []);
            row = [];
            field = "";
            started = false;
        } else field += char;
    }
    if (started || field !== "") rows.push([...row, field]);
    return rows;
}

// reads the central directory, so a duplicated member name stays visible in `members`
function zipMembers(archive: Buffer): { name: string; text: string }[] {
    const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (end < 0) throw new Error("Downloaded archive has no ZIP end record");
    const count = archive.readUInt16LE(end + 10);
    let entry = archive.readUInt32LE(end + 16);
    const members: { name: string; text: string }[] = [];
    for (let index = 0; index < count; index++) {
        const method = archive.readUInt16LE(entry + 10);
        const size = archive.readUInt32LE(entry + 20);
        const nameLength = archive.readUInt16LE(entry + 28);
        const skip =
            nameLength + archive.readUInt16LE(entry + 30) + archive.readUInt16LE(entry + 32);
        const name = archive.toString("utf8", entry + 46, entry + 46 + nameLength);
        const local = archive.readUInt32LE(entry + 42);
        const start =
            local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
        const data = archive.subarray(start, start + size);
        if (method !== 0 && method !== 8)
            throw new Error(`Unsupported ZIP method ${String(method)}`);
        members.push({ name, text: (method === 8 ? inflateRawSync(data) : data).toString("utf8") });
        entry += 46 + skip;
    }
    return members;
}

async function artifact(path: string): Promise<Artifact> {
    if (path.endsWith(".zip")) {
        const members = zipMembers(await readFile(path));
        return {
            members: members.map((member) => member.name),
            rows: Object.fromEntries(members.map((m) => [m.name, csvRows(m.text)])),
        };
    }
    const name = basename(path);
    return { members: [name], rows: { [name]: csvRows(await readFile(path, "utf8")) } };
}

export interface FilingEvidence {
    start: string;
    end: string;
    lo: string;
    hi: string;
    seed_as_of: string;
    filed_on: string;
    business: {
        id: string;
        province: string;
        timezone: string;
        tax_registered: boolean;
        filing_frequency: string;
    }[];
    raw_tax: { id: string; amount_cents: number; code: string }[];
    returns: {
        journal_id: string;
        amount_cents: number;
        category: string;
        code: string;
        meta: {
            family: string;
            start: string;
            end: string;
            itc_cents: number;
            confirmation: string;
            filed_on: string;
        };
    }[];
    commands: unknown[];
    audits: unknown[];
}

/** The seeded business's last completed quarter in Vancouver, its raw tax legs and filings. */
export async function filingEvidence(): Promise<FilingEvidence> {
    const zone = "America/Vancouver";
    const [period] = await select<{
        start: string;
        end: string;
        lo: string;
        hi: string;
        anchor: string;
        filed_on: string;
    }>`
        WITH day AS (SELECT (now() AT TIME ZONE ${zone})::date AS today),
        quarter AS (SELECT today, date_trunc('quarter', today)::date AS first FROM day),
        bounds AS (
            SELECT today, first, date_trunc('quarter', first - 1)::date AS start FROM quarter)
        SELECT start::text AS start, (first - 1)::text AS "end",
            to_jsonb(start::timestamp AT TIME ZONE ${zone}) AS lo,
            to_jsonb(first::timestamp AT TIME ZONE ${zone}) AS hi,
            to_jsonb((first + time '12:00') AT TIME ZONE ${zone}) AS anchor,
            today::text AS filed_on
        FROM bounds`;
    if (period === undefined) throw new Error("the filing period query returned nothing");
    const seeded = runSetting("E2E_SEED_AS_OF");
    if (Date.parse(seeded) !== Date.parse(period.anchor))
        throw new Error("requires the first seed at noon Vancouver on this quarter's first day");
    const { start, end, lo, hi } = period;
    const business = demoId("bz_birchbark");
    return {
        start,
        end,
        lo,
        hi,
        seed_as_of: seeded,
        filed_on: period.filed_on,
        business: await select<FilingEvidence["business"][number]>`
            SELECT id, province, timezone, tax_registered, filing_frequency FROM businesses
            WHERE id = ${business}`,
        raw_tax: await select<FilingEvidence["raw_tax"][number]>`
            SELECT e.id, e.journal_id, e.event, e.amount_cents, a.code,
                to_jsonb(e.occurred_at) AS occurred_at
            FROM entries e JOIN accounts a ON a.id = e.account_id
            WHERE e.business_id = ${business} AND a.category = 'tax'
                AND e.event != 'remittance'
                AND e.occurred_at >= ${lo}::timestamptz AND e.occurred_at < ${hi}::timestamptz
            ORDER BY e.id`,
        returns: await select<FilingEvidence["returns"][number]>`
            SELECT e.id, e.journal_id, e.ref, e.leg, e.amount_cents, a.category, a.code, e.meta
            FROM entries e JOIN accounts a ON a.id = e.account_id
            WHERE e.business_id = ${business} AND e.event = 'remittance'
                AND e.meta->>'start' <= ${end} AND e.meta->>'end' >= ${start}
            ORDER BY e.journal_id, e.leg`,
        commands: await select<{ id: string; scope: string }>`
            SELECT id, scope FROM commands
            WHERE business_id = ${business} AND scope = 'tax.remit' ORDER BY id`,
        audits: await select<{ id: string; action: string; entity_id: string }>`
            SELECT id, action, entity_id FROM audits
            WHERE business_id = ${business} AND action = 'tax.remit' ORDER BY id`,
    };
}

export async function financeFixture(page: Page, unpaid: boolean): Promise<FinanceFixture> {
    requireLocalMail();
    const api = bookingApi();
    const account = newAccount("finance");
    await signUp(page, page.request, account);
    const onboarding = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/v1/onboarding" && r.request().method() === "POST",
    );
    await openBusiness(page, `${account.name}'s Beauty Studio`);
    const created = await onboarding;
    expect(created.status(), await created.text()).toBe(201);
    const business = (await created.json()) as { id: string };
    const headers = (): Record<string, string> => ({
        Origin: new URL(page.url()).origin,
        "Idempotency-Key": randomUUID(),
    });
    const settings = await page.request.patch(`${api}/v1/business`, {
        headers: headers(),
        data: { tax_registered: true, timezone: "America/Vancouver" },
    });
    expect(settings.status(), await settings.text()).toBe(200);
    const empty = await financeEvidence(business.id);
    expect(empty.business).toEqual([
        { id: business.id, province: "BC", timezone: "America/Vancouver", tax_registered: true },
    ]);
    expect(empty.entries).toEqual([]);
    expect(empty.invoices).toEqual([]);
    expect(empty.payments).toEqual([]);
    const client = await createClient(page);
    const itemName = "Éclat facial, sensitive skin";
    const itemResponse = await page.request.post(`${api}/v1/items`, {
        headers: headers(),
        data: {
            kind: "service",
            name: itemName,
            duration_min: 30,
            price_cents: 10000,
            tax_class: "standard",
            deposit_type: "none",
            online_bookable: false,
        },
    });
    expect(itemResponse.status(), await itemResponse.text()).toBe(201);
    const item = (await itemResponse.json()) as { id: string };
    const issue = async (cents: number) => {
        const response = await page.request.post(`${api}/v1/invoices`, {
            headers: headers(),
            data: {
                client_id: client.id,
                send: true,
                lines: [
                    {
                        item_id: item.id,
                        description: itemName,
                        quantity: 1,
                        unit_amount_cents: cents,
                        tax_class: "standard",
                    },
                ],
            },
        });
        expect(response.status(), await response.text()).toBe(201);
        const invoice = (await response.json()) as {
            id: string;
            number: number;
            subtotal_cents: number;
            tax_total_cents: number;
            total_cents: number;
        };
        expect(invoice).toMatchObject({
            subtotal_cents: cents,
            tax_total_cents: (cents * 12) / 100,
            total_cents: (cents * 112) / 100,
        });
        return invoice;
    };
    const invoice = await issue(10000);
    const paid = await page.request.post(`${api}/v1/invoices/${invoice.id}/payments`, {
        headers: headers(),
        data: { method: "cash", amount_cents: 11200, tendered_cents: 11200, send_receipt: false },
    });
    expect(paid.status(), await paid.text()).toBe(201);
    const payment = (await paid.json()) as { payment_id: string; status: string };
    expect(payment.status).toBe("succeeded");
    return {
        account,
        businessId: business.id,
        itemId: item.id,
        itemName,
        client,
        invoiceId: invoice.id,
        number: invoice.number,
        paymentId: payment.payment_id,
        unpaidId: unpaid ? (await issue(5000)).id : null,
    };
}

/** Independently fixed 5% GST + 7% PST arithmetic, no production report/tax oracle. */
export function expectFinance(e: FinanceEvidence, f: FinanceFixture, refunded: boolean): void {
    const unpaid = f.unpaidId !== null;
    expect(e.invoices).toHaveLength(unpaid ? 2 : 1);
    expect(e.lines).toHaveLength(unpaid ? 2 : 1);
    expect(e.invoices).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                id: f.invoiceId,
                status: "sent",
                subtotal_cents: 10000,
                tax_total_cents: 1200,
                total_cents: 11200,
            }),
        ]),
    );
    if (unpaid)
        expect(e.invoices).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: f.unpaidId,
                    status: "sent",
                    subtotal_cents: 5000,
                    tax_total_cents: 600,
                    total_cents: 5600,
                }),
            ]),
        );
    expect(e.lines.every((line) => line.item_id === f.itemId)).toBe(true);
    expect(e.payments).toHaveLength(refunded ? 2 : 1);
    expect(e.payments).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                id: f.paymentId,
                invoice_id: f.invoiceId,
                kind: "payment",
                method: "cash",
                status: "succeeded",
                amount_cents: 11200,
            }),
        ]),
    );
    if (refunded)
        expect(e.payments).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    invoice_id: f.invoiceId,
                    kind: "refund",
                    method: "cash",
                    status: "succeeded",
                    amount_cents: 11200,
                    parent_payment_id: f.paymentId,
                    credit_note: `CN-${String(f.number)}-1`,
                }),
            ]),
        );
    const exactLegs: object[] = [];
    const addLegs = (
        invoiceId: string,
        event: string,
        sourceId: string | null,
        amounts: readonly (readonly [string, string, number])[],
    ): void => {
        const legs = e.entries.filter(
            (row) =>
                row.event === event && row.subject_id === invoiceId && row.source_id === sourceId,
        );
        expect(new Set(legs.map((row) => row.journal_id)).size).toBe(1);
        for (const [category, code, amount_cents] of amounts)
            exactLegs.push({
                event,
                subject_type: "invoice",
                subject_id: invoiceId,
                source_type: sourceId === null ? null : "payment",
                source_id: sourceId,
                owner_type: category === "receivable" ? "client" : "business",
                owner_id: category === "receivable" ? f.client.id : f.businessId,
                category,
                code,
                amount_cents,
            });
    };
    addLegs(f.invoiceId, "invoice", null, [
        ["receivable", "", 11200],
        ["revenue", "", -10000],
        ["tax", "GST", -500],
        ["tax", "PST", -700],
    ]);
    if (f.unpaidId !== null)
        addLegs(f.unpaidId, "invoice", null, [
            ["receivable", "", 5600],
            ["revenue", "", -5000],
            ["tax", "GST", -250],
            ["tax", "PST", -350],
        ]);
    addLegs(f.invoiceId, "payment", f.paymentId, [
        ["cash", "", 11200],
        ["receivable", "", -11200],
    ]);
    if (refunded) {
        const refund = e.payments.find((payment) => payment.kind === "refund");
        if (refund === undefined) throw new Error("missing owned invoice refund");
        addLegs(f.invoiceId, "refund", refund.id, [
            ["cash", "", -11200],
            ["revenue", "", 10000],
            ["tax", "GST", 500],
            ["tax", "PST", 700],
        ]);
    }
    const actualLegs = e.entries.map(
        ({
            event,
            subject_type,
            subject_id,
            source_type,
            source_id,
            owner_type,
            owner_id,
            category,
            code,
            amount_cents,
        }) => ({
            event,
            subject_type,
            subject_id,
            source_type,
            source_id,
            owner_type,
            owner_id,
            category,
            code,
            amount_cents,
        }),
    );
    expect(actualLegs).toHaveLength(exactLegs.length);
    expect(actualLegs).toEqual(expect.arrayContaining(exactLegs));
    const sums = new Map<string, number>();
    for (const entry of e.entries) {
        const key = entry.category === "tax" ? `tax:${entry.code}` : entry.category;
        sums.set(key, (sums.get(key) ?? 0) + entry.amount_cents);
    }
    const remaining = (refunded ? 0 : 10000) + (unpaid ? 5000 : 0);
    expect(Object.fromEntries([...sums].sort())).toEqual({
        cash: refunded ? 0 : 11200,
        receivable: unpaid ? 5600 : 0,
        revenue: -remaining,
        "tax:GST": (-remaining * 5) / 100,
        "tax:PST": (-remaining * 7) / 100,
    });
    const journals = [...new Set(e.entries.map((row) => row.journal_id))];
    expect(journals).toHaveLength((unpaid ? 2 : 1) + 1 + (refunded ? 1 : 0));
    for (const id of journals)
        expect(
            e.entries
                .filter((row) => row.journal_id === id)
                .reduce((sum, row) => sum + row.amount_cents, 0),
        ).toBe(0);
}

export async function reports(
    page: Page,
    period: "thisMonth" | "lastMonth" = "thisMonth",
): Promise<void> {
    await navigate(page, "/payments/reports");
    await page.getByRole("button", { name: s.period[period], exact: true }).click();
    if (period === "thisMonth")
        await expect(page.getByRole("button", { name: s.downloadCsv, exact: true })).toBeEnabled();
    else await expect(page.getByText(s.noSales, { exact: true })).toBeVisible();
}
export async function incomeUi(page: Page, unpaid: boolean, refunded: boolean): Promise<void> {
    await page.getByRole("tab", { name: s.library.income, exact: true }).click();
    for (const [label, text] of [
        [s.sales, formatMoney(unpaid ? 15000 : 10000, "CAD")],
        [s.refunds, refunded ? formatCredit(10000, "CAD") : formatMoney(0, "CAD")],
        [s.netSales, formatMoney((unpaid ? 15000 : 10000) - (refunded ? 10000 : 0), "CAD")],
    ] as const)
        await expect(
            page
                .locator("dl > div")
                .filter({ has: page.getByText(label, { exact: true }) })
                .locator("dd"),
        ).toHaveText(text);
    await expect(
        page.getByText(s.received(formatMoney(refunded ? 0 : 11200, "CAD")), { exact: true }),
    ).toBeVisible();
}
export function periodDates(period: "thisMonth" | "lastMonth"): { start: string; end: string } {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Vancouver",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date());
    const part = (key: string): number => Number(parts.find((p) => p.type === key)?.value);
    const year = part("year"),
        month = part("month"),
        day = part("day");
    const key = (y: number, m: number, d: number): string => {
        const date = new Date();
        date.setUTCFullYear(y, m - 1, d);
        date.setUTCHours(0, 0, 0, 0);
        return date.toISOString().slice(0, 10);
    };
    return period === "thisMonth"
        ? { start: key(year, month, 1), end: key(year, month, day) }
        : { start: key(year, month - 1, 1), end: key(year, month, 0) };
}
export async function downloadReport(
    page: Page,
    info: TestInfo,
    kind: "income" | "salesByItem",
    tag: string,
): Promise<string[][]> {
    await page.getByRole("tab", { name: s.library[kind], exact: true }).click();
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: s.downloadCsv, exact: true }).click();
    const download = await pending;
    const span = periodDates("thisMonth");
    const name = `${kind === "income" ? "income" : "sales-by-item"}-${span.start}-to-${span.end}.csv`;
    expect(download.suggestedFilename()).toBe(name);
    const path = info.outputPath(`${tag}-${name}`);
    await download.saveAs(path);
    await info.attach(`${tag}-${name}`, { path, contentType: "text/csv" });
    const parsed = await artifact(path);
    const rows = parsed.rows[parsed.members[0] ?? ""];
    if (rows === undefined) throw new Error("Downloaded CSV has no parsed rows");
    return rows;
}
export function expectCsv(
    income: string[][],
    items: string[][],
    f: FinanceFixture,
    refunded: boolean,
): void {
    expect(income).toEqual([
        ["metric", "amount_cents"],
        ["gross", "11200"],
        ["refunds", refunded ? "11200" : "0"],
        ["net", refunded ? "0" : "11200"],
        ["method:cash", refunded ? "0" : "11200"],
    ]);
    expect(items).toEqual([
        ["item", "kind", "quantity", "sales_cents", "tax_cents", "refunded_cents"],
        [f.itemName, "service", "1", "10000", "1200", refunded ? "10000" : "0"],
    ]);
}
export async function fullRefundUi(page: Page, f: FinanceFixture): Promise<void> {
    const s = strings.refunds;
    const panel = await openRefund(page, f);
    await panel
        .getByRole("button", { name: s.full(formatMoney(11200, "CAD")), exact: true })
        .click();
    await panel.getByRole("switch", { name: s.notify, exact: true }).uncheck();
    const label = s.refundButton(formatMoney(11200, "CAD"));
    await panel.getByRole("button", { name: label, exact: true }).click();
    const confirm = page.getByRole("dialog", {
        name: s.confirmTitle(formatMoney(11200, "CAD")),
        exact: true,
    });
    const pending = page.waitForResponse(
        (r) =>
            new URL(r.url()).pathname === `/v1/payments/${f.paymentId}/refund` &&
            r.request().method() === "POST",
    );
    await confirm.getByRole("button", { name: label, exact: true }).click();
    const response = await pending;
    expect(response.status(), await response.text()).toBe(200);
    expect(await response.json()).toMatchObject({
        status: "succeeded",
        credit_note: `CN-${String(f.number)}-1`,
    });
}
export async function downloadPack(
    page: Page,
    info: TestInfo,
    tag: string,
    rejectEmpty = false,
): Promise<Artifact> {
    await page.getByRole("button", { name: s.bookkeeperPack, exact: true }).click();
    const dialog = page.getByRole("dialog");
    for (const checkbox of await dialog.getByRole("checkbox").all()) await checkbox.uncheck();
    if (rejectEmpty) {
        let downloads = 0,
            exports = 0;
        const onDownload = (): void => {
            downloads++;
        };
        const onRequest = (request: import("@playwright/test").Request): void => {
            if (new URL(request.url()).pathname === "/v1/reports/export") exports++;
        };
        page.on("download", onDownload);
        page.on("request", onRequest);
        try {
            await dialog.getByRole("button", { name: s.packDownload, exact: true }).click();
            await expect(dialog.getByText(s.pickReport, { exact: true })).toBeVisible();
            expect(downloads).toBe(0);
            expect(exports).toBe(0);
        } finally {
            page.off("download", onDownload);
            page.off("request", onRequest);
        }
    }
    for (const key of ["income", "salesByItem"] as const)
        await dialog.getByRole("checkbox", { name: s.library[key], exact: true }).check();
    const pending = page.waitForEvent("download");
    await dialog.getByRole("button", { name: s.packDownload, exact: true }).click();
    const download = await pending;
    const span = periodDates("thisMonth");
    expect(download.suggestedFilename()).toBe(`bookkeeper-${span.start}-to-${span.end}.zip`);
    const path = info.outputPath(`${tag}.zip`);
    await download.saveAs(path);
    await info.attach(tag, { path, contentType: "application/zip" });
    return artifact(path);
}
