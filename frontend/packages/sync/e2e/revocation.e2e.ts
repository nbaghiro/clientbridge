import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

const endpoint = process.env.SYNC_TEST_URL;
const tokens = JSON.parse(process.env.SYNC_TEST_TOKENS ?? "{}") as Record<string, string>;

async function mutate(action: string): Promise<void> {
    const python = process.env.SYNC_TEST_PYTHON;
    const cwd = process.env.SYNC_TEST_BACKEND;
    if (!python || !cwd) throw new Error("Run make test-sync for isolated mutations");
    await promisify(execFile)(python, ["-m", "scripts.sync_mutate", action], { cwd });
}

test("live downgrade, soft deletion and membership removal purge replica data", async ({
    page,
}) => {
    test.skip(!endpoint, "Run make test-sync for disposable services");
    await page.goto("/");
    await page.evaluate(
        async ({ endpoint, token }) => {
            const { openAuthorizationReplica, liveReplicas } = await import("./database");
            const db = await openAuthorizationReplica(`revoke-${crypto.randomUUID()}.db`);
            liveReplicas.set("revoke", db);
            await db.connect({
                fetchCredentials: () => Promise.resolve({ endpoint, token }),
                uploadData: () => Promise.resolve(),
            });
            await db.waitForFirstSync(AbortSignal.timeout(20_000));
        },
        { endpoint: endpoint ?? "", token: tokens.admin ?? "" },
    );
    const snapshot = () =>
        page.evaluate(async () => {
            const { liveReplicas } = await import("./database");
            const db = liveReplicas.get("revoke");
            if (!db) throw new Error("missing replica");
            return {
                businesses: (await db.getAll("SELECT id FROM businesses")).length,
                clients: (await db.getAll("SELECT id FROM clients")).length,
                pay: (await db.getAll("SELECT id FROM staff WHERE rate_cents IS NOT NULL")).length,
                tax: (await db.getAll("SELECT id FROM businesses WHERE gst_hst_number IS NOT NULL"))
                    .length,
                hours: (await db.getAll("SELECT id FROM hours")).length,
            };
        });
    try {
        expect(await snapshot()).toMatchObject({ businesses: 1, clients: 1, tax: 1, hours: 2 });
        expect((await snapshot()).pay).toBeGreaterThan(0);
        await mutate("downgrade");
        await expect
            .poll(snapshot, { timeout: 15_000 })
            .toEqual({ businesses: 1, clients: 1, pay: 0, tax: 0, hours: 0 });
        await mutate("delete_client");
        await expect.poll(async () => (await snapshot()).clients, { timeout: 15_000 }).toBe(0);
        await mutate("remove");
        await expect
            .poll(snapshot, { timeout: 15_000 })
            .toEqual({ businesses: 0, clients: 0, pay: 0, tax: 0, hours: 0 });
    } finally {
        await page.evaluate(async () => {
            const { liveReplicas } = await import("./database");
            const db = liveReplicas.get("revoke");
            if (db) {
                await db.disconnectAndClear();
                await db.close();
            }
            liveReplicas.delete("revoke");
        });
        await mutate("restore");
        await mutate("restore_client");
    }
});
