import { AppSchema, businessQuery } from "@clientbridge/sync";
import initSqlJs, { type Database, type SqlValue } from "sql.js";
import { beforeAll, describe, expect, it } from "vitest";

import { addDays, parseDateKey, parseTimestamp } from "./datetime";
import { AWAY_SQL, EVENTS_SQL } from "./domain/bookings";
import { CLASS_ROSTER_SQL, CLASS_SESSIONS_SQL } from "./domain/classes";
import { FEES_SINCE_SQL } from "./domain/payouts";
import { CHECKOUT_QUEUE_SQL } from "./domain/pos";
import { AGENDA_SQL } from "./domain/today";

type Row = Record<string, SqlValue>;

const STORED = [
    (iso: string) => iso.replace("T", " ").replace(".000Z", "Z"),
    (iso: string) => iso.replace("T", " ").replace(".000Z", ".123456Z"),
    (iso: string) => iso.replace("T", " ").replace(".000Z", "+00"),
    (iso: string) => iso.replace(".000Z", "Z"),
    (iso: string) => iso,
];
const BLOCKS = [Date.UTC(2026, 9, 20), Date.UTC(2027, 2, 1)];
const PER_BLOCK = 1500;
const MIN = 60_000;

let db: Database;

// The views and expression indexes PowerSync creates for each synced table.
function createReplica(): void {
    for (const table of AppSchema.tables) {
        const raw = table.localOnly ? `ps_data_local__${table.name}` : `ps_data__${table.name}`;
        const value = (name: string): string => {
            const type = table.columns.find((c) => c.name === name)?.type ?? "TEXT";
            return `CAST(json_extract(data, '$.${name}') as ${type})`;
        };
        const names = table.columns.map((c) => c.name);
        db.run(`CREATE TABLE ${raw} (id TEXT PRIMARY KEY NOT NULL, data TEXT)`);
        db.run(
            `CREATE VIEW "${table.name}"("id", ${names.map((n) => `"${n}"`).join(", ")}) AS SELECT id, ${names.map(value).join(", ")} FROM ${raw}`,
        );
        for (const index of table.indexes) {
            const columns = index.columns.map((c) => value(c.name)).join(", ");
            db.run(`CREATE INDEX "${raw}__${index.name}" ON ${raw} (${columns})`);
        }
    }
}

function put(table: string, id: string, data: Record<string, SqlValue>): void {
    const raw = table === "business_selection" ? "ps_data_local__" : "ps_data__";
    db.run(`INSERT INTO ${raw}${table} (id, data) VALUES (?, ?)`, [id, JSON.stringify(data)]);
}

function seed(): void {
    const biz = { business_id: "bz_1" };
    put("business_selection", "current", biz);
    put("businesses", "bz_1", { name: "Birch" });
    put("items", "it_cut", { ...biz, name: "Cut", kind: "service", price_cents: 100 });
    put("items", "it_class", { ...biz, name: "Class", kind: "service", price_cents: 100 });
    put("clients", "cl_ann", { ...biz, name: "Ann", status: "active" });
    put("accounts", "ac_fee", { ...biz, owner_type: "business", category: "processing_fee" });
    BLOCKS.forEach((origin, block) => {
        for (let i = 0; i < PER_BLOCK; i++) {
            const n = block * PER_BLOCK + i;
            const stored = STORED[n % STORED.length];
            if (stored === undefined) throw new Error("no stored format");
            const start = new Date(origin + i * 45 * MIN);
            const minutes = n % 97 === 0 ? 26 * 60 : n % 3 === 0 ? 90 : 60;
            const at = (d: Date): string => stored(d.toISOString());
            const startsAt = at(start);
            const endsAt = at(new Date(start.getTime() + minutes * MIN));
            const kind = n % 20 === 0;
            put("slots", `sl_${String(n)}`, {
                ...biz,
                starts_at: startsAt,
                ends_at: endsAt,
                staff_id: n % 2 === 0 ? "st_a" : "st_b",
                capacity: kind ? 4 : 1,
                status: n % 17 === 0 ? "canceled" : "scheduled",
                item_id: kind ? "it_class" : "it_cut",
            });
            put("bookings", `bk_${String(n)}`, {
                ...biz,
                slot_id: `sl_${String(n)}`,
                client_id: "cl_ann",
                status: n % 11 === 0 ? "canceled" : "confirmed",
                starts_at: startsAt,
                created_at: startsAt,
            });
            if (n % 4 === 0)
                put("addons", `ad_${String(n)}`, { ...biz, booking_id: `bk_${String(n)}` });
            if (n % 6 === 0)
                put("entries", `en_${String(n)}`, {
                    ...biz,
                    account_id: "ac_fee",
                    amount_cents: -30,
                    occurred_at: startsAt,
                });
            if (n % 50 === 0)
                put("hours", `ho_${String(n)}`, {
                    ...biz,
                    basis: "exception",
                    staff_id: n % 100 === 0 ? null : "st_a",
                    starts_at: startsAt,
                    ends_at: at(
                        new Date(start.getTime() + (n % 150 === 0 ? 20 * 1440 : 240) * MIN),
                    ),
                    reason: "Away",
                });
        }
    });
}

function all(sql: string, params: SqlValue[]): Row[] {
    const stmt = db.prepare(businessQuery(sql));
    stmt.bind(params);
    const out: Row[] = [];
    while (stmt.step()) out.push(stmt.getAsObject());
    stmt.free();
    return out;
}

function plan(sql: string, params: SqlValue[]): string {
    const rows = db.exec(`EXPLAIN QUERY PLAN ${businessQuery(sql)}`, params)[0]?.values ?? [];
    return rows.map((r) => String(r[3])).join("\n");
}

function table(name: string): Row[] {
    return all(`SELECT * FROM ${name}`, []);
}

// SQLite's datetime() drops sub-seconds, so the reference compares whole seconds too.
function instant(value: SqlValue | undefined): Date {
    if (typeof value !== "string")
        throw new Error(`expected a stored timestamp, got ${String(value)}`);
    return new Date(Math.floor(parseTimestamp(value).getTime() / 1000) * 1000);
}
const ids = (rows: Row[], key: string): string[] => [...new Set(rows.map((r) => String(r[key])))];
const sorted = (values: string[]): string[] => [...values].sort();

// Each local day across a daylight-saving change, as [start, end) instants.
function days(zone: string, first: string, count: number): [string, string][] {
    const start = parseDateKey(first, zone);
    if (start === null) throw new Error(first);
    return Array.from({ length: count }, (_, i) => [
        addDays(start, i, zone).toISOString(),
        addDays(start, i + 1, zone).toISOString(),
    ]);
}

const ZONES = ["America/Vancouver", "America/Halifax", "Asia/Tokyo"];
const WINDOWS = ZONES.flatMap((zone) => [
    ...days(zone, "2026-10-29", 6),
    ...days(zone, "2027-03-11", 6),
]);
const INDEXED = "USING INDEX ps_data__slots__slots_business_start (<expr><?)";

beforeAll(async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    createReplica();
    db.run("BEGIN");
    seed();
    db.run("COMMIT");
    db.run("PRAGMA optimize=0x10002");
});

describe("range queries on the synced replica", () => {
    it("serve every slot range from the starts_at index", () => {
        const [lo, hi] = ["2026-10-30T07:00:00.000Z", "2026-11-06T07:00:00.000Z"];
        expect(plan(EVENTS_SQL, [hi, lo])).toContain(INDEXED);
        expect(plan(AGENDA_SQL, [hi, lo])).toContain(INDEXED);
        expect(plan(CLASS_SESSIONS_SQL, [lo, hi])).toContain(INDEXED);
        expect(plan(CLASS_ROSTER_SQL, [lo, hi])).toContain(INDEXED);
        expect(plan(CHECKOUT_QUEUE_SQL, [lo, hi])).toContain(
            "USING INDEX ps_data__slots__slots_business_start (<expr>>? AND <expr><?)",
        );
        expect(plan(AWAY_SQL, [hi, lo])).toContain(
            "USING INDEX ps_data__hours__hours_exception (<expr>=? AND <expr><?)",
        );
        expect(plan(FEES_SINCE_SQL, [lo])).toContain(
            "USING INDEX ps_data__entries__entries_account (<expr>=? AND <expr>>?)",
        );
    });

    it("counts a visit's add-ons through the booking index", () => {
        const [lo, hi] = ["2026-10-30T07:00:00.000Z", "2026-11-06T07:00:00.000Z"];
        expect(plan(EVENTS_SQL, [hi, lo])).toContain(
            "USING INDEX ps_data__addons__addons_booking (<expr>=?)",
        );
    });

    it("finds exactly the overlapping slots in every stored format across daylight-saving days", () => {
        const slots = table("slots").map((s) => ({
            id: String(s.id),
            start: instant(s.starts_at),
            end: instant(s.ends_at),
            live: s.status !== "canceled",
            classSession: Number(s.capacity) > 1,
        }));
        const bookings = new Map(table("bookings").map((b) => [String(b.slot_id), b.status]));
        let crossing = 0;
        for (const [lo, hi] of WINDOWS) {
            const [from, to] = [new Date(lo), new Date(hi)];
            const overlap = slots.filter((s) => s.live && s.start < to && s.end > from);
            crossing += overlap.filter((s) => s.start < from).length;
            expect(sorted(ids(all(EVENTS_SQL, [hi, lo]), "slot_id"))).toEqual(
                sorted(overlap.map((s) => s.id)),
            );
            expect(sorted(ids(all(AGENDA_SQL, [hi, lo]), "slot_id"))).toEqual(
                sorted(overlap.map((s) => s.id)),
            );
            expect(sorted(ids(all(CLASS_SESSIONS_SQL, [lo, hi]), "slot_id"))).toEqual(
                sorted(overlap.filter((s) => s.classSession).map((s) => s.id)),
            );
            const starting = slots.filter(
                (s) => s.start >= from && s.start < to && bookings.get(s.id) !== "canceled",
            );
            expect(
                sorted(all(CHECKOUT_QUEUE_SQL, [lo, hi]).map((r) => String(r.booking_id))),
            ).toEqual(sorted(starting.map((s) => s.id.replace("sl_", "bk_"))));
        }
        expect(crossing).toBeGreaterThan(0);
    });

    it("keeps time off that began well before the range", () => {
        const away = table("hours").map((h) => ({
            id: String(h.id),
            start: instant(h.starts_at),
            end: instant(h.ends_at),
        }));
        let long = 0;
        for (const [lo, hi] of WINDOWS) {
            const [from, to] = [new Date(lo), new Date(hi)];
            const overlap = away.filter((h) => h.start < to && h.end > from);
            long += overlap.filter((h) => to.getTime() - h.start.getTime() > 7 * 1440 * MIN).length;
            expect(sorted(ids(all(AWAY_SQL, [hi, lo]), "id"))).toEqual(
                sorted(overlap.map((h) => h.id)),
            );
        }
        expect(long).toBeGreaterThan(0);
    });
});
