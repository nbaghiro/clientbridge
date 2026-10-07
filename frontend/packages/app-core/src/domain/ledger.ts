// Money figures derived from the synced ledger; a replica without it (staff) reads NULL or zero.

const CASH_CATEGORIES = "('stripe', 'bank', 'cash')";

/** Net of one account category's legs booked against an entity, e.g. an invoice's receivable. */
export function subjectNetSql(category: string, subjectType: string, idExpr: string): string {
    return `(SELECT SUM(le.amount_cents) FROM entries le
        JOIN accounts la ON la.id = le.account_id
        WHERE la.category = '${category}' AND le.subject_type = '${subjectType}' AND le.subject_id = ${idExpr})`;
}

/** Cash collected for an entity, net of refunds. */
export function collectedSql(subjectType: string, idExpr: string): string {
    return `COALESCE((SELECT SUM(le.amount_cents) FROM entries le
        JOIN accounts la ON la.id = le.account_id
        WHERE la.category IN ${CASH_CATEGORIES} AND le.event IN ('payment', 'refund')
          AND le.subject_type = '${subjectType}' AND le.subject_id = ${idExpr}), 0)`;
}

/** A client's lifetime value: cash collected on payments they made, net of refunds. */
export function clientValueSql(clientIdExpr: string): string {
    return `(SELECT SUM(le.amount_cents) FROM entries le
        JOIN accounts la ON la.id = le.account_id
        JOIN payments lp ON lp.id = le.source_id
        WHERE la.category IN ${CASH_CATEGORIES} AND le.event IN ('payment', 'refund')
          AND lp.client_id = ${clientIdExpr})`;
}

/** The liability still owed on an entity's own account (a gift card's spendable balance). */
export function ownedLiabilitySql(ownerType: string, category: string, idExpr: string): string {
    return `COALESCE(-(SELECT la.balance_cents FROM accounts la
        WHERE la.owner_type = '${ownerType}' AND la.owner_id = ${idExpr} AND la.category = '${category}'), 0)`;
}

/** An invoice stores draft/sent/void; how far a sent one is paid is read off the ledger. */
export function invoiceStatusSql(alias: string): string {
    const paid = collectedSql("invoice", `${alias}.id`);
    const owed = `COALESCE(${subjectNetSql("receivable", "invoice", `${alias}.id`)}, 0)`;
    return `CASE
        WHEN ${alias}.status IN ('draft', 'void') THEN ${alias}.status
        WHEN ${paid} <= 0 AND ${refundedSql("invoice", `${alias}.id`)} AND ${owed} <= 0 THEN 'refunded'
        WHEN ${owed} <= 0 THEN 'paid'
        WHEN ${paid} > 0 THEN 'partial'
        WHEN ${alias}.overdue_notified_at IS NOT NULL THEN 'overdue'
        ELSE 'sent' END`;
}

/** An order stores open/void; whether it is paid or refunded is read off the ledger. */
export function orderStatusSql(alias: string): string {
    const paid = collectedSql("order", `${alias}.id`);
    // a visit deposit the sale's payment applied counts toward it; its legs belong to the booking
    const covered = `(${paid} + COALESCE((SELECT SUM(le.amount_cents) FROM entries le
        JOIN accounts la ON la.id = le.account_id JOIN payments lp ON lp.id = le.source_id
        WHERE la.category = 'deposit' AND le.event = 'payment' AND le.source_type = 'payment'
          AND lp.order_id = ${alias}.id), 0))`;
    const refunded = refundedSql("order", `${alias}.id`);
    return `CASE
        WHEN ${alias}.status = 'void' THEN 'void'
        WHEN ${paid} <= 0 AND ${refunded} THEN 'refunded'
        WHEN ${covered} > 0 AND (${covered} >= ${alias}.total_cents OR ${refunded}) THEN 'paid'
        ELSE 'open' END`;
}

/** Sessions used on a package: one consumption journal each. */
export function sessionsUsedSql(idExpr: string): string {
    return `(SELECT COUNT(DISTINCT le.journal_id) FROM entries le
        WHERE le.event = 'consumption' AND le.subject_type = 'package' AND le.subject_id = ${idExpr})`;
}

function refundedSql(subjectType: string, idExpr: string): string {
    return `EXISTS (SELECT 1 FROM entries le JOIN accounts la ON la.id = le.account_id
        WHERE la.category IN ${CASH_CATEGORIES} AND le.event = 'refund'
          AND le.subject_type = '${subjectType}' AND le.subject_id = ${idExpr})`;
}
