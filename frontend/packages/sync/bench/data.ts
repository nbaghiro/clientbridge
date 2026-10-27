import { ColumnType, type Schema } from "@powersync/common";

export const BUSINESS = "bz_demo_second";

// Synced rows of Cedar Coast Pet Care, the largest core business, in the seed snapshot of 2026-10-27.
export const COUNTS: Record<string, number> = {
    entries: 16351,
    bookings: 2024,
    lines: 1624,
    slots: 1431,
    payments: 1079,
    invoices: 1064,
    messages: 94,
    consents: 80,
    accounts: 73,
    inventory: 71,
    responses: 60,
    notes: 57,
    signatures: 57,
    subjects: 57,
    clients: 53,
    threads: 47,
    files: 37,
    fields: 29,
    hours: 22,
    items: 13,
    recurrences: 7,
    review_requests: 6,
    staff: 4,
    users: 4,
    forms: 3,
    broadcasts: 2,
    contracts: 2,
    gift_cards: 2,
    payment_methods: 2,
    subscriptions: 2,
    businesses: 1,
    estimates: 1,
    orders: 1,
    packages: 1,
};

export const TOTAL = Object.values(COUNTS).reduce((sum, n) => sum + n, 0);

const REFERENCES: Record<string, string> = {
    client: "clients",
    subject: "subjects",
    item: "items",
    staff: "staff",
    user: "users",
    slot: "slots",
    invoice: "invoices",
    estimate: "estimates",
    order: "orders",
    package: "packages",
    thread: "threads",
    account: "accounts",
    form: "forms",
    payment: "payments",
    recurrence: "recurrences",
    broadcast: "broadcasts",
    contract: "contracts",
    payment_method: "payment_methods",
};

const WORDS =
    "walk sit dog cat leash park feed water visit keys deposit invoice paid card cash reminder confirmed thanks see you soon gate treat".split(
        " ",
    );

const ULID = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function random(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export type Value = string | number | null;

export interface Row {
    id: string;
    data: Record<string, Value>;
}

export function buildRows(schema: Schema, seed = 42): Record<string, Row[]> {
    const next = random(seed);
    const pick = <T>(list: readonly T[]): T => {
        const value = list[Math.floor(next() * list.length)];
        if (value === undefined) throw new Error("pick from an empty list");
        return value;
    };
    const words = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join(" ");
    const ulid = (prefix: string) =>
        `${prefix}_${Array.from({ length: 26 }, () => ULID.charAt(Math.floor(next() * ULID.length))).join("")}`;
    const ids: Record<string, string[]> = {};
    for (const [table, n] of Object.entries(COUNTS)) {
        ids[table] = Array.from({ length: n }, () => ulid(table.slice(0, 3)));
    }
    const base = Date.parse("2026-10-13T17:00:00Z");
    const iso = () => new Date(base - Math.floor(next() * 400 * 86_400_000)).toISOString();
    const tables = new Map(schema.tables.map((table) => [table.name, table]));
    const out: Record<string, Row[]> = {};
    for (const [table, n] of Object.entries(COUNTS)) {
        const definition = tables.get(table);
        if (!definition) throw new Error(`table ${table} is not in the schema`);
        const rows: Row[] = [];
        const own = ids[table] ?? [];
        for (let i = 0; i < n; i++) {
            const data: Record<string, Value> = {};
            for (const { name, type } of definition.columns) {
                const referenced = ids[REFERENCES[name.slice(0, -3)] ?? ""];
                if (name === "business_id") data[name] = BUSINESS;
                else if (name.endsWith("_id") && referenced?.length) data[name] = pick(referenced);
                else if (name.endsWith("_id")) data[name] = next() < 0.5 ? null : ulid("x");
                else if (name.endsWith("_at") || name === "date")
                    data[name] = next() < 0.2 ? null : iso();
                else if (name === "body" || name === "description" || name === "meta")
                    data[name] = words(20 + Math.floor(next() * 30));
                else if (name === "currency") data[name] = "CAD";
                else if (type === ColumnType.INTEGER) data[name] = Math.floor(next() * 20000);
                else if (type === ColumnType.REAL) data[name] = next() * 100;
                else data[name] = words(1 + Math.floor(next() * 3));
            }
            rows.push({ id: own[i] ?? ulid(table), data });
        }
        out[table] = rows;
    }
    return out;
}
