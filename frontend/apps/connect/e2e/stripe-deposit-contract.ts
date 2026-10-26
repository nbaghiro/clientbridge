import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect } from "@playwright/test";

export interface DepositFixture {
    kind: "booking_deposit" | "enrolment_deposit";
    bookingId: string;
    clientId: string;
    account: string;
    amountCents: 2000;
    currency: "CAD";
}
interface DepositEntry {
    journal_id: string;
    ref: string;
    event: string;
    source_type: string | null;
    source_id: string | null;
    subject_type: string | null;
    subject_id: string | null;
    owner_type: string;
    owner_id: string;
    category: string;
    code: string;
    amount_cents: number;
}
export interface DepositEvidence {
    businessId: string;
    owned_bookings: { id: string }[];
    documents: { id: string }[];
    booking: { id: string; invoice_id: string | null; deposit_status: string };
    invoice: {
        id: string;
        status: string;
        subtotal_cents: number;
        tax_total_cents: number;
        total_cents: number;
    } | null;
    payments: {
        id: string;
        kind: string;
        status: string;
        method: string;
        invoice_id: string | null;
        booking_id: string | null;
        parent_payment_id: string | null;
        amount_cents: number;
        provider_ref: string | null;
        provider: string;
        currency: string;
        tip_cents: number;
        client_id: string;
    }[];
    entries: DepositEntry[];
    provider: {
        fees: { processingCents: number; applicationCents: number } | null;
        intents: {
            id: string;
            status: string;
            amount: number;
            currency: string;
            livemode: boolean;
            metadata: { business_id: string; booking_id: string };
        }[];
        refunds: {
            id: string;
            payment_intent: string;
            status: string;
            amount: number;
            currency: string;
        }[];
    };
}

const execute = promisify(execFile);
async function invoke<T>(module: string, args: string[]): Promise<T> {
    const { stdout } = await execute("uv", ["run", "python", "-m", module, ...args], {
        cwd: fileURLToPath(new URL("../../../../backend", import.meta.url)),
        timeout: 90_000,
    });
    return JSON.parse(stdout) as T;
}
export async function registerStripeDeposit(input: {
    bookingId: string;
    clientId: string;
    amountCents: 2000;
    currency: "CAD";
}): Promise<DepositFixture> {
    const fixture = await invoke<DepositFixture>("scripts.e2e_stripe_deposits", [
        "register",
        input.bookingId,
    ]);
    expect(fixture).toMatchObject({ ...input, kind: "booking_deposit" });
    expect(fixture.account).toMatch(/^acct_/);
    return fixture;
}
export async function registerEnrolmentClient(clientId: string): Promise<void> {
    const fixture = await invoke<Omit<DepositFixture, "bookingId"> & { bookingId: null }>(
        "scripts.e2e_stripe_deposits",
        ["register-client", clientId],
    );
    expect(fixture).toMatchObject({ kind: "enrolment_deposit", clientId, bookingId: null });
}
export async function bindEnrolment(clientId: string, bookingId: string): Promise<DepositFixture> {
    const fixture = await invoke<DepositFixture>("scripts.e2e_stripe_deposits", [
        "bind",
        clientId,
        bookingId,
    ]);
    expect(fixture).toMatchObject({
        kind: "enrolment_deposit",
        clientId,
        bookingId,
        amountCents: 2000,
        currency: "CAD",
    });
    return fixture;
}
export async function linkStripeDepositInvoice(
    fixture: DepositFixture,
    invoiceId: string,
): Promise<void> {
    await invoke<unknown>("scripts.e2e_stripe_deposits", ["link", fixture.bookingId, invoiceId]);
    const evidence = await depositEvidence(fixture);
    expect(evidence.booking.invoice_id).toBe(invoiceId);
    expect(evidence.invoice?.id).toBe(invoiceId);
}
export async function depositEvidence(fixture: DepositFixture): Promise<DepositEvidence> {
    const result = await invoke<DepositEvidence>("scripts.e2e_deposits_evidence", [
        fixture.bookingId,
    ]);
    expect(result.booking.id).toBe(fixture.bookingId);
    return result;
}
