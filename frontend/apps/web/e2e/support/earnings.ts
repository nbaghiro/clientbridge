import { randomUUID } from "node:crypto";
import {
    addDays,
    combineDayAndTime,
    formatFullDate,
    formatMoney,
    strings,
} from "@clientbridge/app-core/public";
import { expect, type Locator, type Page } from "@playwright/test";
import { bookingApi, createBookingFixture } from "./bookings";
import { select } from "./db";
import { csvRows } from "./reports";
import { navigate } from "./session";

export interface StaffPayEntry {
    journal_id: string;
    event: string;
    ref: string;
    amount_cents: number;
    category: string;
    code: string;
    owner_type: string;
    owner_id: string;
}

export function staffPayEvidence(bookingId: string): Promise<StaffPayEntry[]> {
    return select<StaffPayEntry>`
        SELECT e.journal_id, e.event, e.ref, e.amount_cents, a.category, a.code, a.owner_type,
            a.owner_id
        FROM entries e JOIN accounts a ON a.id = e.account_id
        WHERE e.subject_type = 'booking' AND e.subject_id = ${bookingId}
            AND e.event IN ('earning', 'approval', 'staff_payment')
        ORDER BY e.journal_id, e.leg`;
}

export async function makePayee(page: Page, staffId: string): Promise<void> {
    const pay = await page.request.patch(`${bookingApi()}/v1/staff/${staffId}/pay`, {
        headers: { Origin: new URL(page.url()).origin },
        data: { payee: true, rate_type: "percent", rate_bps: 6000 },
    });
    expect(pay.status(), await pay.text()).toBe(200);
}

export async function createStaffPaySale(
    page: Page,
    staffId: string,
    onBooking: (id: string) => void,
    title = "Full coat care visit",
    daysAhead = 14,
): Promise<{ bookingId: string; orderId: string; paymentId: string; title: string }> {
    const api = bookingApi();
    const origin = new URL(page.url()).origin;
    await makePayee(page, staffId);
    const fixture = await createBookingFixture(page);
    const starts = combineDayAndTime(
        addDays(new Date(), daysAhead, fixture.zone),
        "10:00",
        fixture.zone,
    );
    const created = await page.request.post(`${api}/v1/bookings`, {
        headers: { Origin: origin, "Idempotency-Key": randomUUID() },
        data: {
            client_id: fixture.clientId,
            item_id: fixture.itemId,
            staff_id: staffId,
            starts_at: starts.toISOString(),
            notify: false,
        },
    });
    expect(created.status(), await created.text()).toBe(201);
    const booking = (await created.json()) as { id: string };
    onBooking(booking.id);
    const sale = await page.request.post(`${api}/v1/orders`, {
        headers: { Origin: origin, "Idempotency-Key": randomUUID() },
        data: {
            client_id: fixture.clientId,
            lines: [
                {
                    description: title,
                    unit_amount_cents: 10000,
                    quantity: 1,
                    tax_class: "exempt",
                    booking_id: booking.id,
                },
            ],
        },
    });
    expect(sale.status(), await sale.text()).toBe(201);
    const order = (await sale.json()) as { id: string };
    const settled = await page.request.post(`${api}/v1/orders/${order.id}/cash`, {
        headers: { Origin: origin, "Idempotency-Key": randomUUID() },
        data: { tendered_cents: 10000 },
    });
    expect(settled.status(), await settled.text()).toBe(200);
    const cash = (await settled.json()) as { payment_id: string };
    expect(cash).toMatchObject({ amount_cents: 10000, tip_cents: 0, change_cents: 0 });
    return { bookingId: booking.id, orderId: order.id, paymentId: cash.payment_id, title };
}

export interface StaffLedgerEntry {
    journal_id: string;
    event: string;
    ref: string;
    amount_cents: number;
    category: string;
    code: string;
    basis: string | null;
    run: string | null;
}

export function staffLedger(staffId: string): Promise<StaffLedgerEntry[]> {
    return select<StaffLedgerEntry>`
        SELECT e.journal_id, e.event, e.ref, e.amount_cents, a.category, a.code,
            e.meta->>'basis' AS basis, e.meta->>'run' AS run
        FROM entries e JOIN accounts a ON a.id = e.account_id
        WHERE e.journal_id IN (
            SELECT journal_id FROM entries WHERE owner_type = 'staff' AND owner_id = ${staffId})
        ORDER BY e.journal_id, e.leg`;
}

export function legSum(
    entries: StaffLedgerEntry[],
    match: (entry: StaffLedgerEntry) => boolean,
): number {
    return entries.filter(match).reduce((sum, entry) => sum + entry.amount_cents, 0);
}

export async function refundSale(page: Page, paymentId: string, cents: number): Promise<void> {
    const refunded = await page.request.post(`${bookingApi()}/v1/payments/${paymentId}/refund`, {
        headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
        data: { amount_cents: cents, notify: false },
    });
    expect(refunded.status(), await refunded.text()).toBe(200);
}

export function statementBusiness(
    staffId: string,
): Promise<{ name: string; street_name: string; city: string }[]> {
    return select<{ name: string; street_name: string; city: string }>`
        SELECT b.name, b.street_name, b.city FROM businesses b
        JOIN staff s ON s.business_id = b.id WHERE s.id = ${staffId}`;
}

export async function openStaffPay(page: Page, name: string) {
    await navigate(page, "/payments/staff-pay");
    await page
        .getByRole("button")
        .filter({ has: page.getByText(name, { exact: true }) })
        .click({ timeout: 60_000 });
    return page.getByRole("complementary", { name, exact: true });
}

export async function showPaid(panel: Locator): Promise<void> {
    await panel.getByRole("button", { name: strings.earnings.view.paid, exact: true }).click();
}

export function expectStaffJournals(
    entries: StaffPayEntry[],
    staffId: string,
    stage: "pending" | "approved" | "paid",
): void {
    const phases =
        stage === "pending"
            ? ["earning"]
            : stage === "approved"
              ? ["earning", "approval"]
              : ["earning", "approval", "staff_payment"];
    expect(entries).toHaveLength(phases.length * 2);
    for (const event of phases) {
        const legs = entries.filter((row) => row.event === event);
        expect(legs).toHaveLength(2);
        expect(new Set(legs.map((row) => row.journal_id)).size).toBe(1);
        expect(legs.reduce((sum, row) => sum + row.amount_cents, 0)).toBe(0);
        const expected =
            event === "earning"
                ? [
                      { category: "staff_cost", amount_cents: 6000, owner_type: "business" },
                      {
                          category: "payable",
                          code: "pending",
                          amount_cents: -6000,
                          owner_id: staffId,
                      },
                  ]
                : event === "approval"
                  ? [
                        {
                            category: "payable",
                            code: "pending",
                            amount_cents: 6000,
                            owner_id: staffId,
                        },
                        {
                            category: "payable",
                            code: "approved",
                            amount_cents: -6000,
                            owner_id: staffId,
                        },
                    ]
                  : [
                        {
                            category: "payable",
                            code: "approved",
                            amount_cents: 6000,
                            owner_id: staffId,
                        },
                        { category: "bank", amount_cents: -6000, owner_type: "business" },
                    ];
        expect(legs).toEqual(
            expect.arrayContaining(expected.map((leg) => expect.objectContaining(leg))),
        );
    }
}

interface ExtraLine {
    description: string;
    unit_amount_cents: number;
    item_id?: string;
    tax_class?: string;
}

/** Invoices a visit with any extra lines, sends it and records its full payment in cash. */
export async function invoiceVisit(
    page: Page,
    bookingId: string,
    extra: ExtraLine[] = [],
): Promise<{ invoiceId: string; paymentId: string; totalCents: number }> {
    const api = bookingApi();
    const headers = () => ({
        Origin: new URL(page.url()).origin,
        "Idempotency-Key": randomUUID(),
    });
    const drafted = await page.request.post(`${api}/v1/invoices/from-booking/${bookingId}`, {
        headers: headers(),
    });
    expect(drafted.status(), await drafted.text()).toBe(201);
    const draft = (await drafted.json()) as {
        id: string;
        lines: {
            description: string;
            unit_amount_cents: number;
            item_id: string | null;
            booking_id: string | null;
            staff_id: string | null;
        }[];
    };
    if (extra.length > 0) {
        const lines = [
            ...draft.lines.map((line) => ({
                description: line.description,
                unit_amount_cents: line.unit_amount_cents,
                item_id: line.item_id,
                booking_id: line.booking_id,
                staff_id: line.staff_id,
            })),
            ...extra,
        ];
        const edited = await page.request.patch(`${api}/v1/invoices/${draft.id}`, {
            headers: headers(),
            data: { lines },
        });
        expect(edited.status(), await edited.text()).toBe(200);
    }
    const sent = await page.request.post(`${api}/v1/invoices/${draft.id}/send`, {
        headers: headers(),
    });
    expect(sent.status(), await sent.text()).toBe(200);
    const { total_cents: totalCents } = (await sent.json()) as { total_cents: number };
    const paid = await page.request.post(`${api}/v1/invoices/${draft.id}/payments`, {
        headers: headers(),
        data: { method: "cash", amount_cents: totalCents },
    });
    expect(paid.status(), await paid.text()).toBe(201);
    const { payment_id: paymentId } = (await paid.json()) as { payment_id: string };
    return { invoiceId: draft.id, paymentId, totalCents };
}

/** Sets a member's pay from their Team panel, as the owner would. */
export async function setPayOnTeam(
    page: Page,
    name: string,
    pay: { type: "percent" | "fixed" | "hourly"; rate: string; retail?: string },
): Promise<string> {
    const s = strings.staff;
    await navigate(page, "/setup/team");
    await page
        .getByRole("main")
        .getByText(name, { exact: true })
        .first()
        .click({ timeout: 60_000 });
    const panel = page.getByRole("complementary", { name, exact: true });
    const payee = panel.getByRole("switch", { name: s.isPayee, exact: true });
    if (!(await payee.isChecked())) await payee.click();
    const type = panel.getByRole("combobox", { name: s.rateType, exact: true });
    await type.click();
    const label = { percent: s.ratePercent, fixed: s.rateFixed, hourly: s.rateHourly }[pay.type];
    await page.getByRole("option", { name: label, exact: true }).click();
    await panel.getByLabel(s.rateLabel(pay.type), { exact: true }).fill(pay.rate);
    if (pay.retail !== undefined)
        await panel.getByLabel(s.retailRate, { exact: true }).fill(pay.retail);
    const saving = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname.endsWith("/pay") &&
            response.request().method() === "PATCH",
    );
    await panel.getByRole("button", { name: s.team.savePay, exact: true }).click();
    const saved = await saving;
    expect(saved.status(), await saved.text()).toBe(200);
    const money = formatMoney(Number(pay.rate) * 100, "CAD");
    const service = {
        percent: s.payPercent(Number(pay.rate)),
        fixed: s.payFixed(money),
        hourly: s.payHourly(money),
    }[pay.type];
    const summary = await panel.getByText(service).first().innerText();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    return summary;
}

/** Picks the last day of work a pay covers in the Staff pay panel's calendar. */
export async function pickWorkThrough(
    page: Page,
    panel: Locator,
    day: string,
    zone: string,
): Promise<void> {
    await panel.getByLabel(strings.earnings.through, { exact: true }).click();
    const noon = combineDayAndTime(day, "12:00", zone);
    const cell = page.getByRole("gridcell", { name: formatFullDate(noon, zone), exact: true });
    if ((await cell.count()) === 0)
        await page.getByRole("button", { name: strings.ui.previousMonth, exact: true }).click();
    await cell.click();
}

export interface T4ARow {
    staff_id: string;
    name: string;
    fees_cents: number;
    tips_cents: number;
    total_cents: number;
}

/** The T4A CSV for the year, as the owner downloads it. */
export async function t4aRows(page: Page, year: number): Promise<T4ARow[]> {
    const res = await page.request.get(`${bookingApi()}/v1/reports/t4a.csv?year=${String(year)}`, {
        headers: { Origin: new URL(page.url()).origin },
    });
    expect(res.status(), await res.text()).toBe(200);
    const [, ...rows] = csvRows(await res.text());
    return rows.map((row) => {
        const [staffId = "", name = "", fees = "0", tips = "0", total = "0"] = row;
        return {
            staff_id: staffId,
            name,
            fees_cents: Number(fees),
            tips_cents: Number(tips),
            total_cents: Number(total),
        };
    });
}

/** Takes back an adjustment paid during a run, so the member's pay nets to nothing again. */
export async function takeBackAdjustment(
    page: Page,
    staffId: string,
    earningId: string,
    cents: number,
): Promise<void> {
    const api = bookingApi();
    const headers = () => ({
        Origin: new URL(page.url()).origin,
        "Idempotency-Key": randomUUID(),
    });
    const undone = await page.request.post(`${api}/v1/earnings/unpay`, {
        headers: headers(),
        data: { ids: [earningId] },
    });
    expect(undone.status(), await undone.text()).toBe(200);
    const offset = await page.request.post(`${api}/v1/earnings/adjustments`, {
        headers: headers(),
        data: { staff_id: staffId, amount_cents: -cents, reason: "Takes back an e2e adjustment" },
    });
    expect(offset.status(), await offset.text()).toBe(201);
    const { id } = (await offset.json()) as { id: string };
    const settled = await page.request.post(`${api}/v1/earnings/pay`, {
        headers: headers(),
        data: { ids: [earningId, id] },
    });
    expect(settled.status(), await settled.text()).toBe(200);
}
