import { expect } from "@playwright/test";
import type { DepositEvidence, DepositFixture } from "./depositContract";

export type DepositStage =
    "collected" | "draft" | "applied" | "paid" | "deposit_refunded" | "cash_refunded";
export interface DepositRefs {
    depositPaymentId: string;
    invoiceId?: string;
    cashPaymentId?: string;
    fees: { processingCents: number; applicationCents: number };
}
type Entry = Omit<DepositEvidence["entries"][number], "subject_type" | "subject_id"> & {
    subject_type: string | null;
    subject_id: string | null;
};
type Observation = Omit<DepositEvidence, "entries"> & { entries: Entry[] };
type Leg = Pick<
    Entry,
    "owner_type" | "owner_id" | "category" | "code" | "amount_cents" | "subject_type" | "subject_id"
>;

export function expectDepositStage(
    e: Observation,
    f: DepositFixture,
    stage: DepositStage,
    refs: DepositRefs,
): void {
    const rank = [
        "collected",
        "draft",
        "applied",
        "paid",
        "deposit_refunded",
        "cash_refunded",
    ].indexOf(stage);
    const biz = e.businessId;
    const book = f.bookingId;
    const invoice = refs.invoiceId ?? "";
    const deposit = refs.depositPaymentId;
    const cash = refs.cashPaymentId ?? "";
    expect(f.amountCents).toBe(2000);
    expect(f.currency).toBe("CAD");
    expect(biz).not.toBe("");
    expect(e.booking).toMatchObject({
        id: book,
        client_id: f.clientId,
        business_id: biz,
        deposit_amount_cents: 2000,
        deposit_status: rank >= 4 ? "refunded" : rank >= 2 ? "applied" : "collected",
    });
    expect(e.payments).toHaveLength(rank >= 5 ? 4 : rank >= 4 ? 3 : rank >= 3 ? 2 : 1);
    const dp = e.payments.find((p) => p.id === deposit);
    expect(dp).toMatchObject({
        kind: "deposit",
        status: "succeeded",
        method: "card",
        provider: "stripe",
        currency: "CAD",
        client_id: f.clientId,
        booking_id: book,
        invoice_id: null,
        parent_payment_id: null,
        amount_cents: 2000,
        tip_cents: 0,
    });
    expect(dp?.provider_ref).toMatch(/^pi_/);
    expect(e).toMatchObject({
        owned_bookings: [{ id: book }],
        documents: rank === 0 ? [] : [{ id: invoice }],
    });
    expect(e.provider.intents).toEqual([
        expect.objectContaining({
            id: dp?.provider_ref,
            status: "succeeded",
            amount: 2000,
            currency: "cad",
            livemode: false,
            metadata: expect.objectContaining({ business_id: biz, booking_id: book }),
        }),
    ]);
    expect(e.provider.fees).toMatchObject(refs.fees);
    if (rank < 4) expect(e.provider.refunds).toEqual([]);

    if (rank === 0) {
        expect(e.invoice).toBeNull();
        expect(e.booking.invoice_id).toBeNull();
    } else {
        expect(invoice).not.toBe("");
        expect(e.booking.invoice_id).toBe(invoice);
        expect(e.invoice).toMatchObject({
            id: invoice,
            client_id: f.clientId,
            business_id: biz,
            status: rank === 1 ? "draft" : "sent",
            subtotal_cents: 10000,
            tax_total_cents: 1200,
            total_cents: 11200,
            currency: "CAD",
        });
    }
    if (rank >= 3)
        expect(e.payments.find((p) => p.id === cash)).toMatchObject({
            kind: "payment",
            status: "succeeded",
            method: "cash",
            provider: "manual",
            currency: "CAD",
            client_id: f.clientId,
            invoice_id: invoice,
            booking_id: null,
            parent_payment_id: null,
            amount_cents: 9200,
            tip_cents: 0,
            provider_ref: null,
        });
    const allowed = new Set<string>();
    const leg = (
        owner_type: string,
        owner_id: string,
        category: string,
        amount_cents: number,
        subject_type: string | null,
        subject_id: string | null,
        code = "",
    ): Leg => ({ owner_type, owner_id, category, code, amount_cents, subject_type, subject_id });
    const b = (category: string, cents: number, subject: "booking" | "invoice" | null, code = "") =>
        leg(
            "business",
            biz,
            category,
            cents,
            subject,
            subject === "booking" ? book : subject === "invoice" ? invoice : null,
            code,
        );
    const ar = (cents: number) =>
        leg("client", f.clientId, "receivable", cents, "invoice", invoice);
    const journal = (
        ref: string,
        event: string,
        source_type: string | null,
        source_id: string | null,
        legs: Leg[],
    ): string => {
        allowed.add(ref);
        const rows = e.entries.filter((x) => x.ref === ref);
        expect(new Set(rows.map((x) => x.journal_id)).size, ref).toBe(1);
        for (const row of rows) {
            expect(row).toMatchObject({
                event,
                source_type,
                source_id,
                business_id: biz,
                account_business_id: biz,
                entry_owner_type: row.owner_type,
                entry_owner_id: row.owner_id,
                currency: "CAD",
            });
        }
        const project = ({
            owner_type,
            owner_id,
            category,
            code,
            amount_cents,
            subject_type,
            subject_id,
        }: Entry | Leg) => ({
            owner_type,
            owner_id,
            category,
            code,
            amount_cents,
            subject_type,
            subject_id,
        });
        const ordered = (values: (Entry | Leg)[]) =>
            values.map(project).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        expect(ordered(rows), ref).toEqual(ordered(legs.filter((x) => x.amount_cents !== 0)));
        expect(
            rows.reduce((sum, x) => sum + x.amount_cents, 0),
            ref,
        ).toBe(0);
        return rows[0]?.journal_id ?? "";
    };
    journal(`payment:${deposit}`, "payment", "payment", deposit, [
        b("stripe", 2000, "booking"),
        b("deposit", -2000, "booking"),
    ]);
    const { processingCents: processing, applicationCents: application } = refs.fees;
    expect(Number.isInteger(processing) && processing >= 0).toBe(true);
    expect(Number.isInteger(application) && application >= 0).toBe(true);
    if (processing + application > 0)
        journal(`fee:${deposit}`, "fee", "payment", deposit, [
            b("processing_fee", processing, null),
            b("platform_fee", application, null),
            b("stripe", -processing - application, null),
            leg("platform", "clientbridge", "stripe", application, null, null),
            leg("platform", "clientbridge", "fee_revenue", -application, null, null),
        ]);
    let applicationJournal = "";
    if (rank >= 2) {
        journal(`invoice:${invoice}`, "invoice", null, null, [
            ar(11200),
            b("revenue", -10000, "invoice"),
            b("tax", -500, "invoice", "GST"),
            b("tax", -700, "invoice", "PST"),
        ]);
        applicationJournal = journal(`application:${book}:${invoice}`, "application", null, null, [
            b("deposit", 2000, "booking"),
            ar(-2000),
        ]);
    }
    if (rank >= 3)
        journal(`payment:${cash}`, "payment", "payment", cash, [
            b("cash", 9200, "invoice"),
            ar(-9200),
        ]);
    if (rank >= 4) {
        const refunds = e.payments.filter((p) => p.parent_payment_id === deposit);
        expect(refunds).toHaveLength(1);
        const refund = refunds[0];
        if (!refund) throw new Error("Deposit refund missing");
        expect(refund).toMatchObject({
            kind: "refund",
            status: "succeeded",
            provider: "stripe",
            method: "card",
            amount_cents: 2000,
            booking_id: book,
            invoice_id: null,
            client_id: f.clientId,
            tip_cents: 0,
            currency: "CAD",
        });
        expect(refund.provider_ref).toMatch(/^re_/);
        expect(e.provider.refunds).toEqual([
            {
                id: refund.provider_ref,
                payment_intent: dp?.provider_ref,
                status: "succeeded",
                amount: 2000,
                currency: "cad",
            },
        ]);

        journal(
            `application:${book}:${invoice}:reversal`,
            "reversal",
            "journal",
            applicationJournal,
            [b("deposit", -2000, "booking"), ar(2000)],
        );
        journal(`refund:${refund.id}`, "refund", "payment", refund.id, [
            b("stripe", -2000, "booking"),
            b("deposit", 2000, "booking"),
        ]);
    }
    if (rank >= 5) {
        const refunds = e.payments.filter((p) => p.parent_payment_id === cash);
        expect(refunds).toHaveLength(1);
        const refund = refunds[0];
        if (!refund) throw new Error("Cash refund missing");
        expect(refund).toMatchObject({
            kind: "refund",
            status: "succeeded",
            provider: "manual",
            method: "cash",
            amount_cents: 5600,
            invoice_id: invoice,
            booking_id: null,
            client_id: f.clientId,
            tip_cents: 0,
            currency: "CAD",
            provider_ref: null,
        });
        journal(`refund:${refund.id}`, "refund", "payment", refund.id, [
            b("cash", -5600, "invoice"),
            b("revenue", 5000, "invoice"),
            b("tax", 250, "invoice", "GST"),
            b("tax", 350, "invoice", "PST"),
        ]);
    }
    expect([...new Set(e.entries.map((x) => x.ref))].sort()).toEqual([...allowed].sort());
    const balance = (category: string, subject: string) =>
        e.entries
            .filter((x) => x.category === category && x.subject_id === subject)
            .reduce((sum, x) => sum + x.amount_cents, 0);
    expect(balance("deposit", book)).toBe(rank < 2 ? -2000 : 0);
    expect(balance("receivable", invoice)).toBe(
        rank < 2 ? 0 : rank === 2 ? 9200 : rank === 3 ? 0 : 2000,
    );
}
