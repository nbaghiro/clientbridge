// Money figures derived from the synced ledger; a replica without it (staff) reads NULL or zero.

const CASH_KINDS = "('stripe', 'bank', 'cash')";

/** Net of one account kind's legs booked against an entity, e.g. an invoice's receivable. */
export function subjectNetSql(kind: string, subjectType: string, idExpr: string): string {
    return `(SELECT SUM(le.amount_cents) FROM entries le
        JOIN accounts la ON la.id = le.account_id
        WHERE la.kind = '${kind}' AND le.subject_type = '${subjectType}' AND le.subject_id = ${idExpr})`;
}

/** Cash collected for an entity, net of refunds. */
export function collectedSql(subjectType: string, idExpr: string): string {
    return `COALESCE((SELECT SUM(le.amount_cents) FROM entries le
        JOIN accounts la ON la.id = le.account_id
        WHERE la.kind IN ${CASH_KINDS} AND le.type IN ('payment', 'refund')
          AND le.subject_type = '${subjectType}' AND le.subject_id = ${idExpr}), 0)`;
}

/** A client's lifetime value: cash collected on payments they made, net of refunds. */
export function clientValueSql(clientIdExpr: string): string {
    return `(SELECT SUM(le.amount_cents) FROM entries le
        JOIN accounts la ON la.id = le.account_id
        JOIN payments lp ON lp.id = le.source_id
        WHERE la.kind IN ${CASH_KINDS} AND le.type IN ('payment', 'refund')
          AND lp.client_id = ${clientIdExpr})`;
}

/** The liability still owed on an entity's own account (a gift card's spendable balance). */
export function ownedLiabilitySql(ownerType: string, kind: string, idExpr: string): string {
    return `COALESCE(-(SELECT la.balance_cents FROM accounts la
        WHERE la.owner_type = '${ownerType}' AND la.owner_id = ${idExpr} AND la.kind = '${kind}'), 0)`;
}

/** A booking's deposit state, mirroring the server's derivation from the ledger. */
export function depositStateSql(bookingExpr: string): string {
    return `CASE
        WHEN ${bookingExpr}.deposit_required IS NOT 1 THEN 'none'
        WHEN EXISTS (SELECT 1 FROM entries le WHERE le.ref = 'forfeit:' || ${bookingExpr}.id)
            THEN 'forfeited'
        WHEN -COALESCE(${subjectNetSql("deposit", "booking", `${bookingExpr}.id`)}, 0) > 0
            THEN 'collected'
        WHEN EXISTS (SELECT 1 FROM entries le WHERE le.subject_type = 'booking'
            AND le.subject_id = ${bookingExpr}.id AND le.type = 'refund') THEN 'refunded'
        ELSE 'pending'
    END`;
}
