import { randomUUID } from "node:crypto";
import { addDays, combineDayAndTime, strings } from "@clientbridge/app-core/public";
import { expect, type Locator, type Page } from "@playwright/test";
import { bookingApi, createBookingFixture } from "./bookings";
import { select } from "./db";
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
