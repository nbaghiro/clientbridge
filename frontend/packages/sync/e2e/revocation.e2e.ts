import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

import { endpoint, fixture, token } from "./service";

async function mutate(action: string): Promise<void> {
    const python = process.env.SYNC_TEST_PYTHON;
    const cwd = process.env.SYNC_TEST_BACKEND;
    if (!python || !cwd) throw new Error("SYNC_TEST_PYTHON is not set: run make test-sync");
    await promisify(execFile)(python, ["-m", "scripts.sync_mutate", action], { cwd });
}

test("live renames reach the replica; downgrade, deletion and removal purge its data", async ({
    page,
}) => {
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
        { endpoint: endpoint(), token: token("admin") },
    );
    const owner = fixture("us_owner");
    const snapshot = () =>
        page.evaluate(async (owner) => {
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
                users: (await db.getAll("SELECT id FROM users")).length,
                owner:
                    (
                        await db.getOptional<{ name: string | null }>(
                            "SELECT name FROM users WHERE id = ?",
                            [owner],
                        )
                    )?.name ?? null,
            };
        }, owner);
    try {
        expect(await snapshot()).toMatchObject({
            businesses: 1,
            clients: 1,
            tax: 1,
            hours: 2,
            users: 6,
            owner: "owner",
        });
        expect((await snapshot()).pay).toBeGreaterThan(0);
        await mutate("rename");
        await expect
            .poll(async () => (await snapshot()).owner, { timeout: 15_000 })
            .toBe("renamed");
        await mutate("downgrade");
        await expect.poll(snapshot, { timeout: 15_000 }).toEqual({
            businesses: 1,
            clients: 1,
            pay: 0,
            tax: 0,
            hours: 0,
            users: 6,
            owner: "renamed",
        });
        await mutate("delete_client");
        await expect.poll(async () => (await snapshot()).clients, { timeout: 15_000 }).toBe(0);
        await mutate("remove");
        await expect.poll(snapshot, { timeout: 15_000 }).toEqual({
            businesses: 0,
            clients: 0,
            pay: 0,
            tax: 0,
            hours: 0,
            users: 0,
            owner: null,
        });
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
        await mutate("restore_name");
    }
});
