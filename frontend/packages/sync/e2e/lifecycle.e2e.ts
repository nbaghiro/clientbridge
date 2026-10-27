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
        await db.execute("INSERT INTO device_prefs (id, value) VALUES ('note.a', 'private first')");
        const days = Array.from({ length: 7 }, (_, weekday) => ({
            weekday,
            available: false,
            start_time: null,
            end_time: null,
        }));
        await enqueueHours(db, "first-staff", "bz_a", 0, days, days);
        await manager.pause();
        const preserved = (await db.getAll("SELECT id FROM hours_outbox")).length;
        const other = await manager.activate({ ...first, userId: "second" }, connector);
        const otherRows = await other.getAll("SELECT id FROM device_prefs WHERE id LIKE 'note.%'");
        await other.execute(
            "INSERT INTO device_prefs (id, value) VALUES ('note.b', 'private second')",
        );
        await enqueueHours(other, "second-staff", "bz_b", 0, days, days);
        const original = await manager.activate(first, connector);
        const originalRows = await original.getAll<{ id: string }>(
            "SELECT id FROM device_prefs WHERE id LIKE 'note.%'",
        );
        const originalPending = (await original.getAll("SELECT id FROM hours_outbox")).length;
        const environment = await manager.activate(
            { ...first, apiUrl: "https://other-api.test" },
            connector,
        );
        const environmentRows = await environment.getAll(
            "SELECT id FROM device_prefs WHERE id LIKE 'note.%'",
        );
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
        originalRows: [{ id: "note.a" }],
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

test("tabs opening the same fresh replica at once both claim it", async ({ context }) => {
    const tabs = [await context.newPage(), await context.newPage()];
    for (const tab of tabs) await tab.goto("/");
    const userId = `tabs-${String(Date.now())}`;
    const results = await Promise.all(
        tabs.map((tab) =>
            tab.evaluate(async (user) => {
                const { ReplicaController, replicaDatabase } = await import("./database");
                const manager = new ReplicaController(replicaDatabase);
                try {
                    await manager.activate(
                        {
                            userId: user,
                            apiUrl: "https://api.test",
                            powersyncUrl: "https://sync.test",
                        },
                        {
                            fetchCredentials: () => Promise.resolve(null),
                            uploadData: () => Promise.resolve(),
                        },
                    );
                    await manager.pause();
                    return "claimed";
                } catch (e) {
                    return String(e);
                }
            }, userId),
        ),
    );
    expect(results).toEqual(["claimed", "claimed"]);
});

test("close keeps the replica file and the next activation reopens it", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(
        async (userId) => {
            const { ReplicaController, replicaDatabase, replicaFiles, enqueueHours } =
                await import("./database");
            let name = "";
            const manager = new ReplicaController((filename) => {
                name = filename;
                return replicaDatabase(filename);
            });
            const identity = {
                userId,
                apiUrl: "https://api.test",
                powersyncUrl: "https://sync.test",
            };
            const connector = {
                fetchCredentials: () => Promise.resolve(null),
                uploadData: () => Promise.resolve(),
            };
            const db = await manager.activate(identity, connector);
            await db.execute("INSERT INTO device_prefs (id, value) VALUES ('note.kept', 'kept')");
            const days = Array.from({ length: 7 }, (_, weekday) => ({
                weekday,
                available: false,
                start_time: null,
                end_time: null,
            }));
            await enqueueHours(db, "kept-staff", "bz_kept", 0, days, days);
            await manager.close();
            const closed = db.closed;
            const files = await replicaFiles(name);
            const reopened = await manager.activate(identity, connector);
            const notes = await reopened.getAll(
                "SELECT id FROM device_prefs WHERE id LIKE 'note.%'",
            );
            const pending = (await reopened.getAll("SELECT id FROM hours_outbox")).length;
            await manager.discard();
            return { name, closed, files, notes, pending, fresh: reopened !== db };
        },
        `close-${String(Date.now())}`,
    );
    expect(result).toEqual({
        name: result.name,
        closed: true,
        files: [result.name, `${result.name}-journal`, `${result.name}-wal`],
        notes: [{ id: "note.kept" }],
        pending: 1,
        fresh: true,
    });
});

test("discard with removeReplicaFiles leaves no file of the replica", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(
        async (userId) => {
            const { ReplicaController, replicaDatabase, replicaFiles, removeReplicaFiles } =
                await import("./database");
            let name = "";
            const removed: boolean[] = [];
            const manager = new ReplicaController(
                (filename) => {
                    name = filename;
                    return replicaDatabase(filename);
                },
                async (filename) => {
                    removed.push(await removeReplicaFiles(filename));
                },
            );
            const db = await manager.activate(
                { userId, apiUrl: "https://api.test", powersyncUrl: "https://sync.test" },
                {
                    fetchCredentials: () => Promise.resolve(null),
                    uploadData: () => Promise.resolve(),
                },
            );
            await db.execute("INSERT INTO device_prefs (id, value) VALUES ('note.gone', 'gone')");
            const before = await replicaFiles(name);
            await manager.discard();
            return { before: before.length, removed, after: await replicaFiles(name) };
        },
        `discard-${String(Date.now())}`,
    );
    expect(result).toEqual({ before: 3, removed: [true], after: [] });
});

test("replica files are removed only once no page holds them", async ({ context }) => {
    const [holder, remover] = [await context.newPage(), await context.newPage()];
    for (const tab of [holder, remover]) await tab.goto("/");
    const name = await holder.evaluate(
        async (userId) => {
            const { ReplicaController, replicaDatabase } = await import("./database");
            let opened = "";
            const manager = new ReplicaController((filename) => {
                opened = filename;
                return replicaDatabase(filename);
            });
            const db = await manager.activate(
                { userId, apiUrl: "https://api.test", powersyncUrl: "https://sync.test" },
                {
                    fetchCredentials: () => Promise.resolve(null),
                    uploadData: () => Promise.resolve(),
                },
            );
            await db.execute("INSERT INTO device_prefs (id, value) VALUES ('note.held', 'held')");
            Object.assign(window, { closeHeld: () => manager.close() });
            return opened;
        },
        `held-${String(Date.now())}`,
    );
    const remove = () =>
        remover.evaluate(async (filename) => {
            const { removeReplicaFiles, replicaFiles } = await import("./database");
            const removed = await removeReplicaFiles(filename);
            return { removed, files: await replicaFiles(filename) };
        }, name);
    const files = [name, `${name}-journal`, `${name}-wal`];
    expect(await remove()).toEqual({ removed: false, files });
    await holder.evaluate(() =>
        (window as unknown as { closeHeld: () => Promise<void> }).closeHeld(),
    );
    expect(await remove()).toEqual({ removed: true, files: [] });
});
