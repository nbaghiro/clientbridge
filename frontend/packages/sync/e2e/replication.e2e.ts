import { writeFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

const endpoint = process.env.SYNC_TEST_URL;
const tokens = JSON.parse(process.env.SYNC_TEST_TOKENS ?? "{}") as Record<string, string>;

for (const role of ["owner", "admin", "staff", "contractor", "multi", "foreign"]) {
    test(`${role} receives only authorized businesses through the real service`, async ({
        page,
    }) => {
        test.skip(!endpoint, "Run make test-sync for disposable source and PowerSync services");
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
            { endpoint: endpoint ?? "", token: tokens[role] ?? "", role },
        );
        const expected =
            role === "multi"
                ? ["bz_first", "bz_second"]
                : role === "foreign"
                  ? ["bz_foreign"]
                  : ["bz_first"];
        expect(rows.businesses.map((row) => row.id)).toEqual(expected);
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
        expect(rows.hours.map((row) => row.id)).toEqual(hours);
        expect(rows.leakedInvites).toEqual([]);
        expect(rows.leakedProviders).toEqual([]);
        const team =
            role === "foreign"
                ? ["foreign"]
                : ["admin", "contractor", "multi", "owner", "removed", "staff"];
        expect(rows.users).toEqual(team.map((name) => ({ id: `us_${name}`, name })));
        expect(rows.leakedAccounts).toEqual([]);
        for (const row of rows.privateBusiness) {
            const limited =
                role === "staff" ||
                role === "contractor" ||
                (role === "multi" && row.id === "bz_second");
            expect(row.gst_hst_number).toBe(limited ? null : "private-tax-number");
        }
        for (const row of rows.staffPay) {
            const limited =
                role === "staff" ||
                role === "contractor" ||
                (role === "multi" && row.business_id === "bz_second");
            expect(row.rate_cents).toBe(limited ? null : 3456);
        }
    });
}

test("selected-business queries isolate lists, details and aggregate subqueries", async ({
    page,
}) => {
    test.skip(!endpoint, "Run make test-sync for disposable services");
    await page.goto("/");
    const result = await page.evaluate(
        async ({ endpoint, token }) => {
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
                await selectReplicaBusiness(db, "bz_first");
                await selectReplicaBusiness(db, "bz_first");
                const first = await db.getAll(query);
                await selectReplicaBusiness(db, "bz_second");
                const second = await db.getAll(query);
                const foreignDetail = await db.getAll(
                    businessQuery("SELECT id FROM hours WHERE id = ?"),
                    ["av_owner"],
                );
                const role = await db.getAll(
                    businessQuery("SELECT role FROM staff WHERE user_id = 'us_multi'"),
                );
                const plan = await db.getAll(
                    `EXPLAIN QUERY PLAN ${businessQuery("SELECT id FROM hours WHERE staff_id = 'st_second'")}`,
                );
                return { empty, first, second, foreignDetail, role, plan };
            } finally {
                await db.disconnectAndClear();
                await db.close();
            }
        },
        { endpoint: endpoint ?? "", token: tokens.multi ?? "" },
    );
    expect(result.empty).toEqual([]);
    expect(result.first).toEqual([{ id: "bz_first", total: 2 }]);
    expect(result.second).toEqual([{ id: "bz_second", total: 1 }]);
    expect(result.foreignDetail).toEqual([]);
    expect(result.role).toEqual([{ role: "staff" }]);
    expect(JSON.stringify(result.plan)).toContain("INDEX");
});

const model = JSON.parse(process.env.SYNC_TEST_MODEL ?? "{}") as Record<string, string[]>;
const projections = JSON.parse(process.env.SYNC_TEST_PROJECTIONS ?? "{}") as Record<
    string,
    Record<string, string[]>
>;
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
    bookings: ["bk_owner", "bk_staff"],
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
    const buckets = AUDIENCE[role]?.[business] ?? [];
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
        test.skip(!endpoint, "Run make test-sync for disposable source and PowerSync services");
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
            { endpoint: endpoint ?? "", token: tokens[role] ?? "", model },
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
            expect(ids(table), table).toEqual(expected);
        }
        expect(ids("users"), "users").toEqual(EXPECTED_USERS[role]);
    });
}
