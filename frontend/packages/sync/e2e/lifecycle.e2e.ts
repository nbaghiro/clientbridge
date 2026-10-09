import { expect, test } from "@playwright/test";

test("reauthentication preserves edits and account/environment switches isolate replicas", async ({
    page,
}) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
        const { ReplicaController, replicaDatabase, enqueueHours } = await import("./database");
        const manager = new ReplicaController(replicaDatabase);
        const connector = {
            fetchCredentials: () => Promise.resolve(null),
            uploadData: () => Promise.resolve(),
        };
        const first = {
            userId: "first",
            apiUrl: "https://api.test",
            powersyncUrl: "https://sync.test",
        };
        const db = await manager.activate(first, connector);
        await db.execute(
            "INSERT INTO hours (id, business_id, note) VALUES ('a', 'bz_a', 'private first')",
        );
        const days = Array.from({ length: 7 }, (_, weekday) => ({
            weekday,
            available: false,
            start_time: null,
            end_time: null,
        }));
        await enqueueHours(db, "first-staff", "bz_a", 0, days);
        await manager.pause();
        const preserved = (await db.getAll("SELECT id FROM hours_outbox")).length;
        const other = await manager.activate({ ...first, userId: "second" }, connector);
        const otherRows = await other.getAll("SELECT id FROM hours");
        await other.execute(
            "INSERT INTO hours (id, business_id, note) VALUES ('b', 'bz_b', 'private second')",
        );
        await enqueueHours(other, "second-staff", "bz_b", 0, days);
        const original = await manager.activate(first, connector);
        const originalRows = await original.getAll<{ id: string }>("SELECT id FROM hours");
        const originalPending = (await original.getAll("SELECT id FROM hours_outbox")).length;
        const environment = await manager.activate(
            { ...first, apiUrl: "https://other-api.test" },
            connector,
        );
        const environmentRows = await environment.getAll("SELECT id FROM hours");
        await manager.discard();
        await manager.activate(first, connector);
        await manager.discard();
        const secondAgain = await manager.activate({ ...first, userId: "second" }, connector);
        const secondPending = (await secondAgain.getAll("SELECT id FROM hours_outbox")).length;
        await manager.discard();
        const discarded = await manager.activate(first, connector);
        const discardedPending = await discarded.getAll("SELECT id FROM hours_outbox");
        await manager.discard();
        return {
            discardedPending,
            preserved,
            otherRows,
            originalRows,
            originalPending,
            environmentRows,
            secondPending,
        };
    });
    expect(result).toEqual({
        discardedPending: [],
        preserved: 1,
        otherRows: [],
        originalRows: [{ id: "a" }],
        originalPending: 1,
        environmentRows: [],
        secondPending: 1,
    });
});

test("initialization opens only the account-scoped replica", async ({ page }) => {
    await page.goto("/");
    const names = await page.evaluate(async () => {
        const { ReplicaController, replicaDatabase } = await import("./database");
        const opened: string[] = [];
        const manager = new ReplicaController((name) => {
            opened.push(name);
            return replicaDatabase(name);
        });
        await manager.activate(
            { userId: "current", apiUrl: "https://api.test", powersyncUrl: "https://sync.test" },
            { fetchCredentials: () => Promise.resolve(null), uploadData: () => Promise.resolve() },
        );
        await manager.discard();
        return opened;
    });
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^clientbridge-[a-f0-9]+-[a-f0-9]+\.db$/);
});
