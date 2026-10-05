// Pure helpers for the in-app debug view (no React) — shared by web + mobile.
import { AppSchema } from "./schema";

export const TABLE_NAMES: string[] = AppSchema.tables
    .map((t) => t.name)
    .sort((a, b) => a.localeCompare(b));

export interface TableCount {
    table: string;
    rows: number;
}

export function countsQuery(): string {
    return TABLE_NAMES.map((t) => `SELECT '${t}' AS "table", count(*) AS rows FROM "${t}"`).join(
        "\nUNION ALL ",
    );
}
