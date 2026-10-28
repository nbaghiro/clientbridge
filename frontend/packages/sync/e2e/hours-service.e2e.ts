import { expect, test } from "@playwright/test";

import { backend, endpoint, fixture, token } from "./service";

function command(body: string): Promise<string> {
    return backend("hours", body);
}

test("lost command response replays once and the accepted week returns through PowerSync", async ({
    page,
}) => {
    let requests = 0;
    await page.route(`**/v1/hours/${fixture("st_owner")}/week`, async (route) => {
        const result = JSON.parse(await command(route.request().postData() ?? "")) as {
            status: number;
            body: string;
        };
        requests++;
        if (requests === 1) await route.abort("failed");
        else
            await route.fulfill({
                status: result.status,
                body: result.body,
                contentType: "application/json",
            });
    });
    await page.goto("/");
    try {
        const result = await page.evaluate(
            async ({ endpoint, token, ids }) => {
                const { openReplica, enqueueHours, uploadHoursOnce } = await import("./database");
                const name = `hours-service-${crypto.randomUUID()}.db`;
                let db = await openReplica(name);
                const connector = {
                    fetchCredentials: () => Promise.resolve({ endpoint, token }),
                    uploadData: () => Promise.resolve(),
                };
                try {
                    await db.connect(connector);
                    await db.waitForFirstSync(AbortSignal.timeout(20_000));
                    const staff = await db.get<{ hours_revision: number }>(
                        "SELECT hours_revision FROM staff WHERE id = ?",
                        [ids.staff],
                    );
                    await db.execute(
                        "INSERT INTO device_prefs (id, value) VALUES ('sync.identity', ?)",
                        [JSON.stringify(["api", endpoint, ids.user])],
                    );
                    await enqueueHours(
                        db,
                        ids.staff,
                        ids.business,
                        staff.hours_revision,
                        Array.from({ length: 7 }, (_, weekday) => ({
                            weekday,
                            available: true,
                            start_time: "10:00:00",
                            end_time: "16:00:00",
                        })),
                        [],
                    );
                    await uploadHoursOnce(db, fetch, new AbortController().signal);
                    await db.close();
                    db = await openReplica(name);
                    await db.connect(connector);
                    await db.execute("UPDATE hours_outbox SET retry_at = 0");
                    await uploadHoursOnce(db, fetch, new AbortController().signal);
                    const accepted = await db.get(
                        "SELECT state, result_revision, attempt_count FROM hours_outbox",
                    );
                    const deadline = Date.now() + 15_000;
                    for (;;) {
                        const row = await db.get<{ hours_revision: number }>(
                            "SELECT hours_revision FROM staff WHERE id = ?",
                            [ids.staff],
                        );
                        if (row.hours_revision === staff.hours_revision + 1) break;
                        if (Date.now() > deadline)
                            throw new Error("committed revision did not replicate");
                        await new Promise((resolve) => setTimeout(resolve, 100));
                    }
                    await uploadHoursOnce(db, fetch, new AbortController().signal);
                    return {
                        accepted,
                        pending: await db.getAll("SELECT id FROM hours_outbox"),
                        hours: await db.getAll(
                            "SELECT weekday, start_time, end_time FROM hours WHERE staff_id = ? ORDER BY weekday",
                            [ids.staff],
                        ),
                    };
                } finally {
                    await db.disconnectAndClear();
                    await db.close();
                }
            },
            {
                endpoint: endpoint(),
                token: token("owner"),
                ids: {
                    staff: fixture("st_owner"),
                    business: fixture("bz_first"),
                    user: fixture("us_owner"),
                },
            },
        );
        expect(requests).toBe(2);
        expect(result.accepted).toEqual({
            state: "accepted",
            result_revision: 1,
            attempt_count: 2,
        });
        expect(result.pending).toEqual([]);
        expect(result.hours).toEqual(
            Array.from({ length: 7 }, (_, weekday) => ({
                weekday,
                start_time: "10:00:00",
                end_time: "16:00:00",
            })),
        );
    } finally {
        await command("reset");
    }
});
