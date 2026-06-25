// Pure helpers for the in-app debug view (no React) — shared by web + mobile.
import { AppSchema } from "./schema";

/** All synced table names (from the generated AppSchema), alphabetised. */
export const TABLE_NAMES: string[] = AppSchema.tables
    .map((t) => t.name)
    .sort((a, b) => a.localeCompare(b));

export interface TableCount {
    table: string;
    rows: number;
}

/**
 * One `UNION ALL` query returning a live row count per synced table from the local SQLite DB.
 * Drives the debug view's "client state" — what this device actually has on disk.
 */
export function countsQuery(): string {
    return TABLE_NAMES.map((t) => `SELECT '${t}' AS "table", count(*) AS rows FROM "${t}"`).join(
        "\nUNION ALL ",
    );
}
