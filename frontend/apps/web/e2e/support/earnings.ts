import { randomUUID } from "node:crypto";
import { addDays, combineDayAndTime } from "@clientbridge/app-core/public";
import { expect, type Page } from "@playwright/test";
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

export async function createStaffPaySale(
    page: Page,
    staffId: string,
    onBooking: (id: string) => void,
): Promise<{ bookingId: string; orderId: string; title: string }> {
    const api = bookingApi();
    const origin = new URL(page.url()).origin;
    const pay = await page.request.patch(`${api}/v1/staff/${staffId}/pay`, {
        headers: { Origin: origin },
        data: { payee: true, rate_type: "percent", rate_bps: 6000 },
    });
    expect(pay.status(), await pay.text()).toBe(200);
    const fixture = await createBookingFixture(page);
    const starts = combineDayAndTime(addDays(new Date(), 14, fixture.zone), "10:00", fixture.zone);
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
    const title = "Full coat care visit";
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
    expect(await settled.json()).toMatchObject({
        amount_cents: 10000,
        tip_cents: 0,
        change_cents: 0,
    });
    return { bookingId: booking.id, orderId: order.id, title };
}

export async function openStaffPay(page: Page, name: string) {
    await navigate(page, "/payments/staff-pay");
    await page
        .getByRole("button")
        .filter({ has: page.getByText(name, { exact: true }) })
        .click({ timeout: 60_000 });
    return page.getByRole("complementary", { name, exact: true });
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
