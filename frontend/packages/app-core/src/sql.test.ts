import { AppSchema } from "@clientbridge/sync";
import initSqlJs, { type Database, type SqlValue } from "sql.js";
import { beforeAll, describe, expect, it } from "vitest";

import { clientValueSql, collectedSql, ownedLiabilitySql, subjectNetSql } from "./domain/ledger";
import * as core from "./index";

type Row = Record<string, SqlValue>;

const BIZ = "bz_1";
const TS = "2026-06-26T09:00:00Z";

let db: Database;

function insert(table: string, rows: Row[]): void {
    for (const row of rows) {
        const cols = Object.keys(row);
        db.run(
            `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
            cols.map((c) => row[c] ?? null),
        );
    }
}

function scoped(table: string, rows: Row[]): void {
    insert(
        table,
        rows.map((r) => ({ business_id: BIZ, created_at: TS, ...r })),
    );
}

function all(sql: string, params: SqlValue[] = []): Row[] {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const out: Row[] = [];
    while (stmt.step()) out.push(stmt.getAsObject());
    stmt.free();
    return out;
}

function value(expr: string): SqlValue {
    return all(`SELECT ${expr} AS v`)[0]?.v ?? null;
}

function pick(rows: Row[], ...keys: string[]): Row[] {
    return rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null])));
}

let leg = 0;

/** One ledger journal: each leg is [account id, amount], booked against an optional subject. */
function journal(
    id: string,
    event: string,
    ref: string,
    legs: [string, number][],
    extra: Row = {},
): void {
    for (const [account, amount] of legs) {
        const owner = all("SELECT owner_type, owner_id FROM accounts WHERE id = ?", [account])[0];
        leg += 1;
        insert("entries", [
            {
                id: `en_${String(leg)}`,
                business_id: BIZ,
                journal_id: id,
                account_id: account,
                owner_type: owner?.owner_type ?? null,
                owner_id: owner?.owner_id ?? null,
                amount_cents: amount,
                currency: "CAD",
                event,
                ref,
                leg,
                meta: "{}",
                occurred_at: TS,
                created_at: TS,
                ...extra,
            },
        ]);
    }
}

function seed(): void {
    insert("businesses", [
        {
            id: BIZ,
            name: "Birch Studio",
            timezone: "America/Vancouver",
            locale: "en",
            billing_email: "billing@birch.test",
            gst_hst_number: "123456789RT0001",
            qst_number: null,
            brand: "{}",
            stripe_account_id: "acct_1",
            stripe_terminal_location_id: "tml_1",
            tax_registered: 1,
            status: "active",
        },
    ]);
    scoped("staff", [
        {
            id: "st_owner",
            user_id: "us_owner",
            role: "owner",
            status: "active",
            title: "Owner",
            payee: 1,
            rate_type: "percent",
            rate_bps: 4000,
            retail_rate_bps: 1000,
        },
        {
            id: "st_amy",
            user_id: "us_amy",
            role: "staff",
            status: "active",
            title: "Groomer",
            payee: 1,
            rate_type: "hourly",
            rate_cents: 2250,
        },
        { id: "st_new", role: "staff", status: "invited", invite_email: "new@birch.test" },
    ]);
    scoped("clients", [
        { id: "cl_ann", name: "Ann", email: "ann@x.test", phone: "+16045550001", status: "active" },
        { id: "cl_ben", name: "ben", status: "active" },
    ]);
    scoped("items", [
        {
            id: "it_cut",
            kind: "service",
            name: "Cut",
            price_cents: 10000,
            active: 1,
            color: "#123",
        },
        {
            id: "it_soap",
            kind: "product",
            name: "Soap",
            price_cents: 2400,
            active: 1,
            track_stock: 1,
            stock_on_hand: 3,
        },
        { id: "it_pkg", kind: "package", name: "Five Cuts", price_cents: 45000, active: 1 },
        { id: "it_plan", kind: "subscription", name: "Plan", price_cents: 5000, active: 1 },
        { id: "it_old", kind: "service", name: "Archived", price_cents: 100, active: 0 },
    ]);
    scoped("files", [
        { id: "fl_old", parent_type: "item", parent_id: "it_cut", purpose: "image" },
        {
            id: "fl_new",
            parent_type: "item",
            parent_id: "it_cut",
            purpose: "image",
            created_at: "2026-06-27T00:00:00Z",
        },
    ]);
    scoped("slots", [
        {
            id: "ss_1",
            item_id: "it_cut",
            staff_id: "st_owner",
            starts_at: "2026-06-26 10:00:00+00",
            ends_at: "2026-06-26 11:00:00+00",
            capacity: 1,
            status: "scheduled",
        },
        {
            id: "ss_2",
            item_id: "it_cut",
            staff_id: "st_owner",
            starts_at: "2026-06-26T12:00:00Z",
            ends_at: "2026-06-26T13:00:00Z",
            capacity: 1,
            status: "canceled",
        },
        {
            id: "ss_3",
            item_id: "it_cut",
            staff_id: "st_amy",
            starts_at: "2026-06-27T09:00:00Z",
            ends_at: "2026-06-27T10:00:00Z",
            capacity: 4,
            status: "scheduled",
        },
        {
            id: "ss_4",
            item_id: "it_cut",
            staff_id: "st_owner",
            starts_at: "2026-07-10T09:00:00Z",
            ends_at: "2026-07-10T10:00:00Z",
            capacity: 1,
            status: "scheduled",
        },
    ]);
    scoped("bookings", [
        {
            id: "bk_1",
            slot_id: "ss_1",
            staff_id: "st_owner",
            client_id: "cl_ann",
            invoice_id: "inv_1",
            status: "completed",
            source: "online",
            price_cents: 10000,
            deposit_amount_cents: 2750,
            deposit_status: "collected",
        },
        {
            id: "bk_4",
            slot_id: "ss_4",
            staff_id: "st_owner",
            client_id: "cl_ben",
            status: "confirmed",
            source: "manual",
            price_cents: 10000,
            deposit_amount_cents: 0,
            deposit_status: "none",
        },
    ]);
    scoped("addons", [
        {
            id: "ba_1",
            booking_id: "bk_1",
            item_id: "it_soap",
            description: "Soap",
            quantity: 1,
            unit_amount_cents: 2400,
        },
    ]);
    scoped("invoices", [
        {
            id: "inv_1",
            client_id: "cl_ann",
            number: 7,
            status: "sent",
            currency: "CAD",
            subtotal_cents: 10000,
            tax_total_cents: 1200,
            total_cents: 11200,
            issued_at: "2026-06-26T12:00:00Z",
            pay_token: "tok_1",
        },
        {
            id: "inv_2",
            client_id: "cl_ben",
            number: null,
            status: "draft",
            currency: "CAD",
            subtotal_cents: 5000,
            tax_total_cents: 0,
            total_cents: 5000,
            created_at: "2026-06-20T09:00:00Z",
        },
        {
            id: "inv_3",
            client_id: "cl_ben",
            number: 6,
            status: "sent",
            currency: "CAD",
            subtotal_cents: 2000,
            tax_total_cents: 0,
            total_cents: 2000,
            issued_at: "2026-06-21T09:00:00Z",
        },
    ]);
    scoped("estimates", [
        {
            id: "est_1",
            client_id: "cl_ben",
            number: 3,
            status: "accepted",
            subtotal_cents: 8000,
            tax_total_cents: 960,
            total_cents: 8960,
            valid_until: "2026-07-31",
        },
    ]);
    scoped("orders", [
        {
            id: "ord_open",
            client_id: "cl_ann",
            staff_id: "st_owner",
            status: "open",
            currency: "CAD",
            subtotal_cents: 3000,
            tax_total_cents: 0,
            total_cents: 3000,
            source: "pos",
        },
        {
            id: "ord_web",
            client_id: "cl_ben",
            staff_id: "st_owner",
            status: "open",
            currency: "CAD",
            subtotal_cents: 4800,
            tax_total_cents: 0,
            total_cents: 4800,
            source: "online",
            pickup_status: "ready",
        },
        {
            id: "ord_gone",
            client_id: "cl_ben",
            staff_id: "st_owner",
            status: "open",
            currency: "CAD",
            subtotal_cents: 100,
            tax_total_cents: 0,
            total_cents: 100,
            source: "online",
            pickup_status: "picked_up",
        },
    ]);
    scoped("lines", [
        {
            id: "ln_1",
            invoice_id: "inv_1",
            description: "Cut",
            item_id: "it_cut",
            booking_id: "bk_1",
            quantity: 1,
            unit_amount_cents: 10000,
            amount_cents: 10000,
            tax_amount_cents: 1200,
            position: 0,
        },
        {
            id: "ln_2",
            estimate_id: "est_1",
            description: "Quote",
            quantity: 2,
            unit_amount_cents: 4000,
            amount_cents: 8000,
            tax_amount_cents: 960,
            position: 0,
        },
        {
            id: "ln_3",
            order_id: "ord_web",
            description: "Soap",
            item_id: "it_soap",
            quantity: 2,
            unit_amount_cents: 2400,
            amount_cents: 4800,
            tax_amount_cents: 0,
            position: 0,
        },
    ]);
    scoped("payments", [
        {
            id: "pay_1",
            client_id: "cl_ann",
            kind: "payment",
            invoice_id: "inv_1",
            amount_cents: 5000,
            currency: "CAD",
            method: "card",
            provider: "stripe",
            status: "succeeded",
            paid_at: "2026-06-26T13:00:00Z",
        },
        {
            id: "pay_r1",
            client_id: "cl_ann",
            kind: "refund",
            parent_payment_id: "pay_1",
            invoice_id: "inv_1",
            amount_cents: 1000,
            currency: "CAD",
            method: "card",
            provider: "stripe",
            status: "succeeded",
            paid_at: "2026-06-26T14:00:00Z",
        },
        {
            id: "pay_dep",
            client_id: "cl_ann",
            kind: "deposit",
            booking_id: "bk_1",
            amount_cents: 2750,
            currency: "CAD",
            method: "card",
            provider: "stripe",
            status: "succeeded",
            paid_at: "2026-06-25T09:00:00Z",
        },
        {
            id: "pay_3",
            client_id: "cl_ben",
            kind: "payment",
            invoice_id: "inv_3",
            amount_cents: 2000,
            currency: "CAD",
            method: "interac",
            provider: "interac",
            status: "succeeded",
            paid_at: "2026-06-21T10:00:00Z",
        },
        {
            id: "pay_web",
            client_id: "cl_ben",
            kind: "payment",
            order_id: "ord_web",
            amount_cents: 4800,
            currency: "CAD",
            method: "card",
            provider: "stripe",
            status: "succeeded",
            paid_at: "2026-06-24T09:00:00Z",
        },
        {
            id: "pay_wait",
            client_id: "cl_ann",
            kind: "payment",
            invoice_id: "inv_1",
            amount_cents: 6200,
            currency: "CAD",
            method: "card",
            provider: "stripe",
            status: "pending",
        },
    ]);
    scoped("payment_methods", [
        {
            id: "pm_old",
            client_id: "cl_ann",
            method: "card",
            brand: "Visa",
            last4: "4242",
            preferred: 0,
            mandate_status: "none",
            status: "active",
        },
        {
            id: "pm_main",
            client_id: "cl_ann",
            method: "card",
            brand: "Visa",
            last4: "1111",
            preferred: 1,
            mandate_status: "none",
            status: "active",
            created_at: "2026-06-27T00:00:00Z",
        },
        {
            id: "pm_gone",
            client_id: "cl_ann",
            method: "card",
            preferred: 0,
            mandate_status: "none",
            status: "detached",
        },
    ]);
    scoped("packages", [
        {
            id: "pk_1",
            client_id: "cl_ann",
            item_id: "it_pkg",
            sessions_total: 5,
            status: "active",
        },
    ]);
    scoped("gift_cards", [
        { id: "gc_1", code: "GIFTAAAA", initial_cents: 5000, status: "active", recipient: "a@x" },
        {
            id: "gc_2",
            code: "GIFTBBBB",
            initial_cents: 1000,
            status: "active",
            created_at: "2026-06-20T09:00:00Z",
        },
    ]);
    scoped("subscriptions", [
        {
            id: "sub_1",
            client_id: "cl_ann",
            item_id: "it_plan",
            status: "active",
            current_period_start: "2026-06-01T00:00:00Z",
            current_period_end: "2026-07-01T00:00:00Z",
            payment_method_id: "pm_main",
        },
    ]);
    scoped("threads", [
        {
            id: "th_1",
            client_id: "cl_ann",
            channel: "sms",
            status: "open",
        },
        {
            id: "th_2",
            client_id: "cl_ben",
            channel: "email",
            status: "open",
        },
    ]);
    scoped("messages", [
        {
            id: "m_1",
            thread_id: "th_1",
            direction: "out",
            channel: "sms",
            body: "Hi Ann",
            status: "sent",
            created_at: "2026-06-26T10:00:00Z",
        },
        {
            id: "m_2",
            thread_id: "th_1",
            direction: "in",
            channel: "sms",
            body: "Hello",
            status: "received",
            created_at: "2026-06-26T10:30:00Z",
        },
        {
            id: "m_3",
            thread_id: "th_1",
            direction: "in",
            channel: "sms",
            body: "See you soon",
            status: "received",
            created_at: "2026-06-26T11:00:00Z",
        },
        {
            id: "m_4",
            thread_id: "th_2",
            direction: "out",
            channel: "email",
            body: "Receipt",
            status: "sent",
            created_at: "2026-06-25T11:00:00Z",
        },
    ]);
    scoped("reviews", [
        {
            id: "rv_1",
            client_id: "cl_ann",
            booking_id: "bk_1",
            rating: 5,
            body: "Great",
            sent_to_google: 0,
            status: "published",
        },
        { id: "rv_asked", client_id: "cl_ann", sent_to_google: 0, status: "requested" },
        { id: "rv_seen", client_id: "cl_ann", sent_to_google: 0, status: "opened" },
    ]);
    scoped("forms", [
        { id: "frm_b", name: "beta", require_signature: 0, active: 1 },
        { id: "frm_a", name: "Alpha", require_signature: 1, active: 1 },
        { id: "frm_z", name: "Zeta", require_signature: 0, active: 0 },
    ]);
    scoped("fields", [
        { id: "ff_2", form_id: "frm_a", input: "text", name: "b", label: "B", position: 1 },
        { id: "ff_1", form_id: "frm_a", input: "rating", name: "a", label: "A", position: 0 },
    ]);
    scoped("contracts", [
        { id: "con_1", name: "Waiver", body: "I agree", version: 2, always_require: 1, active: 1 },
    ]);
    scoped("hours", [
        {
            id: "av_1",
            staff_id: "st_amy",
            basis: "recurring",
            weekday: 1,
            start_time: "09:00:00",
            end_time: "17:00:00",
            available: 1,
        },
        { id: "av_2", staff_id: "st_amy", basis: "date", date: "2026-07-01", available: 0 },
    ]);

    const account = (id: string, ownerType: string, ownerId: string, category: string, code = "") =>
        ({ id, owner_type: ownerType, owner_id: ownerId, category, code, currency: "CAD" }) as Row;
    scoped("accounts", [
        account("a_recv", "client", "cl_ann", "receivable"),
        account("a_recv_ben", "client", "cl_ben", "receivable"),
        account("a_rev", "business", BIZ, "revenue"),
        account("a_gst", "business", BIZ, "tax", "GST"),
        account("a_pst", "business", BIZ, "tax", "PST"),
        account("a_stripe", "business", BIZ, "stripe"),
        account("a_bank", "business", BIZ, "bank"),
        account("a_deposit", "business", BIZ, "deposit"),
        account("a_cost", "business", BIZ, "staff_cost"),
        account("a_pay_owner", "staff", "st_owner", "payable", "pending"),
        account("a_pay_amy", "staff", "st_amy", "payable", "pending"),
        { ...account("a_gc1", "gift_card", "gc_1", "gift_card"), balance_cents: -3000 },
        { ...account("a_gc2", "gift_card", "gc_2", "gift_card"), balance_cents: 0 },
        account("a_pkg", "package", "pk_1", "deferred"),
    ]);
    const on = (type: string, id: string, source?: string): Row => ({
        subject_type: type,
        subject_id: id,
        ...(source ? { source_type: "payment", source_id: source } : {}),
    });
    journal(
        "j_inv1",
        "invoice",
        "invoice:inv_1",
        [
            ["a_recv", 11200],
            ["a_rev", -10000],
            ["a_gst", -500],
            ["a_pst", -700],
        ],
        on("invoice", "inv_1"),
    );
    journal(
        "j_pay1",
        "payment",
        "payment:pay_1",
        [
            ["a_stripe", 5000],
            ["a_recv", -5000],
        ],
        on("invoice", "inv_1", "pay_1"),
    );
    journal(
        "j_ref1",
        "refund",
        "refund:pay_r1",
        [
            ["a_stripe", -1000],
            ["a_rev", 1000],
        ],
        on("invoice", "inv_1", "pay_r1"),
    );
    journal(
        "j_dep",
        "payment",
        "payment:pay_dep",
        [
            ["a_stripe", 2750],
            ["a_deposit", -2750],
        ],
        on("booking", "bk_1", "pay_dep"),
    );
    journal(
        "j_inv3",
        "invoice",
        "invoice:inv_3",
        [
            ["a_recv_ben", 2000],
            ["a_rev", -2000],
        ],
        on("invoice", "inv_3"),
    );
    journal(
        "j_pay3",
        "payment",
        "payment:pay_3",
        [
            ["a_bank", 2000],
            ["a_recv_ben", -2000],
        ],
        on("invoice", "inv_3", "pay_3"),
    );
    journal(
        "j_gone",
        "payment",
        "payment:pay_gone",
        [
            ["a_stripe", 100],
            ["a_rev", -100],
        ],
        on("order", "ord_gone", "pay_gone"),
    );
    journal(
        "j_web",
        "payment",
        "payment:pay_web",
        [
            ["a_stripe", 4800],
            ["a_rev", -4800],
        ],
        on("order", "ord_web", "pay_web"),
    );
    for (const [n, used] of [
        ["1", 1],
        ["2", 2],
    ] as const) {
        journal(
            `j_use${n}`,
            "consumption",
            `consumption:pk_1:${String(used)}`,
            [
                ["a_pkg", 9000],
                ["a_rev", -9000],
            ],
            on("package", "pk_1"),
        );
    }
    const earning = (id: string, payee: string, amount: number, subject: Row) => {
        journal(
            id,
            "earning",
            `earning:${id}`,
            [
                ["a_cost", amount],
                [payee, -amount],
            ],
            subject,
        );
    };
    earning("j_e_pending", "a_pay_amy", 900, on("order", "ord_web"));
    earning("j_e_approved", "a_pay_owner", 4000, on("booking", "bk_1"));
    earning("j_e_paid", "a_pay_owner", 1500, on("booking", "bk_4"));
    earning("j_e_reversed", "a_pay_amy", 700, on("booking", "bk_4"));
    journal("j_appr1", "approval", "approval:j_e_approved", [["a_pay_owner", 0]]);
    journal("j_appr2", "approval", "approval:j_e_paid", [["a_pay_owner", 0]]);
    journal("j_staffpay", "staff_payment", "staff_payment:j_e_paid", [["a_bank", -1500]]);
    journal("j_rev", "reversal", "earning:j_e_reversed:reversal", [
        ["a_cost", -700],
        ["a_pay_amy", 700],
    ]);
    journal(
        "j_po1",
        "payout",
        "payout:po_1",
        [
            ["a_bank", 40000],
            ["a_stripe", -40000],
        ],
        { occurred_at: "2026-06-24T00:00:00Z", available_at: "2026-06-25T00:00:00Z" },
    );
    journal(
        "j_po2",
        "payout",
        "payout:po_2",
        [
            ["a_bank", 9000],
            ["a_stripe", -9000],
        ],
        { occurred_at: "2026-06-25T00:00:00Z" },
    );
    journal(
        "j_po2f",
        "reversal",
        "payout:po_2:failed",
        [
            ["a_bank", -9000],
            ["a_stripe", 9000],
        ],
        {
            occurred_at: "2026-06-25T01:00:00Z",
        },
    );
    journal("j_remit", "remittance", "remittance:2026-01-01:2026-03-31", [["a_bank", -1200]], {
        meta: JSON.stringify({ start: "2026-01-01", end: "2026-03-31" }),
    });
}

beforeAll(async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    for (const table of AppSchema.tables) {
        const cols = table.columns.map((c) => `"${c.name}" ${c.type ?? "TEXT"}`).join(", ");
        db.run(`CREATE TABLE ${table.name} (id TEXT PRIMARY KEY, ${cols})`);
    }
    seed();
});

const SQL_COVERED = new Set<string>();

function run(name: keyof typeof core, params: SqlValue[] = []): Row[] {
    const sql = core[name];
    expect(typeof sql).toBe("string");
    SQL_COVERED.add(name);
    return all(sql as string, params);
}

describe("app-core SQL against the replica schema", () => {
    it("lists invoices with their ledger balance and status", () => {
        expect(pick(run("INVOICES_SQL"), "id", "client_name", "status", "balance_cents")).toEqual([
            { id: "inv_1", client_name: "Ann", status: "partial", balance_cents: 6200 },
            { id: "inv_3", client_name: "ben", status: "paid", balance_cents: 0 },
            { id: "inv_2", client_name: "ben", status: "draft", balance_cents: 5000 },
        ]);
    });

    it("reads amount paid, client value and balances through the ledger builders", () => {
        expect(value(collectedSql("invoice", "'inv_1'"))).toBe(4000);
        expect(value(collectedSql("invoice", "'inv_2'"))).toBe(0);
        expect(value(collectedSql("order", "'ord_web'"))).toBe(4800);
        expect(value(subjectNetSql("receivable", "invoice", "'inv_1'"))).toBe(6200);
        expect(value(subjectNetSql("deposit", "booking", "'bk_1'"))).toBe(-2750);
        expect(value(clientValueSql("'cl_ann'"))).toBe(6750);
        expect(value(clientValueSql("'cl_ben'"))).toBe(6800);
        expect(value(ownedLiabilitySql("gift_card", "gift_card", "'gc_1'"))).toBe(3000);
        expect(value(ownedLiabilitySql("gift_card", "gift_card", "'gc_none'"))).toBe(0);
    });

    it("lists estimates, document lines and per-code tax", () => {
        expect(pick(run("ESTIMATES_SQL"), "id", "client_name", "status")).toEqual([
            { id: "est_1", client_name: "ben", status: "accepted" },
        ]);
        expect(run("LINES_SQL", ["inv_1"]).map((r) => r.id)).toEqual(["ln_1"]);
        expect(run("LINES_SQL", ["est_1"]).map((r) => r.id)).toEqual(["ln_2"]);
        expect(run("TAX_BY_CODE_SQL", ["invoice:inv_1"])).toEqual([
            { code: "GST", cents: 500 },
            { code: "PST", cents: 700 },
        ]);
    });

    it("lists clients by name with their lifetime value", () => {
        expect(pick(run("CLIENTS_SQL"), "id", "lifetime_value_cents")).toEqual([
            { id: "cl_ann", lifetime_value_cents: 6750 },
            { id: "cl_ben", lifetime_value_cents: 6800 },
        ]);
    });

    it("shows calendar events in range with their deposit state", () => {
        const range = ["2026-06-28T00:00:00.000Z", "2026-06-26T00:00:00.000Z"];
        const events = run("EVENTS_SQL", range);
        expect(
            pick(
                events,
                "slot_id",
                "booking_id",
                "booked_count",
                "deposit_required",
                "deposit_status",
                "client_name",
            ),
        ).toEqual([
            {
                slot_id: "ss_1",
                booking_id: "bk_1",
                booked_count: 1,
                deposit_required: 1,
                deposit_status: "collected",
                client_name: "Ann",
            },
            {
                slot_id: "ss_3",
                booking_id: null,
                booked_count: 0,
                deposit_required: null,
                deposit_status: null,
                client_name: null,
            },
        ]);
        const amy = run("EVENTS_BY_STAFF_SQL", [...range, "st_amy"]);
        expect(amy.map((r) => r.slot_id)).toEqual(["ss_3"]);
        expect(run("ADDONS_SQL", ["bk_1"]).map((r) => r.id)).toEqual(["ba_1"]);
        expect(run("BOOKING_INVOICE_SQL", ["bk_1"])).toEqual([{ invoice_id: "inv_1" }]);
    });

    it("derives each earning's status from its journals", () => {
        expect(
            pick(run("ALL_EARNINGS_SQL"), "id", "status", "amount_cents", "staff_title"),
        ).toEqual([
            { id: "j_e_pending", status: "pending", amount_cents: 900, staff_title: "Groomer" },
            { id: "j_e_approved", status: "approved", amount_cents: 4000, staff_title: "Owner" },
            { id: "j_e_paid", status: "paid", amount_cents: 1500, staff_title: "Owner" },
            { id: "j_e_reversed", status: "reversed", amount_cents: 700, staff_title: "Groomer" },
        ]);
    });

    it("feeds the dashboard activity and payouts", () => {
        expect(pick(run("RECENT_ACTIVITY_SQL"), "id", "kind", "client_name")).toEqual([
            { id: "pay_r1", kind: "refund", client_name: "Ann" },
            { id: "pay_1", kind: "payment", client_name: "Ann" },
            { id: "pay_dep", kind: "deposit", client_name: "Ann" },
            { id: "pay_web", kind: "payment", client_name: "ben" },
            { id: "pay_3", kind: "payment", client_name: "ben" },
        ]);
        expect(pick(run("BANK_DEPOSITS_SQL"), "id", "amount_cents", "status")).toEqual([
            { id: "j_po2", amount_cents: 9000, status: "failed" },
            { id: "j_po1", amount_cents: 40000, status: "paid" },
        ]);
    });

    it("lists threads with unread counts and their messages", () => {
        expect(pick(run("THREADS_SQL"), "id", "unread_count", "last_body", "client_name")).toEqual([
            { id: "th_1", unread_count: 2, last_body: "See you soon", client_name: "Ann" },
            { id: "th_2", unread_count: 0, last_body: "Receipt", client_name: "ben" },
        ]);
        expect(run("THREAD_MESSAGES_SQL", ["th_1"]).map((r) => r.id)).toEqual([
            "m_1",
            "m_2",
            "m_3",
        ]);
    });

    it("shows a client's package, subscription, saved cards and invoice payments", () => {
        expect(
            pick(run("CLIENT_PACKAGES_SQL", ["cl_ann"]), "id", "sessions_used", "item_name"),
        ).toEqual([{ id: "pk_1", sessions_used: 2, item_name: "Five Cuts" }]);
        expect(pick(run("CLIENT_SUBSCRIPTIONS_SQL", ["cl_ann"]), "id", "item_name")).toEqual([
            { id: "sub_1", item_name: "Plan" },
        ]);
        expect(run("SAVED_CARDS_SQL", ["cl_ann"]).map((r) => r.id)).toEqual(["pm_main", "pm_old"]);
        expect(pick(run("INVOICE_PAYMENTS_SQL", ["inv_1"]), "id", "kind", "status")).toEqual([
            { id: "pay_1", kind: "payment", status: "succeeded" },
            { id: "pay_r1", kind: "refund", status: "succeeded" },
            { id: "pay_wait", kind: "payment", status: "pending" },
        ]);
    });

    it("shows gift card balances and status", () => {
        expect(pick(run("GIFT_CARDS_SQL"), "id", "balance_cents", "status")).toEqual([
            { id: "gc_1", balance_cents: 3000, status: "active" },
            { id: "gc_2", balance_cents: 0, status: "redeemed" },
        ]);
    });

    it("lists open and online orders", () => {
        expect(pick(run("OPEN_ORDERS_SQL"), "id", "client_name", "balance_cents")).toEqual([
            { id: "ord_open", client_name: "Ann", balance_cents: 3000 },
        ]);
        expect(pick(run("ONLINE_ORDERS_SQL"), "id", "pickup_status", "summary")).toEqual([
            { id: "ord_web", pickup_status: "ready", summary: "2 × Soap" },
        ]);
    });

    it("lists filed remittances and reviews", () => {
        expect(run("REMITTANCES_SQL")).toEqual([
            {
                id: "j_remit",
                period_start: "2026-01-01",
                period_end: "2026-03-31",
                total_cents: 1200,
            },
        ]);
        expect(pick(run("REVIEWS_SQL"), "id", "rating", "client_name")).toEqual([
            { id: "rv_1", rating: 5, client_name: "Ann" },
        ]);
        expect(run("AWAITING_REVIEWS_SQL")).toEqual([{ n: 2 }]);
    });

    it("reads the team, the viewer and staff pay", () => {
        expect(run("STAFF_SQL").map((r) => r.id)).toEqual(["st_owner", "st_amy"]);
        expect(run("PENDING_INVITES_SQL").map((r) => r.id)).toEqual(["st_new"]);
        expect(run("CURRENT_VIEWER_SQL", ["us_amy"])).toEqual([{ id: "st_amy", role: "staff" }]);
        expect(
            pick(run("STAFF_PAY_SQL"), "id", "payee", "rate_type", "rate_bps", "rate_cents"),
        ).toEqual([
            { id: "st_owner", payee: 1, rate_type: "percent", rate_bps: 4000, rate_cents: null },
            { id: "st_amy", payee: 1, rate_type: "hourly", rate_bps: null, rate_cents: 2250 },
        ]);
    });

    it("reads the business row", () => {
        expect(run("BUSINESS_ID_SQL")).toEqual([{ id: BIZ }]);
        expect(pick(run("ACCOUNT_SQL"), "id", "name", "billing_email")).toEqual([
            { id: BIZ, name: "Birch Studio", billing_email: "billing@birch.test" },
        ]);
        expect(run("STRIPE_ACCOUNT_SQL")).toEqual([{ stripe_account_id: "acct_1" }]);
        expect(run("TERMINAL_LOCATION_SQL")).toEqual([{ stripe_terminal_location_id: "tml_1" }]);
    });

    it("lists the catalog with each item's newest image", () => {
        const items = pick(run("ITEMS_SQL"), "id", "image_file_id", "stock_on_hand");
        expect(items.map((r) => r.id)).toEqual([
            "it_cut",
            "it_pkg",
            "it_plan",
            "it_soap",
            "it_old",
        ]);
        expect(items[0]).toEqual({ id: "it_cut", image_file_id: "fl_new", stock_on_hand: null });
        expect(items[3]).toEqual({ id: "it_soap", image_file_id: null, stock_on_hand: 3 });
    });

    it("reads and writes forms, contracts and weekly hours", () => {
        expect(run("FORMS_SQL").map((r) => r.id)).toEqual(["frm_a", "frm_b", "frm_z"]);
        expect(run("FORM_FIELDS_SQL", ["frm_a"]).map((r) => r.id)).toEqual(["ff_1", "ff_2"]);
        expect(run("CONTRACTS_SQL")).toEqual([
            { id: "con_1", name: "Waiver", version: 2, always_require: 1, active: 1 },
        ]);
        expect(run("RECURRING_HOURS_SQL", ["st_amy"])).toEqual([
            { weekday: 1, start_time: "09:00:00", end_time: "17:00:00", available: 1 },
        ]);

        run("INSERT_FORM_SQL", ["frm_new", BIZ, "Intake", "[]", 0, 1]);
        run("INSERT_FORM_FIELD_SQL", [
            "ff_new",
            BIZ,
            "frm_new",
            "text",
            "pet",
            "Pet",
            1,
            "[]",
            "{}",
            0,
        ]);
        run("INSERT_CONTRACT_SQL", ["con_new", BIZ, "Policy", "Terms", 1, 0, 1]);
        run("CLEAR_RECURRING_HOURS_SQL", ["st_amy"]);
        run("INSERT_RECURRING_HOURS_SQL", ["av_new", BIZ, "st_amy", 2, "10:00:00", "14:00:00", 1]);
        expect(run("FORM_FIELDS_SQL", ["frm_new"]).map((r) => r.id)).toEqual(["ff_new"]);
        expect(run("CONTRACTS_SQL").map((r) => r.id)).toEqual(["con_new", "con_1"]);
        expect(run("RECURRING_HOURS_SQL", ["st_amy"])).toEqual([
            { weekday: 2, start_time: "10:00:00", end_time: "14:00:00", available: 1 },
        ]);
        expect(all("SELECT id FROM hours WHERE staff_id = 'st_amy'").length).toBe(2);
    });

    it("covers every exported SQL constant", () => {
        const exported = Object.keys(core).filter((k) => k.endsWith("_SQL"));
        expect(exported.filter((k) => !SQL_COVERED.has(k))).toEqual([]);
    });
});
