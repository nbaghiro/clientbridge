import type { CommonPowerSyncDatabase } from "@powersync/common";
import { AppSchema } from "./schema";

const selection = "(SELECT business_id FROM main.business_selection WHERE id = 'current')";
const tables = AppSchema.tables.filter(
    (table) =>
        !table.localOnly &&
        (table.name === "businesses" ||
            table.columns.some((column) => column.name === "business_id")),
);
const scope = tables
    .map((table) => {
        const key = table.name === "businesses" ? "id" : "business_id";
        return `"${table.name}" AS (SELECT * FROM main."${table.name}" WHERE ${key} = ${selection})`;
    })
    .join(", ");

export function businessQuery(sql: string): string {
    const trimmed = sql.trimStart();
    if (/^WITH\s+RECURSIVE\s/i.test(trimmed))
        return `WITH RECURSIVE ${scope}, ${trimmed.replace(/^WITH\s+RECURSIVE\s/i, "")}`;
    if (/^WITH\s/i.test(trimmed)) return `WITH ${scope}, ${trimmed.replace(/^WITH\s/i, "")}`;
    return `WITH ${scope} ${sql}`;
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
        await tx.execute("DELETE FROM business_selection WHERE id = 'current'");
        await tx.execute("INSERT INTO business_selection (id, business_id) VALUES ('current', ?)", [
            businessId,
        ]);
    });
}
