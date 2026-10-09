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

test("rejected intent is durable before acknowledgement and service restores authoritative rows", async ({
    page,
}) => {
    test.skip(!endpoint, "Run make test-sync for disposable services");
    await page.goto("/");
    const result = await page.evaluate(
        async ({ endpoint, token }) => {
            const { openReplica } = await import("./database");
            const filename = `rejection-${crypto.randomUUID()}.db`;
            const db = await openReplica(filename);
            const connector = {
                fetchCredentials: () => Promise.resolve({ endpoint, token }),
                uploadData: () => Promise.resolve(),
            };
            await db.connect(connector);
            await db.waitForFirstSync(AbortSignal.timeout(20_000));
            await db.disconnect();
            await db.execute("UPDATE hours SET note = 'rejected' WHERE id = 'av_owner'");
            await db.execute("UPDATE hours SET note = 'dependent' WHERE id = 'av_owner'");
            await db.execute("UPDATE hours SET note = 'independent' WHERE id = 'av_staff'");
            const held = [];
            for await (const tx of db.getCrudTransactions()) {
                held.push({ id: tx.transactionId, crud: tx.crud });
            }
            await db.execute("INSERT INTO device_prefs (id, value) VALUES (?, ?)", [
                "rejected",
                JSON.stringify(held),
            ]);
            await db.close();
            const reopened = await openReplica(filename);
            const durable = await reopened.get<{ value: string }>(
                "SELECT value FROM device_prefs WHERE id = 'rejected'",
            );
            const countBefore = (await reopened.getUploadQueueStats()).count;
            let pending = await reopened.getNextCrudTransaction();
            while (pending) {
                await pending.complete();
                pending = await reopened.getNextCrudTransaction();
            }
            await reopened.connect(connector);
            const deadline = Date.now() + 10_000;
            let notes: { note: string }[] = [];
            while (Date.now() < deadline) {
                notes = await reopened.getAll<{ note: string }>(
                    "SELECT note FROM hours ORDER BY id",
                );
                if (notes.every((row) => row.note === "server baseline")) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            const result = { durable: JSON.parse(durable.value) as unknown[], countBefore, notes };
            await reopened.disconnectAndClear();
            await reopened.close();
            return result;
        },
        { endpoint: endpoint ?? "", token: tokens.owner ?? "" },
    );
    expect(result.countBefore).toBe(3);
    expect(result.durable).toHaveLength(3);
    expect(result.notes).toEqual([{ note: "server baseline" }, { note: "server baseline" }]);
});

test("transport outage preserves offline work through reconnection", async ({ page, context }) => {
    test.skip(!endpoint, "Run make test-sync for disposable services");
    await page.goto("/");
    await page.evaluate(
        async ({ endpoint, token }) => {
            const { openReplica, liveReplicas } = await import("./database");
            const db = await openReplica(`outage-${crypto.randomUUID()}.db`);
            liveReplicas.set("outage", db);
            await db.connect({
                fetchCredentials: () => Promise.resolve({ endpoint, token }),
                uploadData: () => Promise.resolve(),
            });
            await db.waitForFirstSync(AbortSignal.timeout(20_000));
        },
        { endpoint: endpoint ?? "", token: tokens.owner ?? "" },
    );
    try {
        await context.setOffline(true);
        const pending = await page.evaluate(async () => {
            const { liveReplicas } = await import("./database");
            const db = liveReplicas.get("outage");
            if (!db) throw new Error("missing test replica");
            await db.execute("UPDATE hours SET note = 'offline intent' WHERE id = 'av_owner'");
            return (await db.getUploadQueueStats()).count;
        });
        expect(pending).toBe(1);
        await context.setOffline(false);
        const result = await page.evaluate(
            async ({ endpoint, token }) => {
                const { liveReplicas } = await import("./database");
                const db = liveReplicas.get("outage");
                if (!db) throw new Error("missing test replica");
                await db.disconnect();
                await db.connect({
                    fetchCredentials: () => Promise.resolve({ endpoint, token }),
                    uploadData: () => Promise.resolve(),
                });
                return {
                    count: (await db.getUploadQueueStats()).count,
                    row: await db.get<{ note: string }>(
                        "SELECT note FROM hours WHERE id = 'av_owner'",
                    ),
                };
            },
            { endpoint: endpoint ?? "", token: tokens.owner ?? "" },
        );
        expect(result).toEqual({ count: 1, row: { note: "offline intent" } });
    } finally {
        await context.setOffline(false);
        await page.evaluate(async () => {
            const { liveReplicas } = await import("./database");
            const db = liveReplicas.get("outage");
            if (db) {
                await db.disconnectAndClear();
                await db.close();
            }
            liveReplicas.delete("outage");
        });
    }
});

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
