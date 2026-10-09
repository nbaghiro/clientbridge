import { expect, test } from "@playwright/test";

test("queue identity and intent survive close and reopen", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
        const { openDatabase } = await import("./database");
        const filename = `queue-${crypto.randomUUID()}.db`;
        const db = await openDatabase(filename);
        await db.writeTransaction(async (tx) => {
            await tx.execute("INSERT INTO hours (id, note) VALUES (?, ?)", ["a", "first"]);
            await tx.execute("INSERT INTO hours (id, note) VALUES (?, ?)", ["b", "second"]);
        });
        const first = await db.getNextCrudTransaction();
        if (!first) throw new Error("missing transaction");
        const operation = crypto.randomUUID();
        await db.execute("INSERT INTO identities (id, operation) VALUES (?, ?)", [
            String(first.transactionId),
            operation,
        ]);
        const before = {
            transactionId: first.transactionId,
            entries: first.crud.map((entry) => entry.clientId),
            count: (await db.getUploadQueueStats()).count,
        };
        await db.close();
        const reopened = await openDatabase(filename);
        const replay = await reopened.getNextCrudTransaction();
        if (!replay) throw new Error("lost transaction after reopen");
        const identity = await reopened.get<{ operation: string }>(
            "SELECT operation FROM identities WHERE id = ?",
            [String(replay.transactionId)],
        );
        await reopened.execute("UPDATE hours SET note = ? WHERE id = ?", ["successor", "a"]);
        await replay.complete();
        const after = {
            transactionId: replay.transactionId,
            entries: replay.crud.map((entry) => entry.clientId),
            count: (await reopened.getUploadQueueStats()).count,
            identity: identity.operation,
            note: (await reopened.get<{ note: string }>("SELECT note FROM hours WHERE id = 'a'"))
                .note,
        };
        const successor = await reopened.getNextCrudTransaction();
        await successor?.complete();
        const remaining = (await reopened.getUploadQueueStats()).count;
        const noteAfterCompletion = (
            await reopened.get<{ note: string }>("SELECT note FROM hours WHERE id = 'a'")
        ).note;
        await reopened.disconnectAndClear();
        await reopened.close();
        return { before, after, operation, remaining, noteAfterCompletion };
    });
    expect(result.before.transactionId).toBeDefined();
    expect(result.before.count).toBe(2);
    expect(result.after.transactionId).toBe(result.before.transactionId);
    expect(result.after.entries).toEqual(result.before.entries);
    expect(result.after.identity).toBe(result.operation);
    expect(result.after.count).toBe(1);
    expect(result.after.note).toBe("successor");
    expect(result.remaining).toBe(0);
    expect(result.noteAfterCompletion).toBe("successor");
});
