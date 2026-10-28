import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

import { endpoint, fixture, fixtures, jsonEnv, seeded, token } from "./service";

for (const role of ["owner", "admin", "staff", "contractor", "multi", "foreign"]) {
    test(`${role} receives only authorized businesses through the real service`, async ({
        page,
    }) => {
        await page.goto("/");
        const rows = await page.evaluate(
            async ({ endpoint, token, role }) => {
                const { openAuthorizationReplica } = await import("./database");
                const db = await openAuthorizationReplica(
                    `replica-${role}-${crypto.randomUUID()}.db`,
                );
                try {
                    await db.connect({
                        fetchCredentials: () => Promise.resolve({ endpoint, token }),
                        uploadData: () => Promise.resolve(),
                    });
                    await db.waitForFirstSync(AbortSignal.timeout(20_000));
                    return {
                        businesses: await db.getAll<{ id: string }>(
                            "SELECT id FROM businesses ORDER BY id",
                        ),
                        hours: await db.getAll<{ id: string }>("SELECT id FROM hours ORDER BY id"),
                        privateBusiness: await db.getAll<{
                            id: string;
                            gst_hst_number: string | null;
                        }>("SELECT id, gst_hst_number FROM businesses ORDER BY id"),
                        staffPay: await db.getAll<{
                            business_id: string;
                            rate_cents: number | null;
                        }>("SELECT business_id, rate_cents FROM staff ORDER BY id"),
                        leakedInvites: await db.getAll(
                            "SELECT id FROM staff WHERE invite_token IS NOT NULL",
                        ),
                        leakedProviders: await db.getAll(
                            "SELECT id FROM clients WHERE stripe_customer_id IS NOT NULL",
                        ),
                        users: await db.getAll<{ id: string; name: string | null }>(
                            "SELECT id, name FROM users ORDER BY id",
                        ),
                        leakedAccounts: await db.getAll(
                            "SELECT id FROM users WHERE email IS NOT NULL OR phone IS NOT NULL",
                        ),
                    };
                } finally {
                    await db.disconnectAndClear();
                    await db.close();
                }
            },
            { endpoint: endpoint(), token: token(role), role },
        );
        const expected =
            role === "multi"
                ? ["bz_first", "bz_second"]
                : role === "foreign"
                  ? ["bz_foreign"]
                  : ["bz_first"];
        expect(rows.businesses.map((row) => row.id)).toEqual(fixtures(expected));
        const hours =
            role === "multi"
                ? ["av_owner", "av_second", "av_staff"]
                : role === "foreign"
                  ? ["av_foreign"]
                  : role === "staff"
                    ? ["av_staff"]
                    : role === "contractor"
                      ? []
                      : ["av_owner", "av_staff"];
        expect(rows.hours.map((row) => row.id)).toEqual(fixtures(hours));
        expect(rows.leakedInvites).toEqual([]);
        expect(rows.leakedProviders).toEqual([]);
        const team =
            role === "foreign"
                ? ["foreign"]
                : ["admin", "contractor", "multi", "owner", "removed", "staff"];
        expect(rows.users).toEqual(team.map((name) => ({ id: fixture(`us_${name}`), name })));
        expect(rows.leakedAccounts).toEqual([]);
        for (const row of rows.privateBusiness) {
            const limited =
                role === "staff" ||
                role === "contractor" ||
                (role === "multi" && row.id === fixture("bz_second"));
            expect(row.gst_hst_number).toBe(limited ? null : "private-tax-number");
        }
        for (const row of rows.staffPay) {
            const limited =
                role === "staff" ||
                role === "contractor" ||
                (role === "multi" && row.business_id === fixture("bz_second"));
            expect(row.rate_cents).toBe(limited ? null : 3456);
        }
    });
}

test("selected-business queries isolate lists, details and aggregate subqueries", async ({
    page,
}) => {
    await page.goto("/");
    const result = await page.evaluate(
        async ({ endpoint, token, ids }) => {
            const { openReplica, businessQuery, selectReplicaBusiness } =
                await import("./database");
            const db = await openReplica(`scope-${crypto.randomUUID()}.db`);
            try {
                await db.connect({
                    fetchCredentials: () => Promise.resolve({ endpoint, token }),
                    uploadData: () => Promise.resolve(),
                });
                await db.waitForFirstSync(AbortSignal.timeout(20_000));
                const query = businessQuery(
                    "SELECT id, (SELECT count(*) FROM hours) AS total FROM businesses",
                );
                const empty = await db.getAll(query);
                await selectReplicaBusiness(db, ids.first);
                await selectReplicaBusiness(db, ids.first);
                const first = await db.getAll(query);
                await selectReplicaBusiness(db, ids.second);
                const second = await db.getAll(query);
                const foreignDetail = await db.getAll(
                    businessQuery("SELECT id FROM hours WHERE id = ?"),
                    [ids.ownerHours],
                );
                const role = await db.getAll(
                    businessQuery("SELECT role FROM staff WHERE user_id = ?"),
                    [ids.multi],
                );
                const plan = await db.getAll(
                    `EXPLAIN QUERY PLAN ${businessQuery("SELECT id FROM hours WHERE staff_id = ?")}`,
                    [ids.secondStaff],
                );
                return { empty, first, second, foreignDetail, role, plan };
            } finally {
                await db.disconnectAndClear();
                await db.close();
            }
        },
        {
            endpoint: endpoint(),
            token: token("multi"),
            ids: {
                first: fixture("bz_first"),
                second: fixture("bz_second"),
                ownerHours: fixture("av_owner"),
                multi: fixture("us_multi"),
                secondStaff: fixture("st_second"),
            },
        },
    );
    expect(result.empty).toEqual([]);
    expect(result.first).toEqual([{ id: fixture("bz_first"), total: 2 }]);
    expect(result.second).toEqual([{ id: fixture("bz_second"), total: 1 }]);
    expect(result.foreignDetail).toEqual([]);
    expect(result.role).toEqual([{ role: "staff" }]);
    expect(JSON.stringify(result.plan)).toContain("INDEX");
});

test("SYN-E2E-21 a business switch in one tab leaves another tab's choice", async ({ context }) => {
    const [a, b, c] = [await context.newPage(), await context.newPage(), await context.newPage()];
    for (const tab of [a, b, c]) await tab.goto("/");
    const filename = `tabs-scope-${crypto.randomUUID()}.db`;
    const open = (tab: typeof a, key: string) =>
        tab.evaluate(
            async ({ endpoint, token, filename, key }) => {
                const { openReplica, selectBusinessPerTab } = await import("./database");
                selectBusinessPerTab(key);
                const db = await openReplica(filename);
                await db.connect({
                    fetchCredentials: () => Promise.resolve({ endpoint, token }),
                    uploadData: () => Promise.resolve(),
                });
                await db.waitForFirstSync(AbortSignal.timeout(20_000));
                Object.assign(window, { db });
            },
            { endpoint: endpoint(), token: token("multi"), filename, key },
        );
    const choose = (tab: typeof a, business: string) =>
        tab.evaluate(async (business) => {
            const { selectReplicaBusiness } = await import("./database");
            const { db } = window as unknown as {
                db: Parameters<typeof selectReplicaBusiness>[0];
            };
            await selectReplicaBusiness(db, business);
        }, business);
    const chosen = (tab: typeof a) =>
        tab.evaluate(async () => {
            const { businessQuery, keepTabBusiness, selectionQuery } = await import("./database");
            const { db } = window as unknown as { db: Parameters<typeof keepTabBusiness>[0] };
            const [sql, parameters] = selectionQuery();
            const row = await db.getOptional<{ business_id: string }>(sql, parameters);
            if (row) await keepTabBusiness(db, row.business_id);
            const scoped = await db.getAll<{ id: string }>(
                businessQuery("SELECT id FROM businesses"),
            );
            return { selected: row?.business_id ?? null, scoped: scoped.map((r) => r.id) };
        });
    await open(a, "tab-a");
    await open(b, "tab-b");
    const [first, second] = [fixture("bz_first"), fixture("bz_second")];
    await choose(a, first);
    expect(await chosen(b)).toEqual({ selected: first, scoped: [first] });
    await choose(a, second);
    expect(await chosen(a)).toEqual({ selected: second, scoped: [second] });
    expect(await chosen(b)).toEqual({ selected: first, scoped: [first] });
    // a new tab starts from the last choice made in any tab
    await open(c, "tab-c");
    expect(await chosen(c)).toEqual({ selected: second, scoped: [second] });
    await a.evaluate(async () => {
        const { db } = window as unknown as {
            db: { disconnectAndClear: () => Promise<void>; close: () => Promise<void> };
        };
        await db.disconnectAndClear();
        await db.close();
    });
});

test("SYN-E2E-26 a stray write to a synced table is dropped and the next checkpoint restores the row", async ({
    page,
}) => {
    await page.goto("/");
    const result = await page.evaluate(
        async ({ endpoint, token, business }) => {
            const { openReplica, discardDirectWrites } = await import("./database");
            const db = await openReplica(`stray-${crypto.randomUUID()}.db`);
            try {
                await db.connect({
                    fetchCredentials: () => Promise.resolve({ endpoint, token }),
                    uploadData: discardDirectWrites,
                });
                await db.waitForFirstSync(AbortSignal.timeout(20_000));
                const name = async () =>
                    (
                        await db.get<{ name: string }>("SELECT name FROM businesses WHERE id = ?", [
                            business,
                        ])
                    ).name;
                const original = await name();
                await db.execute("UPDATE businesses SET name = 'stray' WHERE id = ?", [business]);
                const deadline = Date.now() + 15_000;
                let restored = await name();
                while (restored !== original && Date.now() < deadline) {
                    await new Promise((resolve) => setTimeout(resolve, 200));
                    restored = await name();
                }
                const queued = await db.getAll("SELECT id FROM ps_crud");
                const dropped = await db.getOptional<{ value: string }>(
                    "SELECT value FROM device_prefs WHERE id = 'sync.droppedWrites'",
                );
                return { original, restored, queued: queued.length, dropped: dropped?.value };
            } finally {
                await db.disconnectAndClear();
                await db.close();
            }
        },
        { endpoint: endpoint(), token: token("owner"), business: fixture("bz_first") },
    );
    expect(result.restored).toBe(result.original);
    expect(result.queued).toBe(0);
    expect(result.dropped).toBe(JSON.stringify([`PATCH businesses ${fixture("bz_first")}`]));
});

async function historyPages(): Promise<{ visits: string[]; messages: string[] }> {
    const python = process.env.SYNC_TEST_PYTHON;
    const cwd = process.env.SYNC_TEST_BACKEND;
    if (!python || !cwd) throw new Error("SYNC_TEST_PYTHON is not set: run make test-sync");
    const { stdout } = await promisify(execFile)(python, ["-m", "e2e.sync", "history"], { cwd });
    return JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as {
        visits: string[];
        messages: string[];
    };
}

test("SYN-E2E-29 visits and messages at the history window's start appear exactly once across the replica and the API", async ({
    page,
}) => {
    await page.goto("/");
    const replica = await page.evaluate(
        async ({ endpoint, token }) => {
            const { openReplica, subscribeHistory } = await import("./database");
            const db = await openReplica(`history-${crypto.randomUUID()}.db`);
            try {
                const history = await subscribeHistory(db);
                await db.connect({
                    fetchCredentials: () => Promise.resolve({ endpoint, token }),
                    uploadData: () => Promise.resolve(),
                });
                await Promise.all(
                    history.map((stream) => stream.waitForFirstSync(AbortSignal.timeout(20_000))),
                );
                const ids = async (table: string) =>
                    (
                        await db.getAll<{ id: string }>(
                            `SELECT id FROM ${table} WHERE id LIKE '%_edge_%' ORDER BY id`,
                        )
                    ).map((row) => row.id);
                return { visits: await ids("bookings"), messages: await ids("messages") };
            } finally {
                await db.disconnectAndClear();
                await db.close();
            }
        },
        { endpoint: endpoint(), token: token("owner") },
    );
    const api = await historyPages();
    const edges = ["before", "at", "after"];
    for (const [kind, prefix] of [
        ["visits", "bk_edge"],
        ["messages", "ms_edge"],
    ] as const) {
        const seen = [...replica[kind], ...api[kind]].filter((id) => id.includes("_edge_"));
        expect(seen.sort()).toEqual(fixtures(edges.map((edge) => `${prefix}_${edge}`)).sort());
        expect(api[kind].filter((id) => id.includes("_edge_"))).toEqual(
            fixtures([`${prefix}_before`]),
        );
    }
});

const FULL = [
    "business_shared",
    "business_full",
    "staff_self",
    "history_shared",
    "history_self",
    "history_full",
];
const LIMITED = [
    "business_shared",
    "staff_limited",
    "staff_self",
    "history_shared",
    "history_self",
];
// which buckets each identity receives in each business it belongs to
const AUDIENCE: Record<string, Record<string, string[]>> = {
    owner: { bz_first: FULL },
    admin: { bz_first: FULL },
    staff: { bz_first: LIMITED },
    contractor: { bz_first: LIMITED },
    multi: { bz_first: FULL, bz_second: LIMITED },
    foreign: { bz_foreign: FULL },
};
const OWNER_ROWS = {
    // the history window starts at bk_edge_at; bk_edge_before and bk_archive are read from the API
    bookings: ["bk_edge_after", "bk_edge_at", "bk_owner", "bk_staff"],
    invoices: ["inv_first"],
    payments: ["pay_first"],
    entries: ["en_0", "en_1"],
    orders: ["ord_first"],
    lines: ["ln_pickup"],
};
const FIRST_TEAM = ["us_admin", "us_contractor", "us_multi", "us_owner", "us_removed", "us_staff"];
const EXPECTED_USERS: Record<string, string[]> = {
    owner: FIRST_TEAM,
    admin: FIRST_TEAM,
    staff: FIRST_TEAM,
    contractor: FIRST_TEAM,
    multi: FIRST_TEAM,
    foreign: ["us_foreign"],
};
const EXPECTED_ROWS: Record<string, Record<string, string[]>> = {
    owner: OWNER_ROWS,
    admin: OWNER_ROWS,
    multi: OWNER_ROWS,
    staff: {
        bookings: ["bk_staff"],
        invoices: [],
        payments: [],
        entries: ["en_0"],
        orders: [],
        lines: ["ln_pickup"],
    },
    contractor: {
        bookings: [],
        invoices: [],
        payments: [],
        entries: [],
        orders: [],
        lines: ["ln_pickup"],
    },
    foreign: { bookings: [], invoices: [], payments: [], entries: [], orders: [], lines: [] },
};

function allowed(role: string, business: string, table: string): Set<string> {
    const projections = jsonEnv("SYNC_TEST_PROJECTIONS") as Record<
        string,
        Record<string, string[]>
    >;
    const buckets = AUDIENCE[role]?.[seeded(business)] ?? [];
    return new Set(["id", ...buckets.flatMap((bucket) => projections[bucket]?.[table] ?? [])]);
}

// a user row carries no business; it reaches a device through any business the role belongs to
function allowedUser(role: string): Set<string> {
    return new Set(
        Object.keys(AUDIENCE[role] ?? {}).flatMap((business) => [
            ...allowed(role, business, "users"),
        ]),
    );
}

for (const role of Object.keys(AUDIENCE)) {
    test(`${role} receives no column outside its reviewed projection in any synced table`, async ({
        page,
    }) => {
        await page.goto("/");
        const tables = await page.evaluate(
            async ({ endpoint, token, model }) => {
                const { openModelReplica, subscribeHistory } = await import("./database");
                const db = await openModelReplica(`model-${crypto.randomUUID()}.db`, model);
                try {
                    const history = await subscribeHistory(db);
                    await db.connect({
                        fetchCredentials: () => Promise.resolve({ endpoint, token }),
                        uploadData: () => Promise.resolve(),
                    });
                    await db.waitForFirstSync(AbortSignal.timeout(20_000));
                    await Promise.all(
                        history.map((s) => s.waitForFirstSync(AbortSignal.timeout(20_000))),
                    );
                    const out: Record<string, Record<string, unknown>[]> = {};
                    for (const table of Object.keys(model)) {
                        out[table] = await db.getAll(`SELECT * FROM ${table} ORDER BY id`);
                    }
                    return out;
                } finally {
                    await db.disconnectAndClear();
                    await db.close();
                }
            },
            {
                endpoint: endpoint(),
                token: token(role),
                model: jsonEnv("SYNC_TEST_MODEL") as Record<string, string[]>,
            },
        );
        const dump = process.env.SYNC_TEST_DUMP;
        if (dump) writeFileSync(`${dump}/${role}.json`, JSON.stringify(tables, null, 1));
        const leaks: string[] = [];
        for (const [table, rows] of Object.entries(tables)) {
            for (const row of rows) {
                const business = String(table === "businesses" ? row.id : row.business_id);
                const permitted =
                    table === "users" ? allowedUser(role) : allowed(role, business, table);
                if (permitted.size === 1)
                    leaks.push(`${table}.${String(row.id)} row from ${business}`);
                for (const [name, value] of Object.entries(row)) {
                    if (value !== null && !permitted.has(name))
                        leaks.push(`${table}.${String(row.id)}.${name}`);
                }
            }
        }
        expect(leaks).toEqual([]);
        const ids = (table: string) => (tables[table] ?? []).map((row) => String(row.id));
        for (const [table, expected] of Object.entries(EXPECTED_ROWS[role] ?? {})) {
            expect(ids(table), table).toEqual(fixtures(expected));
        }
        expect(ids("users"), "users").toEqual(fixtures(EXPECTED_USERS[role] ?? []));
    });
}
