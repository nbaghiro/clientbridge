import { AppSchema, businessQuery } from "@clientbridge/sync";
import initSqlJs, { type Database, type SqlValue } from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

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
    const stmt = db.prepare(businessQuery(sql));
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
    insert("business_selection", [{ id: "current", business_id: BIZ }]);
    insert("businesses", [
        {
            id: BIZ,
            name: "Birch Studio",
            timezone: "America/Vancouver",
            billing_email: "billing@birch.test",
            gst_hst_number: "123456789RT0001",
            qst_number: null,
            brand: "{}",
            stripe_account_id: "acct_1",
            tax_registered: 1,
            subject: "pet",
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
        {
            id: "fl_old",
            parent_type: "item",
            parent_id: "it_cut",
            purpose: "image",
            uploaded_at: TS,
        },
        {
            id: "fl_new",
            parent_type: "item",
            parent_id: "it_cut",
            purpose: "image",
            created_at: "2026-06-27T00:00:00Z",
            uploaded_at: "2026-06-27T00:00:00Z",
        },
        {
            id: "fl_pending",
            parent_type: "item",
            parent_id: "it_cut",
            purpose: "image",
            created_at: "2026-06-28T00:00:00Z",
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
            id: "ord_gift",
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
            paid_at: "2026-06-24T09:00:00Z",
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
            paid_at: "2026-06-23T08:00:00Z",
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
            reason: "duplicate",
            credit_note: "CN-7-1",
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
            reference: "CA2000ET",
            amount_cents: 2000,
            currency: "CAD",
            method: "etransfer",
            provider: "manual",
            status: "succeeded",
            paid_at: "2026-06-21T10:00:00Z",
        },
        {
            id: "pay_web",
            client_id: "cl_ben",
            kind: "payment",
            dispute_status: "needs_response",
            dispute_reason: "fraudulent",
            dispute_respond_by: "2026-07-06T00:00:00Z",
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
        },
        {
            id: "pm_main",
            client_id: "cl_ann",
            method: "card",
            brand: "Visa",
            last4: "1111",
            preferred: 1,
            mandate_status: "none",
            created_at: "2026-06-27T00:00:00Z",
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
        {
            id: "gc_1",
            code: "GIFTAAAA",
            initial_cents: 5000,
            status: "active",
            recipient: "a@x",
            purchaser_client_id: "cl_ann",
        },
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
    scoped("review_requests", [
        {
            id: "rrq_1",
            client_id: "cl_ann",
            booking_id: "bk_1",
            requested_at: "2026-06-26T12:00:00Z",
        },
        { id: "rrq_2", client_id: "cl_ann", requested_at: "2026-06-25T12:00:00Z" },
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
    scoped("contracts", [{ id: "con_1", name: "Waiver", body: "I agree", version: 2, active: 1 }]);
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
        account("a_fee", "business", BIZ, "processing_fee"),
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
        "j_fee1",
        "fee",
        "fee:pay_1",
        [
            ["a_fee", 175],
            ["a_stripe", -175],
        ],
        { source_type: "payment", source_id: "pay_1" },
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
        "j_gift",
        "redemption",
        "redemption:gc_1:ord_gift:3000",
        [
            ["a_gc1", 3000],
            ["a_rev", -3000],
        ],
        { ...on("gift_card", "gc_1"), source_type: "order", source_id: "ord_gift" },
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
    journal(
        "j_tip",
        "tip",
        "tip:pay_web:st_amy",
        [
            ["a_cost", 300],
            ["a_pay_amy", -300],
        ],
        { ...on("order", "ord_web", "pay_web"), meta: JSON.stringify({ basis: "tip" }) },
    );
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

function scheduleRows(): void {
    db.run("DELETE FROM subjects WHERE id IN ('sj_rex', 'sj_gone')");
    db.run("DELETE FROM notes WHERE id IN ('nt_1', 'nt_2', 'nt_3')");
    db.run("DELETE FROM bookings WHERE id = 'bk_future'");
    db.run("DELETE FROM slots WHERE id = 'ss_future'");
    insert("users", [{ id: "us_cara", name: "Cara" }]);
    scoped("staff", [{ id: "st_cara", user_id: "us_cara", role: "staff", status: "active" }]);
    scoped("subjects", [
        {
            id: "sj_rex",
            client_id: "cl_ann",
            name: "Rex",
            attributes: '{"breed":"Lab"}',
        },
    ]);
    scoped("recurrences", [
        {
            id: "sch_1",
            item_id: "it_cut",
            staff_id: "st_cara",
            client_id: "cl_ann",
            frequency: "week",
            interval: 2,
            count: 3,
            status: "active",
        },
    ]);
    scoped("slots", [
        {
            id: "ss_c1",
            item_id: "it_cut",
            staff_id: "st_cara",
            recurrence_id: "sch_1",
            starts_at: "2027-01-05T17:00:00Z",
            ends_at: "2027-01-05T18:00:00Z",
            capacity: 1,
            status: "scheduled",
        },
        {
            id: "ss_c2",
            item_id: "it_cut",
            staff_id: "st_cara",
            recurrence_id: "sch_1",
            starts_at: "2027-01-19T17:00:00Z",
            ends_at: "2027-01-19T18:00:00Z",
            capacity: 1,
            status: "scheduled",
        },
        {
            id: "ss_k",
            item_id: "it_cut",
            staff_id: "st_cara",
            starts_at: "2027-01-06T17:00:00Z",
            ends_at: "2027-01-06T18:00:00Z",
            capacity: 2,
            status: "scheduled",
        },
    ]);
    scoped("bookings", [
        {
            id: "bk_c1",
            slot_id: "ss_c1",
            staff_id: "st_cara",
            client_id: "cl_ann",
            subject_id: "sj_rex",
            status: "confirmed",
            source: "online",
            deposit_amount_cents: 0,
            deposit_status: "none",
            reminded_at: "2027-01-04T17:00:00Z",
        },
        {
            id: "bk_c2",
            slot_id: "ss_c2",
            staff_id: "st_cara",
            client_id: "cl_ann",
            status: "completed",
            source: "manual",
            deposit_status: "none",
        },
        {
            id: "bk_k1",
            slot_id: "ss_k",
            staff_id: "st_cara",
            client_id: "cl_ann",
            subject_id: "sj_rex",
            status: "confirmed",
            source: "manual",
            deposit_status: "pending",
        },
        {
            id: "bk_k2",
            slot_id: "ss_k",
            staff_id: "st_cara",
            client_id: "cl_ben",
            status: "waitlisted",
            source: "manual",
            deposit_status: "none",
        },
    ]);
    scoped("notes", [
        { id: "nt_b", parent_type: "booking", parent_id: "bk_c1", body: "Nervous" },
        { id: "nt_c", parent_type: "client", parent_id: "cl_ann", body: "Likes mornings" },
    ]);
    scoped("hours", [
        {
            id: "av_c1",
            staff_id: "st_cara",
            basis: "recurring",
            weekday: 1,
            start_time: "09:00:00",
            end_time: "12:00:00",
            available: 1,
        },
        {
            id: "av_c2",
            staff_id: "st_cara",
            basis: "recurring",
            weekday: 1,
            start_time: "13:00:00",
            end_time: "17:00:00",
            available: 1,
        },
        {
            id: "av_off",
            staff_id: "st_cara",
            basis: "exception",
            starts_at: "2027-01-12T08:00:00Z",
            ends_at: "2027-01-13T08:00:00Z",
            reason: "Vet",
            available: 0,
        },
        {
            id: "av_shut",
            staff_id: null,
            basis: "exception",
            starts_at: "2027-01-01T08:00:00Z",
            ends_at: "2027-01-02T08:00:00Z",
            reason: "New Year",
            available: 0,
        },
    ]);
}

beforeEach(async () => {
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
    it("reads an accepted estimate's client and its chosen products for booking", () => {
        scoped("lines", [
            {
                id: "ln_e1",
                estimate_id: "est_1",
                description: "Soap",
                item_id: "it_soap",
                quantity: 2,
                position: 0,
            },
            { id: "ln_e2", estimate_id: "est_1", description: "Labour", quantity: 3, position: 1 },
            {
                id: "ln_e3",
                estimate_id: "est_1",
                description: "Cut",
                item_id: "it_cut",
                quantity: 1,
                position: 2,
            },
            {
                id: "ln_e4",
                estimate_id: "est_1",
                description: "Extra soap",
                item_id: "it_soap",
                quantity: 1,
                optional: 1,
                selected: 0,
                position: 3,
            },
            {
                id: "ln_e5",
                estimate_id: "est_1",
                description: "Big soap",
                item_id: "it_soap",
                quantity: 1,
                optional: 1,
                selected: 1,
                position: 4,
            },
        ]);
        expect(run("ESTIMATE_BOOKING_SQL", ["est_1"])).toEqual([
            { client_id: "cl_ben", number: 3 },
        ]);
        expect(run("ESTIMATE_PRODUCTS_SQL", ["est_1"]).map((r) => r.id)).toEqual([
            "ln_e1",
            "ln_e5",
        ]);
        db.run("UPDATE estimates SET status = 'sent' WHERE id = 'est_1'");
        expect(run("ESTIMATE_BOOKING_SQL", ["est_1"])).toEqual([]);
    });

    it("names the live visit booked from an estimate, and frees it once that visit is canceled", () => {
        const booking = (): Row[] => pick(run("ESTIMATES_SQL"), "id", "booking_id");
        expect(booking()).toEqual([{ id: "est_1", booking_id: null }]);
        db.run("UPDATE bookings SET estimate_id = 'est_1' WHERE id = 'bk_4'");
        expect(booking()).toEqual([{ id: "est_1", booking_id: "bk_4" }]);
        expect(run("ESTIMATE_BOOKING_SQL", ["est_1"])).toEqual([]);
        db.run("UPDATE bookings SET status = 'canceled' WHERE id = 'bk_4'");
        expect(booking()).toEqual([{ id: "est_1", booking_id: null }]);
        expect(run("ESTIMATE_BOOKING_SQL", ["est_1"])).toEqual([
            { client_id: "cl_ben", number: 3 },
        ]);
    });

    it("reads the business address from its brand", () => {
        expect(run("BUSINESS_ADDRESS_SQL")).toEqual([{ address: null }]);
        db.run(`UPDATE businesses SET brand = '{"address": "880 Douglas St"}'`);
        expect(run("BUSINESS_ADDRESS_SQL")).toEqual([{ address: "880 Douglas St" }]);
    });

    it("lists a visit's uploaded photos and its subject's latest photos", () => {
        db.run("UPDATE bookings SET subject_id = 'sj_site' WHERE id = 'bk_1'");
        scoped("files", [
            {
                id: "fl_before",
                parent_type: "booking",
                parent_id: "bk_1",
                purpose: "photo",
                uploaded_at: TS,
            },
            {
                id: "fl_after",
                parent_type: "booking",
                parent_id: "bk_1",
                purpose: "photo",
                created_at: "2026-06-26T10:00:00Z",
                uploaded_at: "2026-06-26T10:00:00Z",
            },
            { id: "fl_unsent", parent_type: "booking", parent_id: "bk_1", purpose: "photo" },
            {
                id: "fl_other",
                parent_type: "booking",
                parent_id: "bk_4",
                purpose: "photo",
                uploaded_at: TS,
            },
        ]);
        expect(run("BOOKING_PHOTOS_SQL", ["bk_1"]).map((r) => r.id)).toEqual([
            "fl_before",
            "fl_after",
        ]);
        expect(run("SUBJECT_PHOTOS_SQL", ["sj_site"]).map((r) => r.id)).toEqual([
            "fl_after",
            "fl_before",
        ]);
    });

    it("lists people's uploaded photos with the staff row of a user on this business", () => {
        insert("staff", [
            { id: "st_elsewhere", business_id: "bz_2", user_id: "us_owner", created_at: TS },
        ]);
        scoped("files", [
            {
                id: "fl_face",
                parent_type: "client",
                parent_id: "cl_ann",
                purpose: "photo",
                uploaded_at: TS,
            },
            {
                id: "fl_me",
                parent_type: "user",
                parent_id: "us_owner",
                purpose: "photo",
                uploaded_at: TS,
            },
            { id: "fl_face_pending", parent_type: "client", parent_id: "cl_ann", purpose: "photo" },
            {
                id: "fl_pet",
                parent_type: "subject",
                parent_id: "sj_site",
                purpose: "photo",
                uploaded_at: TS,
            },
        ]);
        insert("files", [
            {
                id: "fl_other_business",
                business_id: "bz_2",
                parent_type: "user",
                parent_id: "us_owner",
                purpose: "photo",
                uploaded_at: TS,
                created_at: TS,
            },
        ]);
        expect(pick(run("PEOPLE_PHOTOS_SQL"), "id", "staff_id")).toEqual([
            { id: "fl_face", staff_id: null },
            { id: "fl_me", staff_id: "st_owner" },
        ]);
    });

    it("keeps visits longer than a week in an overlapping schedule window", () => {
        db.run(
            "UPDATE slots SET starts_at = '2026-06-01 10:00:00+00', ends_at = '2026-06-30 10:00:00+00' WHERE id = 'ss_1'",
        );
        const rows = all(`SELECT s.id FROM slots s WHERE ${core.slotOverlapSql("?1", "?2")}`, [
            "2026-06-26T00:00:00Z",
            "2026-06-27T00:00:00Z",
        ]);
        expect(rows.map((r) => r.id)).toContain("ss_1");
    });

    it("finds an upcoming inbox visit later on the same UTC day", () => {
        db.run("UPDATE bookings SET status = 'confirmed' WHERE id = 'bk_1'");
        const now = "2026-06-26T09:00:00Z";
        expect(run("INBOX_CLIENT_SQL", [now, now, "cl_ann"])[0]?.next_at).toBe(
            "2026-06-26 10:00:00+00",
        );
    });

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

    it("follows a dispute from the ledger: only the lost journal reads the sale as refunded", () => {
        const onInv3: Row = {
            subject_type: "invoice",
            subject_id: "inv_3",
            source_type: "payment",
            source_id: "pay_3",
        };
        const disputed = (status: string | null) => {
            db.run("UPDATE payments SET dispute_status = ? WHERE id = 'pay_3'", [status]);
        };
        const inv3 = () => pick(run("INVOICE_SQL", ["inv_3"]), "status", "balance_cents")[0];
        journal(
            "j_dp3",
            "dispute",
            "dispute:dp_3",
            [
                ["a_stripe", -2000],
                ["a_recv_ben", 2000],
            ],
            onInv3,
        );
        disputed("needs_response");
        expect(inv3()).toEqual({ status: "paid", balance_cents: 0 });
        expect(value(collectedSql("invoice", "'inv_3'"))).toBe(2000);
        expect(value(clientValueSql("'cl_ben'"))).toBe(6800);
        disputed("lost");
        expect(inv3()).toEqual({ status: "paid", balance_cents: 0 });
        journal(
            "j_dp3_lost",
            "dispute",
            "dispute:dp_3:lost",
            [
                ["a_recv_ben", -2000],
                ["a_rev", 2000],
            ],
            onInv3,
        );
        disputed("under_review");
        expect(inv3()).toEqual({ status: "refunded", balance_cents: 0 });
        expect(value(collectedSql("invoice", "'inv_3'"))).toBe(0);
        expect(value(clientValueSql("'cl_ben'"))).toBe(4800);
        db.run("DELETE FROM entries WHERE journal_id IN ('j_dp3', 'j_dp3_lost')");
        disputed(null);
        expect(inv3()).toEqual({ status: "paid", balance_cents: 0 });
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

    it("reads what paid an invoice down and the business letterhead", () => {
        expect(pick(run("INVOICE_CREDITS_SQL", ["inv_1"]), "event", "cents", "method")).toEqual([
            { event: "payment", cents: 5000, method: "card" },
        ]);
        expect(run("INVOICE_CREDITS_SQL", ["inv_2"])).toEqual([]);
        db.run(
            "UPDATE businesses SET street_number = '1250', province = 'BC', legal_phone = ? WHERE id = ?",
            ["+16045550142", BIZ],
        );
        expect(
            pick(
                run("LETTERHEAD_SQL"),
                "name",
                "billing_email",
                "gst_hst_number",
                "street_number",
                "province",
                "legal_phone",
            ),
        ).toEqual([
            {
                name: "Birch Studio",
                billing_email: "billing@birch.test",
                gst_hst_number: "123456789RT0001",
                street_number: "1250",
                province: "BC",
                legal_phone: "+16045550142",
            },
        ]);
        expect(pick(run("INVOICES_SQL"), "id", "client_email", "paid_cents", "paid_at")).toEqual([
            { id: "inv_1", client_email: "ann@x.test", paid_cents: 5000, paid_at: TS },
            { id: "inv_3", client_email: null, paid_cents: 2000, paid_at: TS },
            { id: "inv_2", client_email: null, paid_cents: 0, paid_at: null },
        ]);
        const on1 = (source: string): Row => ({
            subject_type: "invoice",
            subject_id: "inv_1",
            source_type: "payment",
            source_id: source,
        });
        const tipped = () => ({
            invoice: pick(run("INVOICE_SQL", ["inv_1"]), "total_cents", "tip_cents"),
            credits: pick(run("INVOICE_CREDITS_SQL", ["inv_1"]), "cents"),
        });
        db.run("UPDATE payments SET tip_cents = 800 WHERE id = 'pay_1'");
        journal("j_tipc", "payment", "payment:pay_1:tip", [["a_cost", -800]], on1("pay_1"));
        journal(
            "j_tip",
            "tip",
            "tip:pay_1:st_amy",
            [
                ["a_cost", 800],
                ["a_pay_amy", -800],
            ],
            on1("pay_1"),
        );
        expect(tipped()).toEqual({
            invoice: [{ total_cents: 11200, tip_cents: 800 }],
            credits: [{ cents: 5800 }],
        });
        journal("j_tipr", "refund", "refund:pay_r1:tip", [["a_cost", 800]], on1("pay_r1"));
        journal(
            "j_tipb",
            "tip",
            "tip:pay_r1:st_amy",
            [
                ["a_cost", -800],
                ["a_pay_amy", 800],
            ],
            on1("pay_r1"),
        );
        expect(tipped()).toEqual({
            invoice: [{ total_cents: 11200, tip_cents: 0 }],
            credits: [{ cents: 5000 }],
        });
        db.run("DELETE FROM entries WHERE journal_id IN ('j_tipc', 'j_tip', 'j_tipr', 'j_tipb')");
        db.run("UPDATE payments SET tip_cents = 0");
        const list = run("INVOICES_SQL").find((r) => r.id === "inv_3");
        expect(run("INVOICE_SQL", ["inv_3"])).toEqual([list]);
        expect(run("INVOICE_SQL", ["inv_missing"])).toEqual([]);
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
                "deposit_amount_cents",
                "deposit_status",
                "client_name",
            ),
        ).toEqual([
            {
                slot_id: "ss_1",
                booking_id: "bk_1",
                booked_count: 1,
                deposit_amount_cents: 2750,
                deposit_status: "collected",
                client_name: "Ann",
            },
            {
                slot_id: "ss_3",
                booking_id: null,
                booked_count: 0,
                deposit_amount_cents: null,
                deposit_status: null,
                client_name: null,
            },
        ]);
        expect(
            pick(
                events,
                "starts_at",
                "ends_at",
                "item_price",
                "item_color",
                "booking_price",
                "capacity",
                "addon_count",
            ),
        ).toEqual([
            {
                starts_at: "2026-06-26 10:00:00+00",
                ends_at: "2026-06-26 11:00:00+00",
                item_price: 10000,
                item_color: "#123",
                booking_price: 10000,
                capacity: 1,
                addon_count: 1,
            },
            {
                starts_at: "2026-06-27T09:00:00Z",
                ends_at: "2026-06-27T10:00:00Z",
                item_price: 10000,
                item_color: "#123",
                booking_price: null,
                capacity: 4,
                addon_count: 0,
            },
        ]);
        expect(run("ADDONS_SQL", ["bk_1"]).map((r) => r.id)).toEqual(["ba_1"]);
        expect(run("BOOKING_INVOICE_SQL", ["bk_1"])).toEqual([
            { invoice_id: "inv_1", order_id: null },
        ]);
    });

    it("derives each earning's status from its journals, tips included", () => {
        expect(pick(run("ALL_EARNINGS_SQL"), "id", "status", "amount_cents", "kind")).toEqual([
            { id: "j_e_pending", status: "pending", amount_cents: 900, kind: "earning" },
            { id: "j_tip", status: "pending", amount_cents: 300, kind: "tip" },
            { id: "j_e_approved", status: "approved", amount_cents: 4000, kind: "earning" },
            { id: "j_e_paid", status: "paid", amount_cents: 1500, kind: "earning" },
            { id: "j_e_reversed", status: "reversed", amount_cents: 700, kind: "earning" },
        ]);
        expect(pick(run("ALL_EARNINGS_SQL"), "id", "client_name", "paid_at")[1]).toEqual({
            id: "j_tip",
            client_name: "ben",
            paid_at: null,
        });
        expect(run("PAYEES_SQL").map((r) => r.id)).toEqual(["st_amy", "st_owner"]);
    });

    it("totals all deposits independently of payout history pagination", () => {
        expect(run("DEPOSITS_SINCE_SQL", ["2026-06-01T00:00:00.000Z"])).toEqual([{ cents: 40000 }]);
        for (let index = 0; index < 30; index += 1) {
            journal(`j_extra_${index}`, "payout", `payout:po_extra_${index}`, [["a_bank", 100]], {
                occurred_at: "2026-06-26T00:00:00Z",
            });
        }
        expect(run("DEPOSITS_SINCE_SQL", ["2026-06-01T00:00:00.000Z"])).toEqual([{ cents: 43000 }]);
        expect(run("DEPOSITS_SINCE_SQL", ["2026-07-01T00:00:00.000Z"])).toEqual([{ cents: 0 }]);
    });

    it("feeds today's payments and the payouts", () => {
        expect(run("TODAY_PAYMENTS_SQL", ["2026-06-26T00:00:00.000Z"])).toEqual([
            { id: "pay_1", kind: "payment" },
            { id: "pay_r1", kind: "refund" },
        ]);
        expect(run("FEES_SINCE_SQL", ["2026-06-01T00:00:00.000Z"])).toEqual([{ cents: 175 }]);
        expect(run("FEES_SINCE_SQL", ["2026-07-01T00:00:00.000Z"])).toEqual([{ cents: 0 }]);
        expect(run("STRIPE_BALANCE_SQL")).toEqual([{ cents: 0 }]);
        const charges = run("CARD_CHARGES_SQL", ["2026-06-20T00:00:00.000Z"]);
        expect(
            pick(charges, "id", "fee_cents", "refunded_cents", "invoice_number", "client_name")[0],
        ).toEqual({
            id: "pay_1",
            fee_cents: 175,
            refunded_cents: 1000,
            invoice_number: 7,
            client_name: "Ann",
        });
        expect(charges.map((c) => c.id)).not.toContain("pay_3");
        db.run("UPDATE payments SET status = 'failed' WHERE id = 'pay_1'");
        const unread = run("CARD_CHARGES_SQL", ["2026-06-20T00:00:00.000Z"]).map((c) => c.id);
        db.run("UPDATE payments SET status = 'succeeded' WHERE id = 'pay_1'");
        expect(unread).not.toContain("pay_1");
    });

    it("lists threads with unread counts and their messages", () => {
        expect(pick(run("THREADS_SQL"), "id", "unread_count", "last_body", "client_name")).toEqual([
            { id: "th_1", unread_count: 2, last_body: "See you soon", client_name: "Ann" },
            { id: "th_2", unread_count: 0, last_body: "Receipt", client_name: "ben" },
        ]);
        expect(run("CONVERSATION_SQL", ["th_1"]).map((r) => r.id)).toEqual(["m_1", "m_2", "m_3"]);
        expect(pick(run("INBOX_SQL"), "id", "unread_count", "subject_names")).toEqual([
            { id: "th_1", unread_count: 2, subject_names: null },
            { id: "th_2", unread_count: 0, subject_names: null },
        ]);
        expect(
            pick(
                run("INBOX_CLIENT_SQL", ["2026-01-01", "2026-01-01", "cl_ann"]),
                "id",
                "balance_cents",
            ),
        ).toEqual([{ id: "cl_ann", balance_cents: null }]);
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

    it("lists a client's wallet with what is still owed", () => {
        expect(run("WALLET_HOLDERS_SQL").map((r) => r.id)).toEqual(["cl_ann"]);
        expect(pick(run("WALLET_CLIENT_SQL", ["cl_ann"]), "name")).toEqual([{ name: "Ann" }]);
        expect(
            pick(
                run("WALLET_SQL", ["cl_ann"]),
                "kind",
                "id",
                "sessions_used",
                "balance_cents",
                "method_last4",
            ),
        ).toEqual([
            {
                kind: "package",
                id: "pk_1",
                sessions_used: 2,
                balance_cents: 0,
                method_last4: null,
            },
            {
                kind: "membership",
                id: "sub_1",
                sessions_used: null,
                balance_cents: null,
                method_last4: "1111",
            },
            {
                kind: "gift_card",
                id: "gc_1",
                sessions_used: null,
                balance_cents: 3000,
                method_last4: null,
            },
        ]);
        expect(pick(run("ENTITLEMENT_HISTORY_SQL", ["package", "pk_1"]), "event", "cents")).toEqual(
            [
                { event: "consumption", cents: 9000 },
                { event: "consumption", cents: 9000 },
            ],
        );
    });

    it("lists every client's packages, plans and gift cards with the client's name", () => {
        const rows = run("ENTITLEMENTS_SQL");
        expect(rows.map((r) => r.id).sort()).toEqual(["gc_1", "gc_2", "pk_1", "sub_1"]);
        expect(
            pick(
                rows.filter((r) => r.client_id === "cl_ann"),
                "client_name",
            ),
        ).toEqual([{ client_name: "Ann" }, { client_name: "Ann" }, { client_name: "Ann" }]);
    });

    it("lists refundable payments, credit notes and disputes", () => {
        expect(
            pick(run("REFUNDABLE_PAYMENTS_SQL"), "id", "refunded_cents", "invoice_number"),
        ).toEqual([
            { id: "pay_1", refunded_cents: 1000, invoice_number: 7 },
            { id: "pay_dep", refunded_cents: 0, invoice_number: null },
            { id: "pay_web", refunded_cents: 0, invoice_number: null },
            { id: "pay_3", refunded_cents: 0, invoice_number: 6 },
        ]);
        expect(pick(run("CREDIT_NOTES_SQL"), "credit_note", "client_name", "reason")).toEqual([
            { credit_note: "CN-7-1", client_name: "Ann", reason: "duplicate" },
        ]);
        expect(
            pick(run("DISPUTES_SQL"), "id", "dispute_status", "withdrawn_cents", "fee_cents"),
        ).toEqual([
            { id: "pay_web", dispute_status: "needs_response", withdrawn_cents: 0, fee_cents: 0 },
        ]);
    });

    it("reads the front desk: today's visits, sales and one sale's record", () => {
        expect(
            run("SALE_STAFF_SQL")
                .map((r) => r.id)
                .sort(),
        ).toEqual(["st_amy", "st_owner"]);
        expect(run("SALE_CLIENT_SQL", ["cl_ann"])).toEqual([
            { id: "cl_ann", name: "Ann", email: "ann@x.test", phone: "+16045550001" },
        ]);
        expect(run("SALE_CARDS_SQL", ["cl_ben"])).toEqual([]);
        expect(run("SALE_CLIENT_NAMES_SQL").length).toBe(2);
        const day = ["2026-06-26T00:00:00.000Z", "2026-06-27T00:00:00.000Z"];
        expect(
            pick(
                run("CHECKOUT_QUEUE_SQL", day),
                "booking_id",
                "item_name",
                "deposit_status",
                "cover_package_id",
            ),
        ).toEqual([
            {
                booking_id: "bk_1",
                item_name: "Cut",
                deposit_status: "collected",
                cover_package_id: null,
            },
        ]);
        const sales = pick(run("SALES_SQL"), "id", "status", "method", "summary");
        expect(sales.find((r) => r.id === "ord_gift")).toMatchObject({ status: "paid" });
        expect(sales.find((r) => r.id === "ord_web")).toMatchObject({
            status: "paid",
            method: "card",
        });
        expect(pick(run("SALE_RECORD_SQL", ["ord_open"]), "id", "status", "client_name")).toEqual([
            { id: "ord_open", status: "open", client_name: "Ann" },
        ]);
        expect(pick(run("SALE_LINES_SQL", ["ord_web"]), "id")).toEqual([{ id: "ln_3" }]);
        expect(pick(run("SALE_PAYMENTS_SQL", ["ord_web"]), "id", "kind")).toEqual([
            { id: "pay_web", kind: "payment" },
        ]);
    });

    it("lists invitation history and Google settings", () => {
        expect(pick(run("REVIEW_REQUESTS_SQL"), "id", "client_name")).toEqual([
            { id: "rrq_1", client_name: "Ann" },
            { id: "rrq_2", client_name: "Ann" },
        ]);
    });

    it("suggests recent visits nobody has been asked about", () => {
        scoped("bookings", [
            {
                id: "bk_done",
                slot_id: "ss_3",
                staff_id: "st_amy",
                client_id: "cl_ben",
                status: "completed",
                source: "manual",
                price_cents: 5000,
                deposit_amount_cents: 0,
                deposit_status: "none",
                completed_at: "2026-06-27T10:00:00Z",
            },
        ]);
        expect(pick(run("REVIEW_SUGGESTIONS_SQL", ["2026-06-25"]), "client_id")).toEqual([
            { client_id: "cl_ben" },
        ]);
        expect(run("REVIEW_SUGGESTIONS_SQL", ["2026-06-28"])).toEqual([]);
        db.run("DELETE FROM bookings WHERE id = 'bk_done'");
    });

    it("reads the team, the viewer and staff pay", () => {
        expect(run("STAFF_SQL").map((r) => r.id)).toEqual(["st_owner", "st_amy"]);
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
        expect(pick(run("BUSINESS_SQL"), "id", "name", "billing_email")).toEqual([
            { id: BIZ, name: "Birch Studio", billing_email: "billing@birch.test" },
        ]);
        expect(run("STRIPE_ACCOUNT_SQL")).toEqual([{ stripe_account_id: "acct_1" }]);
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
        expect(
            pick(run("ITEMS_SQL"), "id", "kind", "price_cents", "active", "track_stock"),
        ).toEqual([
            { id: "it_cut", kind: "service", price_cents: 10000, active: 1, track_stock: null },
            { id: "it_pkg", kind: "package", price_cents: 45000, active: 1, track_stock: null },
            {
                id: "it_plan",
                kind: "subscription",
                price_cents: 5000,
                active: 1,
                track_stock: null,
            },
            { id: "it_soap", kind: "product", price_cents: 2400, active: 1, track_stock: 1 },
            { id: "it_old", kind: "service", price_cents: 100, active: 0, track_stock: null },
        ]);
    });

    it("reads forms, contracts and weekly hours", () => {
        scoped("responses", [
            {
                id: "rs_1",
                form_id: "frm_a",
                client_id: "cl_ann",
                status: "submitted",
                submitted_at: TS,
                answers: "{}",
            },
            { id: "rs_2", form_id: "frm_a", client_id: "cl_ann", status: "draft", answers: "{}" },
        ]);
        expect(pick(run("CLIENT_FORMS_SQL", ["cl_ann"]), "id", "name")).toEqual([
            { id: "rs_1", name: "Alpha" },
        ]);
        db.run("UPDATE forms SET send_on = 'manual' WHERE id IN ('frm_a', 'frm_z')");
        db.run("UPDATE forms SET send_on = 'booking' WHERE id = 'frm_b'");
        expect(run("NOTE_FORMS_SQL").map((r) => r.id)).toEqual(["frm_a"]);
        expect(pick(run("FORM_LIBRARY_SQL"), "id", "field_count", "submitted", "waiting")).toEqual([
            { id: "frm_a", field_count: 2, submitted: 1, waiting: 1 },
            { id: "frm_b", field_count: 0, submitted: 0, waiting: 0 },
            { id: "frm_z", field_count: 0, submitted: 0, waiting: 0 },
        ]);
        expect(run("FORM_QUESTIONS_SQL", ["frm_a"]).map((r) => r.id)).toEqual(["ff_1", "ff_2"]);
        scoped("signatures", [
            {
                id: "sig_1",
                contract_id: "con_1",
                client_id: "cl_ann",
                status: "pending",
                token: "t1",
            },
        ]);
        expect(pick(run("SIGNATURES_SQL"), "id", "client_name", "status")).toEqual([
            { id: "sig_1", client_name: "Ann", status: "pending" },
        ]);
        expect(pick(run("CONTRACT_LIBRARY_SQL"), "id", "version")).toEqual([
            { id: "con_1", version: 2 },
        ]);
        expect(run("BUSINESS_NAME_SQL")).toEqual([{ name: "Birch Studio" }]);
        expect(run("SUBJECT_KIND_SQL")).toEqual([{ subject: "pet" }]);
        expect(run("RECURRING_HOURS_SQL", ["st_amy"])).toEqual([
            { weekday: 1, start_time: "09:00:00", end_time: "17:00:00", available: 1 },
        ]);
    });

    it("builds Today from the day's slots, hours and the client's last visit", () => {
        const day = ["2026-06-27T00:00:00.000Z", "2026-06-26T00:00:00.000Z"];
        expect(
            pick(
                run("AGENDA_SQL", day),
                "slot_id",
                "booking_id",
                "client_name",
                "staff_name",
                "deposit_status",
                "checked_in_at",
            ),
        ).toEqual([
            {
                slot_id: "ss_1",
                booking_id: "bk_1",
                client_name: "Ann",
                staff_name: null,
                deposit_status: "collected",
                checked_in_at: null,
            },
        ]);
        expect(run("TODAY_HOURS_SQL", [1])).toEqual([
            { staff_id: "st_amy", start_time: "09:00:00", end_time: "17:00:00", available: 1 },
        ]);
        expect(run("CLIENT_LAST_VISIT_SQL", ["cl_ann", "2026-06-27T00:00:00.000Z"])).toEqual([
            { starts_at: "2026-06-26 10:00:00+00" },
        ]);
        expect(run("CLIENT_LAST_VISIT_SQL", ["cl_ann", "2026-06-26T00:00:00.000Z"])).toEqual([]);
    });

    it("feeds the shell: the viewer, counts and setup progress", () => {
        expect(run("VIEWER_STAFF_SQL", ["st_amy"])).toEqual([
            { name: null, title: "Groomer", role: "staff", color: null },
        ]);
        expect(run("UNREAD_MESSAGES_SQL")).toEqual([{ n: 2 }]);
        expect(run("OVERDUE_INVOICES_SQL")).toEqual([{ n: 0 }]);
        expect(
            pick(run("SETUP_PROGRESS_SQL"), "services", "hours", "team", "stripe", "slug"),
        ).toEqual([{ services: 1, hours: 1, team: 3, stripe: 0, slug: null }]);
    });

    it("names members from their synced account and open invites by their email", () => {
        insert("users", [
            { id: "us_owner", name: "Hana" },
            { id: "us_other", name: "Elsewhere" },
        ]);
        insert("staff", [
            {
                id: "st_other",
                business_id: "bz_2",
                user_id: "us_other",
                role: "owner",
                status: "active",
                created_at: TS,
            },
        ]);
        const team = () => pick(run("TEAM_SQL"), "id", "name");
        expect(team()).toEqual([
            { id: "st_owner", name: "Hana" },
            { id: "st_amy", name: null },
            { id: "st_new", name: "new@birch.test" },
        ]);
        db.run("UPDATE users SET name = 'Hana Lee' WHERE id = 'us_owner'");
        expect(team()[0]).toEqual({ id: "st_owner", name: "Hana Lee" });
        expect(run("VIEWER_STAFF_SQL", ["st_owner"])[0]?.name).toBe("Hana Lee");
        const day = ["2026-06-27T00:00:00.000Z", "2026-06-26T00:00:00.000Z"];
        expect(pick(run("AGENDA_SQL", day), "slot_id", "staff_name")).toEqual([
            { slot_id: "ss_1", staff_name: "Hana Lee" },
        ]);
        expect(run("STAFF_SQL").map((r) => r.name)).not.toContain("Elsewhere");
    });

    it("derives the bell from synced rows since a date", () => {
        const since = Array<string>(6).fill("2026-06-24T00:00:00.000Z");
        const feed = run("NOTIFICATION_FEED_SQL", since)
            .map((r) => `${String(r.kind)}:${String(r.id)}`)
            .sort();
        expect(feed).toEqual([
            "booking_new:bk-bk_1",
            "deposit:pay-pay_dep",
            "message:msg-m_2",
            "message:msg-m_3",
            "order_new:ord-ord_web",
            "payment:pay-pay_1",
            "refund:pay-pay_r1",
        ]);
        expect(run("NOTIFICATION_FEED_SQL", since).find((r) => r.id === "ord-ord_web")?.at).toBe(
            "2026-06-24T09:00:00Z",
        );
        expect(
            run("MY_CLIENTS_SQL", ["st_owner"])
                .map((r) => r.client_id)
                .sort(),
        ).toEqual(["cl_ann", "cl_ben"]);
    });

    it("searches clients, upcoming bookings, invoices and active items", () => {
        expect(run("SEARCH_CLIENTS_SQL").map((r) => r.id)).toEqual(["cl_ann", "cl_ben"]);
        expect(
            pick(run("SEARCH_BOOKINGS_SQL", ["2026-07-01T00:00:00.000Z"]), "id", "client_name"),
        ).toEqual([{ id: "bk_4", client_name: "ben" }]);
        expect(pick(run("SEARCH_INVOICES_SQL"), "id", "status")).toEqual([
            { id: "inv_1", status: "partial" },
            { id: "inv_3", status: "paid" },
            { id: "inv_2", status: "draft" },
        ]);
        expect(run("SEARCH_ITEMS_SQL").map((r) => r.id)).not.toContain("it_old");
    });

    it("lists paid online orders for pickup with their lines", () => {
        const orders = pick(run("PICKUP_ORDERS_SQL"), "id", "pickup_status");
        expect(orders.sort((a, b) => String(a.id).localeCompare(String(b.id)))).toEqual([
            { id: "ord_gone", pickup_status: "picked_up" },
            { id: "ord_web", pickup_status: "ready" },
        ]);
        expect(run("OPEN_PICKUPS_SQL")).toEqual([{ n: 1 }]);
        expect(pick(run("PICKUP_LINES_SQL"), "id", "order_id")).toEqual([
            { id: "ln_3", order_id: "ord_web" },
        ]);
    });

    it("counts units sold on paid sales since a cutoff", () => {
        const cutoff = "2026-06-01T00:00:00.000Z";
        expect(run("UNITS_SOLD_SQL", [cutoff, cutoff])).toEqual([{ item_id: "it_soap", units: 2 }]);
        const later = "2026-07-01T00:00:00.000Z";
        expect(run("UNITS_SOLD_SQL", [later, later])).toEqual([]);
    });

    it("lists stock changes newest first with their cause and who", () => {
        scoped("inventory", [
            {
                id: "stk_1",
                item_id: "it_soap",
                reason: "restock",
                quantity: 6,
                note: "Coastal",
                created_by: "us_amy",
                created_at: "2026-06-20T09:00:00Z",
            },
            {
                id: "stk_2",
                item_id: "it_soap",
                line_id: "ln_3",
                reason: "sale",
                quantity: -2,
                created_at: "2026-06-24T09:00:00Z",
            },
        ]);
        expect(pick(run("STOCK_MOVES_SQL"), "id", "item_name", "order_source", "by_name")).toEqual([
            { id: "stk_2", item_name: "Soap", order_source: "online", by_name: "Owner" },
            { id: "stk_1", item_name: "Soap", order_source: null, by_name: "Groomer" },
        ]);
        expect(run("TAX_SETUP_SQL")).toEqual([{ province: null, tax_registered: 1 }]);
    });

    it("reads a client's record: subjects, visits, notes, methods, plans and history", () => {
        scoped("slots", [
            {
                id: "ss_future",
                item_id: "it_cut",
                staff_id: "st_owner",
                starts_at: "2026-11-05T17:00:00Z",
                ends_at: "2026-11-05T18:00:00Z",
                capacity: 1,
                status: "scheduled",
            },
        ]);
        scoped("subjects", [
            { id: "sj_rex", client_id: "cl_ann", name: "Rex", attributes: "{}" },
            {
                id: "sj_gone",
                client_id: "cl_ann",
                name: "Old",
                attributes: "{}",
                deleted_at: TS,
            },
        ]);
        scoped("bookings", [
            {
                id: "bk_future",
                slot_id: "ss_future",
                staff_id: "st_owner",
                client_id: "cl_ann",
                subject_id: "sj_rex",
                status: "confirmed",
                source: "manual",
                price_cents: 10000,
            },
        ]);
        scoped("notes", [
            {
                id: "nt_1",
                parent_type: "client",
                parent_id: "cl_ann",
                body: "Likes mornings",
                pinned: 1,
                created_by: "us_owner",
            },
            { id: "nt_2", parent_type: "subject", parent_id: "sj_rex", body: "Muzzle", pinned: 0 },
            { id: "nt_3", parent_type: "client", parent_id: "cl_ben", body: "Other", pinned: 0 },
        ]);
        scoped("consents", [
            {
                id: "cns_1",
                client_id: "cl_ann",
                channel: "sms",
                status: "granted",
                source: "in_person",
                recorded_by: "us_owner",
            },
        ]);
        db.run("UPDATE clients SET tags = ?, preferred_channel = 'email' WHERE id = 'cl_ann'", [
            '["vip","regular"]',
        ]);

        const ann = run("CLIENT_SQL", [new Date().toISOString(), "cl_ann"])[0];
        expect(
            pick([ann ?? {}], "subject_names", "next_visit_at", "tags", "preferred_channel"),
        ).toEqual([
            {
                subject_names: "Rex",
                next_visit_at: "2026-11-05T17:00:00Z",
                tags: '["vip","regular"]',
                preferred_channel: "email",
            },
        ]);
        const after = run("CLIENT_SQL", ["2026-11-05T18:00:01Z", "cl_ann"])[0];
        expect(pick([after ?? {}], "next_visit_at")).toEqual([{ next_visit_at: null }]);
        expect(run("CLIENT_DIRECTORY_SQL", [new Date().toISOString()]).map((r) => r.id)).toEqual([
            "cl_ann",
            "cl_ben",
        ]);
        expect(run("CLIENT_VISITS_SQL", ["cl_ann"]).map((r) => r.id)).toEqual([
            "bk_future",
            "bk_1",
        ]);
        expect(run("CLIENT_SUBJECTS_SQL", ["cl_ann"]).map((r) => r.id)).toEqual(["sj_rex"]);
        expect(
            pick(
                run("CLIENT_NOTES_SQL", ["cl_ann", "cl_ann"]),
                "id",
                "author_staff_id",
                "subject_name",
            ),
        ).toEqual([
            { id: "nt_1", author_staff_id: "st_owner", subject_name: null },
            { id: "nt_2", author_staff_id: null, subject_name: "Rex" },
        ]);
        expect(run("CLIENT_CONSENT_SQL", ["cl_ann"])).toEqual([
            { status: "granted", created_at: TS, recorded_by_name: null },
        ]);
        expect(run("CLIENT_METHODS_SQL", ["cl_ann"]).map((r) => r.id)).toEqual([
            "pm_main",
            "pm_old",
        ]);
        expect(pick(run("CLIENT_PLANS_SQL", ["cl_ann", "cl_ann"]), "kind", "id")).toEqual([
            { kind: "package", id: "pk_1" },
            { kind: "subscription", id: "sub_1" },
        ]);
        expect(pick(run("CLIENT_INVOICES_SQL", ["cl_ann"]), "id", "status")).toEqual([
            { id: "inv_1", status: "partial" },
        ]);
        const byId = (a: Row, b: Row) => String(a.id).localeCompare(String(b.id));
        expect(run("CLIENT_PAYMENTS_SQL", ["cl_ann"]).sort(byId)).toEqual([
            { id: "pay_1", kind: "payment", amount_cents: 5000, at: "2026-06-26T13:00:00Z" },
            { id: "pay_dep", kind: "deposit", amount_cents: 2750, at: "2026-06-25T09:00:00Z" },
            { id: "pay_r1", kind: "refund", amount_cents: 1000, at: "2026-06-26T14:00:00Z" },
        ]);
        expect(
            run("CLIENT_PAYMENTS_SQL", ["cl_ben"])
                .map((r) => r.id)
                .sort(),
        ).toEqual(["pay_3", "pay_web"]);
        db.run("UPDATE payments SET status = 'failed' WHERE id = 'pay_dep'");
        const listed = run("CLIENT_PAYMENTS_SQL", ["cl_ann"]).map((r) => r.id);
        db.run("UPDATE payments SET status = 'succeeded' WHERE id = 'pay_dep'");
        expect(listed).not.toContain("pay_dep");
        expect(run("CLIENT_MESSAGES_SQL", ["cl_ann"]).every((r) => r.direction !== null)).toBe(
            true,
        );
        expect(
            pick(
                run("CLIENT_FOOTPRINT_SQL", ["cl_ann", "cl_ben"]),
                "id",
                "bookings",
                "subject_count",
                "notes",
            ),
        ).toEqual([
            { id: "cl_ann", bookings: 2, subject_count: 1, notes: 1 },
            { id: "cl_ben", bookings: 1, subject_count: 0, notes: 1 },
        ]);
    });

    it("reads tax settings, item tax classes, brand, the booking preview and the team", () => {
        db.run(
            "UPDATE businesses SET province = 'BC', slug = 'birch', pst_number = 'PST12345678', filing_frequency = 'quarterly'",
        );
        expect(run("TAX_SETTINGS_SQL")).toEqual([
            {
                province: "BC",
                tax_registered: 1,
                gst_hst_number: "123456789RT0001",
                pst_number: "PST12345678",
                filing_frequency: "quarterly",
                province_locked: 1,
            },
        ]);
        const locked = () => run("TAX_SETTINGS_SQL")[0]?.province_locked;
        db.run("SAVEPOINT untaxed");
        db.run(
            "DELETE FROM entries WHERE account_id IN (SELECT id FROM accounts WHERE category = 'tax')",
        );
        db.run("UPDATE lines SET tax_amount_cents = 0");
        expect(locked()).toBe(0);
        db.run("UPDATE lines SET tax_amount_cents = 100 WHERE id = 'ln_1'");
        db.run("UPDATE invoices SET status = 'draft' WHERE id = 'inv_1'");
        expect(locked()).toBe(0);
        db.run("UPDATE invoices SET status = 'void' WHERE id = 'inv_1'");
        expect(locked()).toBe(1);
        db.run("UPDATE lines SET tax_amount_cents = 0");
        db.run("UPDATE lines SET tax_amount_cents = 100 WHERE id = 'ln_3'");
        expect(locked()).toBe(1);
        db.run("UPDATE orders SET status = 'void' WHERE id = 'ord_web'");
        expect(locked()).toBe(0);
        db.run("ROLLBACK TO untaxed");
        db.run("RELEASE untaxed");
        expect(locked()).toBe(1);
        expect(run("TAXABLE_ITEMS_SQL")).toEqual([
            {
                id: "it_pkg",
                name: "Five Cuts",
                kind: "package",
                price_cents: 45000,
                tax_class: null,
            },
            { id: "it_soap", name: "Soap", kind: "product", price_cents: 2400, tax_class: null },
            { id: "it_cut", name: "Cut", kind: "service", price_cents: 10000, tax_class: null },
            {
                id: "it_plan",
                name: "Plan",
                kind: "subscription",
                price_cents: 5000,
                tax_class: null,
            },
        ]);
        expect(pick(run("BRAND_SQL"), "id", "slug", "province")).toEqual([
            { id: BIZ, slug: "birch", province: "BC" },
        ]);
        db.run("UPDATE items SET online_bookable = 1 WHERE id = 'it_cut'");
        expect(run("BOOKING_PREVIEW_SQL").map((r) => r.id)).toEqual(["it_cut"]);
        expect(pick(run("TEAM_SQL"), "id", "status")).toEqual([
            { id: "st_owner", status: "active" },
            { id: "st_amy", status: "active" },
            { id: "st_new", status: "invited" },
        ]);
        expect(
            pick(
                run("SETUP_PROGRESS_SQL"),
                "province",
                "tax_registered",
                "invites",
                "dismissed_at",
            ),
        ).toEqual([
            { province: "BC", tax_registered: 1, invites: "new@birch.test", dismissed_at: null },
        ]);
    });

    it("keeps device preferences in a local table", () => {
        insert("device_prefs", [{ id: "search.recent", value: '["ann"]' }]);
        expect(run("DEVICE_PREF_SQL", ["search.recent"])).toEqual([{ value: '["ann"]' }]);
    });

    it("reads consent, the broadcast audience and broadcast results", () => {
        scoped("consents", [
            {
                id: "cns_x1",
                client_id: "cl_ben",
                channel: "email",
                status: "granted",
                source: "form",
                created_at: "2026-06-01T00:00:00Z",
            },
            {
                id: "cns_x2",
                client_id: "cl_ben",
                channel: "email",
                status: "withdrawn",
                source: "unsubscribe",
                created_at: "2026-06-26T10:15:00Z",
            },
        ]);
        expect(
            pick(
                run("LATEST_CONSENTS_SQL").filter((r) => r.client_id === "cl_ben"),
                "channel",
                "status",
            ),
        ).toEqual([{ channel: "email", status: "withdrawn" }]);
        scoped("consents", [
            {
                id: "cns_s1",
                client_id: "cl_ben",
                channel: "sms",
                status: "withdrawn",
                source: "reply",
                created_at: "2026-06-20T08:00:00Z",
            },
            {
                id: "cns_s2",
                client_id: "cl_ben",
                channel: "sms",
                status: "granted",
                source: "in_person",
                created_at: "2026-06-21T08:00:00Z",
            },
        ]);
        expect(run("TEXTS_STOPPED_SQL")).toEqual([
            { client_id: "cl_ben", created_at: "2026-06-20T08:00:00Z" },
        ]);
        expect(run("CLIENT_TEXT_REPLY_SQL", ["cl_ben"])).toEqual([
            { status: "withdrawn", created_at: "2026-06-20T08:00:00Z" },
        ]);
        scoped("consents", [
            {
                id: "cns_s3",
                client_id: "cl_ben",
                channel: "sms",
                status: "granted",
                source: "reply",
                created_at: "2026-06-22T08:00:00Z",
            },
        ]);
        expect(run("TEXTS_STOPPED_SQL")).toEqual([]);
        expect(run("CLIENT_TEXT_REPLY_SQL", ["cl_ben"])).toEqual([
            { status: "granted", created_at: "2026-06-22T08:00:00Z" },
        ]);
        db.run("DELETE FROM consents WHERE id IN ('cns_s1', 'cns_s2', 'cns_s3')");
        expect(run("AUDIENCE_CLIENTS_SQL").map((r) => r.id)).toEqual(["cl_ann", "cl_ben"]);
        scoped("broadcasts", [
            {
                id: "bc_1",
                name: "Promo",
                channel: "sms",
                body: "Sale",
                audience: '{"all":true}',
                status: "sent",
                recipient_count: 1,
                excluded_count: 1,
                created_at: "2026-06-26T09:30:00Z",
            },
        ]);
        scoped("messages", [
            {
                id: "m_bc",
                thread_id: "th_1",
                direction: "out",
                channel: "sms",
                body: "Sale",
                status: "sent",
                broadcast_id: "bc_1",
                created_at: "2026-06-26T09:30:00Z",
            },
        ]);
        expect(
            pick(run("BROADCASTS_SQL"), "id", "delivered_count", "reply_count", "opt_out_count"),
        ).toEqual([{ id: "bc_1", delivered_count: 1, reply_count: 1, opt_out_count: 0 }]);
        db.run("DELETE FROM messages WHERE id = 'm_bc'");
        db.run("DELETE FROM consents WHERE id IN ('cns_x1', 'cns_x2')");
    });

    it("reads the schedule's people, subjects, hours, time off and series", () => {
        scheduleRows();
        const range = ["2027-01-07T00:00:00.000Z", "2027-01-05T00:00:00.000Z"];
        expect(
            pick(
                run("EVENTS_SQL", range),
                "slot_id",
                "booking_id",
                "subject_name",
                "recurrence_id",
                "booked_count",
                "note",
            ),
        ).toEqual([
            {
                slot_id: "ss_c1",
                booking_id: "bk_c1",
                subject_name: "Rex",
                recurrence_id: "sch_1",
                booked_count: 1,
                note: "Nervous",
            },
            {
                slot_id: "ss_k",
                booking_id: null,
                subject_name: null,
                recurrence_id: null,
                booked_count: 1,
                note: null,
            },
        ]);
        expect(run("WORKING_HOURS_SQL").filter((r) => r.staff_id === "st_cara")).toHaveLength(2);
        expect(
            run("AWAY_SQL", ["2027-02-01T00:00:00.000Z", "2026-12-31T00:00:00.000Z"]).map(
                (r) => r.id,
            ),
        ).toEqual(["av_shut", "av_off"]);
        expect(run("DETAIL_CLIENT_SQL", ["cl_ann"]).map((r) => r.name)).toEqual(["Ann"]);
        expect(run("DETAIL_SUBJECT_SQL", ["bk_c1"]).map((r) => r.name)).toEqual(["Rex"]);
        expect(
            run("DETAIL_NOTES_SQL", ["bk_c1", "cl_ann"])
                .map((r) => r.id)
                .sort(),
        ).toEqual(["nt_b", "nt_c"]);
        expect(pick(run("DETAIL_SERIES_SQL", ["ss_c2"]), "id", "position")).toEqual([
            { id: "sch_1", position: 2 },
        ]);
        expect(pick(run("DETAIL_ROSTER_SQL", ["ss_k"]), "booking_id", "status")).toEqual([
            { booking_id: "bk_k1", status: "confirmed" },
            { booking_id: "bk_k2", status: "waitlisted" },
        ]);
        expect(pick(run("VISIT_STATS_SQL", ["cl_ann"]), "visits")).toEqual([{ visits: 2 }]);
        expect(run("CLIENT_SUBJECT_OPTIONS_SQL").map((r) => r.id)).toEqual(["sj_rex"]);
        expect(run("BOOKING_START_SQL", ["bk_c1"])).toEqual([
            { starts_at: "2027-01-05T17:00:00Z" },
        ]);
        expect(run("RECURRING_HOURS_SQL", ["st_cara"])).toHaveLength(2);
        expect(
            pick(
                run("SERIES_SQL"),
                "id",
                "item_name",
                "client_name",
                "frequency",
                "interval",
                "count",
                "until",
                "status",
            ),
        ).toEqual([
            {
                id: "sch_1",
                item_name: "Cut",
                client_name: "Ann",
                frequency: "week",
                interval: 2,
                count: 3,
                until: null,
                status: "active",
            },
        ]);
        const visits = run("SERIES_VISITS_SQL");
        expect(
            pick(visits, "slot_id", "recurrence_id", "booking_id", "status", "subject_name"),
        ).toEqual([
            {
                slot_id: "ss_c1",
                recurrence_id: "sch_1",
                booking_id: "bk_c1",
                status: "confirmed",
                subject_name: "Rex",
            },
            {
                slot_id: "ss_c2",
                recurrence_id: "sch_1",
                booking_id: "bk_c2",
                status: "completed",
                subject_name: null,
            },
        ]);
        expect(visits.filter((v) => v.status === "completed")).toHaveLength(1);
    });

    it("tells a waitlist the job closed apart from other canceled class bookings", () => {
        scoped("slots", [
            {
                id: "ss_w",
                item_id: "it_cut",
                staff_id: "st_owner",
                starts_at: "2026-09-01T18:00:00Z",
                ends_at: "2026-09-01T19:00:00Z",
                capacity: 2,
                status: "completed",
            },
        ]);
        const booking = (id: string, extra: Row): Row => ({
            id,
            slot_id: "ss_w",
            starts_at: "2026-09-01T18:00:00Z",
            client_id: "cl_ann",
            status: "canceled",
            deleted_at: null,
            ...extra,
        });
        scoped("bookings", [
            booking("bk_w_closed", { canceled_at: "2026-09-02T07:02:00Z" }),
            booking("bk_w_left", { canceled_at: "2026-08-30T12:00:00Z" }),
            booking("bk_w_seat", {
                confirmed_at: "2026-08-20T12:00:00Z",
                canceled_at: "2026-09-02T07:02:00Z",
            }),
        ]);
        const closed = run("CLIENT_VISITS_SQL", ["cl_ann"]).filter((r) =>
            String(r.id).startsWith("bk_w_"),
        );
        expect(pick(closed, "id", "waitlist_closed")).toEqual([
            { id: "bk_w_closed", waitlist_closed: 1 },
            { id: "bk_w_left", waitlist_closed: 0 },
            { id: "bk_w_seat", waitlist_closed: 0 },
        ]);
    });

    it("reads class rosters, reminders and add-on offers", () => {
        scheduleRows();
        expect(
            pick(
                run("CLASS_SESSIONS_SQL", ["2027-01-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z"]),
                "slot_id",
                "capacity",
                "item_name",
            ),
        ).toEqual([{ slot_id: "ss_k", capacity: 2, item_name: "Cut" }]);
        expect(
            run("CLASS_SESSIONS_SQL", ["2027-01-07T00:00:00.000Z", "2027-02-01T00:00:00.000Z"]),
        ).toEqual([]);
        const roster = run("CLASS_ROSTER_SQL", [
            "2027-01-01T00:00:00.000Z",
            "2027-02-01T00:00:00.000Z",
        ]);
        expect(pick(roster, "booking_id", "slot_id", "status", "subject_name")).toEqual([
            { booking_id: "bk_k1", slot_id: "ss_k", status: "confirmed", subject_name: "Rex" },
            { booking_id: "bk_k2", slot_id: "ss_k", status: "waitlisted", subject_name: null },
        ]);
        expect(roster.filter((r) => r.status === "confirmed")).toHaveLength(1);
        expect(roster.filter((r) => r.status === "waitlisted")).toHaveLength(1);
        const pickups = JSON.stringify({ pickups: [{ name: "Ngozi Nwosu", relation: "Gran" }] });
        db.run("UPDATE subjects SET attributes = ? WHERE id = 'sj_rex'", [pickups]);
        const withPickups = run("CLASS_ROSTER_SQL", [
            "2027-01-01T00:00:00.000Z",
            "2027-02-01T00:00:00.000Z",
        ]);
        expect(pick(withPickups, "booking_id", "subject_attributes")).toEqual([
            { booking_id: "bk_k1", subject_attributes: pickups },
            { booking_id: "bk_k2", subject_attributes: null },
        ]);
        expect(
            pick(
                run("AGENDA_SQL", ["2027-01-06T00:00:00.000Z", "2027-01-05T00:00:00.000Z"]),
                "booking_id",
                "subject_attributes",
            ),
        ).toEqual([{ booking_id: "bk_c1", subject_attributes: pickups }]);
        expect(
            run("CLASS_ROSTER_SQL", ["2027-01-07T00:00:00.000Z", "2027-02-01T00:00:00.000Z"]),
        ).toEqual([]);
        expect(pick(run("CLASS_CLIENTS_SQL"), "id", "subject_name")).toEqual([
            { id: "cl_ann", subject_name: "Rex" },
            { id: "cl_ben", subject_name: null },
        ]);
        expect(run("REMINDERS_SENT_SQL", ["2027-01-01T00:00:00.000Z"])).toEqual([{ sent: 1 }]);
        insert("items", [
            {
                id: "it_brush",
                business_id: BIZ,
                kind: "product",
                name: "Brush",
                price_cents: 1500,
                active: 1,
                addon: 1,
                addon_for: '["it_cut"]',
                track_stock: 0,
            },
        ]);
        insert("addons", [
            {
                id: "ba_c1",
                business_id: BIZ,
                booking_id: "bk_c1",
                item_id: "it_brush",
                description: "Brush",
                quantity: 1,
                unit_amount_cents: 1500,
            },
        ]);
        expect(
            pick(run("ADDON_PRODUCTS_SQL", ["2026-01-01T00:00:00Z"]), "id", "addon", "attached"),
        ).toEqual([
            { id: "it_brush", addon: 1, attached: 1 },
            { id: "it_soap", addon: null, attached: 1 },
        ]);
        expect(run("ONLINE_BOOKINGS_SQL", ["2026-01-01T00:00:00Z"])).toEqual([{ n: 2 }]);
        expect(run("ADDON_SERVICES_SQL").map((r) => r.id)).toEqual(["it_cut"]);
    });

    it("totals a sale with line and sale discounts, a tip and a partial refund", () => {
        scoped("orders", [
            {
                id: "ord_disc",
                number: 42,
                client_id: "cl_ann",
                staff_id: "st_amy",
                status: "open",
                currency: "CAD",
                subtotal_cents: 14800,
                tax_total_cents: 0,
                total_cents: 12420,
                source: "pos",
                discount_kind: "percent",
                discount_value: 1000,
                discount_reason: "Loyalty",
                created_at: "2026-06-26T15:00:00Z",
            },
        ]);
        scoped("lines", [
            {
                id: "ln_d1",
                order_id: "ord_disc",
                description: "Cut",
                item_id: "it_cut",
                quantity: 1,
                unit_amount_cents: 10000,
                amount_cents: 10000,
                discount_cents: 1000,
                sale_discount_cents: 900,
                discount_kind: "amount",
                discount_value: 1000,
                discount_reason: "Regular",
                position: 0,
            },
            {
                id: "ln_d2",
                order_id: "ord_disc",
                description: "Soap",
                item_id: "it_soap",
                quantity: 2,
                unit_amount_cents: 2400,
                amount_cents: 4800,
                discount_cents: 0,
                sale_discount_cents: 480,
                position: 1,
            },
        ]);
        scoped("payments", [
            {
                id: "pay_d",
                client_id: "cl_ann",
                kind: "payment",
                order_id: "ord_disc",
                amount_cents: 13920,
                tip_cents: 1500,
                currency: "CAD",
                method: "card",
                provider: "stripe",
                status: "succeeded",
                paid_at: "2026-06-26T15:05:00Z",
            },
            {
                id: "pay_dr",
                client_id: "cl_ann",
                kind: "refund",
                parent_payment_id: "pay_d",
                order_id: "ord_disc",
                amount_cents: 2000,
                currency: "CAD",
                method: "card",
                provider: "stripe",
                status: "succeeded",
                paid_at: "2026-06-26T16:00:00Z",
            },
        ]);
        const sale = { subject_type: "order", subject_id: "ord_disc" };
        journal(
            "j_d",
            "payment",
            "payment:pay_d",
            [
                ["a_stripe", 13920],
                ["a_rev", -12420],
                ["a_pay_amy", -1500],
            ],
            { ...sale, source_type: "payment", source_id: "pay_d" },
        );
        journal(
            "j_dr",
            "refund",
            "refund:pay_dr",
            [
                ["a_stripe", -2000],
                ["a_rev", 2000],
            ],
            { ...sale, source_type: "payment", source_id: "pay_dr" },
        );

        const row = run("SALES_SQL").find((r) => r.id === "ord_disc");
        expect(
            pick(
                [row ?? {}],
                "status",
                "total_cents",
                "tip_cents",
                "discount_cents",
                "refunded_cents",
                "item_count",
                "method",
                "summary",
                "client_name",
            ),
        ).toEqual([
            {
                status: "paid",
                total_cents: 12420,
                tip_cents: 1500,
                discount_cents: 2380,
                refunded_cents: 2000,
                item_count: 3,
                method: "card",
                summary: "Cut, 2 × Soap",
                client_name: "Ann",
            },
        ]);
        expect(
            pick(
                run("SALE_RECORD_SQL", ["ord_disc"]),
                "number",
                "total_cents",
                "discount_kind",
                "discount_value",
                "discount_reason",
                "status",
            ),
        ).toEqual([
            {
                number: 42,
                total_cents: 12420,
                discount_kind: "percent",
                discount_value: 1000,
                discount_reason: "Loyalty",
                status: "paid",
            },
        ]);
        expect(
            pick(
                run("SALE_LINES_SQL", ["ord_disc"]),
                "id",
                "quantity",
                "amount_cents",
                "discount_kind",
                "discount_value",
                "item_kind",
            ),
        ).toEqual([
            {
                id: "ln_d1",
                quantity: 1,
                amount_cents: 10000,
                discount_kind: "amount",
                discount_value: 1000,
                item_kind: "service",
            },
            {
                id: "ln_d2",
                quantity: 2,
                amount_cents: 4800,
                discount_kind: null,
                discount_value: null,
                item_kind: "product",
            },
        ]);
        expect(
            pick(
                run("SALE_PAYMENTS_SQL", ["ord_disc"]),
                "id",
                "kind",
                "amount_cents",
                "tip_cents",
                "parent_payment_id",
            ),
        ).toEqual([
            {
                id: "pay_d",
                kind: "payment",
                amount_cents: 13920,
                tip_cents: 1500,
                parent_payment_id: null,
            },
            {
                id: "pay_dr",
                kind: "refund",
                amount_cents: 2000,
                tip_cents: null,
                parent_payment_id: "pay_d",
            },
        ]);

        db.run("DELETE FROM entries WHERE journal_id IN ('j_d', 'j_dr')");
        db.run("DELETE FROM payments WHERE id IN ('pay_d', 'pay_dr')");
        db.run("DELETE FROM lines WHERE order_id = 'ord_disc'");
        db.run("DELETE FROM orders WHERE id = 'ord_disc'");
        expect(run("SALES_SQL").map((r) => r.id)).not.toContain("ord_disc");
    });

    it("lists the stranded visits that are still live, in time order", () => {
        expect(run("STRANDED_SQL", [JSON.stringify(["bk_4", "bk_1", "bk_gone"])])).toEqual([
            {
                id: "bk_4",
                starts_at: "2026-07-10T09:00:00Z",
                ends_at: "2026-07-10T10:00:00Z",
                client_name: "ben",
            },
        ]);
        expect(run("STRANDED_SQL", ["[]"])).toEqual([]);
    });
});

it("runs every exported query in this file", ({ task }) => {
    const tests = task.file.tasks.flatMap((t) => (t.type === "suite" ? t.tasks : [t]));
    if (tests.some((test) => test.mode !== "run")) return; // a filtered run skips the check
    const exported = Object.keys(core).filter((k) => k.endsWith("_SQL"));
    expect(exported.filter((k) => !SQL_COVERED.has(k))).toEqual([]);
});
