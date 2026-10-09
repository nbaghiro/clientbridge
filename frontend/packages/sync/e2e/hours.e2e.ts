import { expect, test } from "@playwright/test";

test("hours proposals coalesce before upload and retain immutable identities after a lost response", async ({
    page,
}) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
        const { openReplica, enqueueHours, uploadHoursOnce } = await import("./database");
        const name = `hours-${crypto.randomUUID()}.db`;
        let db = await openReplica(name);
        await db.execute("INSERT INTO device_prefs (id, value) VALUES ('sync.identity', ?)", [
            JSON.stringify(["api", "sync", "actor"]),
        ]);
        const days = (start: string) =>
            Array.from({ length: 7 }, (_, weekday) => ({
                weekday,
                available: true,
                start_time: start,
                end_time: "17:00:00",
            }));
        let first = await enqueueHours(db, "staff", "business", 0, days("09:00:00"));
        first = await enqueueHours(db, "staff", "business", 0, days("10:00:00"), false, first);
        const coalesced = await db.get<{ count: number }>(
            "SELECT count(*) AS count FROM hours_outbox",
        );
        const bodies: string[] = [];
        await uploadHoursOnce(
            db,
            (_path, init) => {
                if (typeof init?.body !== "string") throw new Error("expected serialized command");
                bodies.push(init.body);
                throw new Error("response dropped after server commit");
            },
            new AbortController().signal,
        );
        await enqueueHours(db, "staff", "business", first.revision, days("11:00:00"), false, first);
        await db.execute("UPDATE hours_outbox SET retry_at = 0");
        await db.close();
        db = await openReplica(name);
        await uploadHoursOnce(
            db,
            (_path, init) => {
                if (typeof init?.body !== "string") throw new Error("expected serialized command");
                bodies.push(init.body);
                return Promise.resolve(Response.json({ revision: 1 }));
            },
            new AbortController().signal,
        );
        await uploadHoursOnce(
            db,
            (_path, init) => {
                if (typeof init?.body !== "string") throw new Error("expected serialized command");
                bodies.push(init.body);
                return Promise.resolve(Response.json({ revision: 2 }));
            },
            new AbortController().signal,
        );
        const states = await db.getAll<{ state: string }>(
            "SELECT state FROM hours_outbox ORDER BY sequence",
        );
        const sdkQueue = (await db.getUploadQueueStats()).count;
        await db.disconnectAndClear();
        await db.close();
        return { coalesced: coalesced.count, bodies, states, sdkQueue };
    });
    expect(result.coalesced).toBe(1);
    expect(result.sdkQueue).toBe(0);
    expect(result.bodies).toHaveLength(3);
    expect(result.bodies[0]).toBe(result.bodies[1]);
    const successor = JSON.parse(result.bodies[2] ?? "{}") as {
        expected_revision: number;
        days: { start_time: string }[];
    };
    expect(successor.expected_revision).toBe(1);
    expect(successor.days[0]?.start_time).toBe("11:00:00");
    expect(result.states).toEqual([{ state: "accepted" }, { state: "accepted" }]);
});

test("a rejected week blocks its successors while unrelated staff edits proceed", async ({
    page,
}) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
        const { openReplica, enqueueHours, uploadHoursOnce } = await import("./database");
        const db = await openReplica(`rejected-hours-${crypto.randomUUID()}.db`);
        await db.execute("INSERT INTO device_prefs (id, value) VALUES ('sync.identity', ?)", [
            JSON.stringify(["api", "sync", "actor"]),
        ]);
        const days = Array.from({ length: 7 }, (_, weekday) => ({
            weekday,
            available: true,
            start_time: "09:00:00",
            end_time: "17:00:00",
        }));
        const first = await enqueueHours(db, "first", "business", 0, days);
        await uploadHoursOnce(
            db,
            () => Promise.reject(new Error("offline")),
            new AbortController().signal,
        );
        await enqueueHours(db, "first", "business", first.revision, days, false, first);
        await enqueueHours(db, "second", "business", 0, days);
        await db.execute("UPDATE hours_outbox SET retry_at = 0");
        await uploadHoursOnce(
            db,
            () => Promise.resolve(new Response(null, { status: 409 })),
            new AbortController().signal,
        );
        let path = "";
        await uploadHoursOnce(
            db,
            (url) => {
                path = url;
                return Promise.resolve(Response.json({ revision: 1 }));
            },
            new AbortController().signal,
        );
        const states = await db.getAll(
            "SELECT staff_id, state FROM hours_outbox ORDER BY sequence",
        );
        await enqueueHours(db, "first", "business", 5, days, true);
        const repaired = await db.getAll<{ payload: string }>(
            "SELECT payload FROM hours_outbox WHERE staff_id = 'first'",
        );
        await db.disconnectAndClear();
        await db.close();
        return { path, states, repaired };
    });
    expect(result.path).toBe("/v1/hours/second/week");
    expect(result.states).toEqual([
        { staff_id: "first", state: "rejected" },
        { staff_id: "first", state: "queued" },
        { staff_id: "second", state: "accepted" },
    ]);
    expect(result.repaired).toHaveLength(1);
    expect(JSON.parse(result.repaired[0]?.payload ?? "{}")).toMatchObject({ expected_revision: 5 });
});

test("a paused upload releases its lease even if its transport ignores cancellation", async ({
    page,
}) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
        const { openReplica, enqueueHours, uploadHoursOnce } = await import("./database");
        const db = await openReplica(`pause-hours-${crypto.randomUUID()}.db`);
        await db.execute("INSERT INTO device_prefs (id, value) VALUES ('sync.identity', ?)", [
            JSON.stringify(["api", "sync", "actor"]),
        ]);
        await enqueueHours(
            db,
            "first",
            "business",
            0,
            Array.from({ length: 7 }, (_, weekday) => ({
                weekday,
                available: false,
                start_time: null,
                end_time: null,
            })),
        );
        const controller = new AbortController();
        let started!: () => void;
        const ready = new Promise<void>((resolve) => {
            started = resolve;
        });
        const pending = uploadHoursOnce(
            db,
            () => {
                started();
                return new Promise<Response>(() => undefined);
            },
            controller.signal,
        );
        await ready;
        const concurrent = await uploadHoursOnce(
            db,
            () => {
                throw new Error("lease was not respected");
            },
            new AbortController().signal,
        );
        controller.abort();
        await pending;
        const row = await db.get("SELECT state, error_code, attempt_count FROM hours_outbox");
        await db.disconnectAndClear();
        await db.close();
        return { concurrent, row };
    });
    expect(result).toEqual({
        concurrent: false,
        row: { state: "queued", error_code: "paused", attempt_count: 1 },
    });
});

test("another editor cannot overwrite a proposal it did not observe", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
        const { openReplica, enqueueHours } = await import("./database");
        const db = await openReplica(`editors-${crypto.randomUUID()}.db`);
        await db.execute("INSERT INTO device_prefs (id, value) VALUES ('sync.identity', ?)", [
            JSON.stringify(["api", "sync", "actor"]),
        ]);
        const days = Array.from({ length: 7 }, (_, weekday) => ({
            weekday,
            available: false,
            start_time: null,
            end_time: null,
        }));
        const original = await enqueueHours(db, "staff", "business", 7, days);
        const edited = days.map((day) => ({ ...day, available: true }));
        await enqueueHours(db, "staff", "business", 8, edited, false, original);
        let rejected = false;
        try {
            await enqueueHours(db, "staff", "business", 8, days, false, original);
        } catch {
            rejected = true;
        }
        const rows = await db.getAll<{ payload: string }>("SELECT payload FROM hours_outbox");
        await db.disconnectAndClear();
        await db.close();
        return { rejected, rows };
    });
    expect(result.rejected).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(JSON.parse(result.rows[0]?.payload ?? "{}")).toMatchObject({
        expected_revision: 7,
        days: Array.from({ length: 7 }, (_, weekday) => ({ weekday, available: true })),
    });
});
