import type { CommonPowerSyncDatabase } from "@powersync/common";
import { AppSchema } from "./schema";

const SHARED = "current";
// the row of business_selection this page reads: its own on web, so a choice in one tab leaves the others
let own = SHARED;

/** Keeps this tab's business choice apart from other tabs'; the shared row seeds a new tab's choice. */
export function selectBusinessPerTab(key: string): void {
    if (!/^[a-z0-9-]{1,64}$/.test(key)) throw new Error("invalid selection key");
    own = key;
    scopes.clear();
}

/** This tab's chosen business: its own row, or the shared one until it has one. */
export function selectionQuery(): [string, string[]] {
    return [
        "SELECT business_id FROM business_selection WHERE id IN (?, ?) ORDER BY id = ? LIMIT 1",
        [own, SHARED, SHARED],
    ];
}

const tables = AppSchema.tables.filter(
    (table) =>
        !table.localOnly &&
        (table.name === "businesses" ||
            table.columns.some((column) => column.name === "business_id")),
);
const scopes = new Map<string, string>();

function scope(): string {
    const cached = scopes.get(own);
    if (cached !== undefined) return cached;
    const selection =
        own === SHARED
            ? `(SELECT business_id FROM main.business_selection WHERE id = '${SHARED}')`
            : `(SELECT business_id FROM main.business_selection WHERE id IN ('${own}', '${SHARED}') ORDER BY id = '${SHARED}' LIMIT 1)`;
    const built = tables
        .map((table) => {
            const key = table.name === "businesses" ? "id" : "business_id";
            return `"${table.name}" AS (SELECT * FROM main."${table.name}" WHERE ${key} = ${selection})`;
        })
        .join(", ");
    scopes.set(own, built);
    return built;
}

export function businessQuery(sql: string): string {
    const scoped = scope();
    const trimmed = sql.trimStart();
    if (/^WITH\s+RECURSIVE\s/i.test(trimmed))
        return `WITH RECURSIVE ${scoped}, ${trimmed.replace(/^WITH\s+RECURSIVE\s/i, "")}`;
    if (/^WITH\s/i.test(trimmed)) return `WITH ${scoped}, ${trimmed.replace(/^WITH\s/i, "")}`;
    return `WITH ${scoped} ${sql}`;
}

export async function selectReplicaBusiness(
    db: CommonPowerSyncDatabase,
    businessId: string,
): Promise<void> {
    await db.writeTransaction(async (tx) => {
        const business = await tx.getOptional("SELECT id FROM businesses WHERE id = ?", [
            businessId,
        ]);
        if (!business) throw new Error("business is no longer available on this device");
        for (const id of new Set([own, SHARED])) {
            await tx.execute("DELETE FROM business_selection WHERE id = ?", [id]);
            await tx.execute("INSERT INTO business_selection (id, business_id) VALUES (?, ?)", [
                id,
                businessId,
            ]);
        }
    });
}

/** Gives a tab that followed the shared choice a row of its own, so another tab's switch leaves it. */
export async function keepTabBusiness(
    db: CommonPowerSyncDatabase,
    businessId: string,
): Promise<void> {
    if (own === SHARED) return;
    await db.writeTransaction(async (tx) => {
        const kept = await tx.getOptional("SELECT id FROM business_selection WHERE id = ?", [own]);
        if (!kept)
            await tx.execute("INSERT INTO business_selection (id, business_id) VALUES (?, ?)", [
                own,
                businessId,
            ]);
    });
}
