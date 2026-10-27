import { expect, test } from "@playwright/test";

test("a write past the origin's quota on OPFS reads as storage full", async ({ page, context }) => {
    await page.goto("/");
    const name = `quota-${String(Date.now())}.db`;
    await page.evaluate(async (filename) => {
        const { openReplica } = await import("./database");
        const db = await openReplica(filename);
        await db.execute("INSERT INTO device_prefs (id, value) VALUES ('note', 'before')");
        await db.close();
    }, name);
    const usage = await page.evaluate(async () => (await navigator.storage.estimate()).usage ?? 0);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Storage.overrideQuotaForOrigin", {
        origin: new URL(page.url()).origin,
        quotaSize: usage + 2 * 1024 * 1024,
    });
    const result = await page.evaluate(async (filename) => {
        const { openReplica, isStorageFull } = await import("./database");
        const db = await openReplica(filename);
        try {
            for (let i = 0; i < 64; i++) {
                await db.execute(
                    "INSERT INTO device_prefs (id, value) VALUES (?, hex(randomblob(262144)))",
                    [`fill.${String(i)}`],
                );
            }
            return { failed: false, full: false };
        } catch (error) {
            return { failed: true, full: isStorageFull(error) };
        }
    }, name);
    expect(result).toEqual({ failed: true, full: true });
});
