import type { CommonPowerSyncDatabase } from "@powersync/common";

export interface WeekDay {
    weekday: number;
    available: boolean;
    start_time: string | null;
    end_time: string | null;
}
interface WeekRequest {
    request: {
        version: 2;
        device_id: string;
        operation_id: string;
        business_id: string;
        created_at: string;
    };
    expected_revision: number;
    days: WeekDay[];
}
interface OutboxRow {
    id: string;
    business_id: string;
    staff_id: string;
    actor_id: string;
    payload: string;
    state: string;
    predecessor_id: string | null;
    result_revision: number | null;
    attempt_count: number;
    retry_at: number;
}

export async function enqueueHours(
    db: CommonPowerSyncDatabase,
    staffId: string,
    businessId: string,
    revision: number,
    days: WeekDay[],
    repair = false,
    predecessor: { id: string; payload: string } | null = null,
): Promise<{ id: string; revision: number; payload: string }> {
    return db.writeTransaction(async (tx) => {
        const identity = await tx.get<{ value: string }>(
            "SELECT value FROM device_prefs WHERE id = 'sync.identity'",
        );
        const parts: unknown = JSON.parse(identity.value);
        if (!Array.isArray(parts) || typeof parts[2] !== "string")
            throw new Error("missing replica owner");
        const actorId = parts[2];
        if (repair) {
            const active = await tx.getOptional(
                "SELECT id FROM hours_outbox WHERE business_id = ? AND staff_id = ? AND state = 'sending'",
                [businessId, staffId],
            );
            if (active) throw new Error("working week is still uploading");
            await tx.execute("DELETE FROM hours_outbox WHERE business_id = ? AND staff_id = ?", [
                businessId,
                staffId,
            ]);
        }
        const previous = await tx.getOptional<OutboxRow>(
            "SELECT * FROM hours_outbox WHERE business_id = ? AND staff_id = ? ORDER BY sequence DESC LIMIT 1",
            [businessId, staffId],
        );
        if (
            previous &&
            (previous.id !== predecessor?.id || previous.payload !== predecessor.payload)
        )
            throw new Error("working week changed in another editor");
        if (previous?.state === "rejected") throw new Error("working week needs review");
        if (previous?.state === "queued" && previous.attempt_count === 0) {
            const body = JSON.parse(previous.payload) as WeekRequest;
            body.days = days;
            await tx.execute("UPDATE hours_outbox SET payload = ? WHERE id = ?", [
                JSON.stringify(body),
                previous.id,
            ]);
            return {
                id: previous.id,
                revision: body.expected_revision + 1,
                payload: JSON.stringify(body),
            };
        }
        let device = await tx.getOptional<{ value: string }>(
            "SELECT value FROM device_prefs WHERE id = 'sync.device'",
        );
        if (!device) {
            device = { value: crypto.randomUUID() };
            await tx.execute("INSERT INTO device_prefs (id, value) VALUES ('sync.device', ?)", [
                device.value,
            ]);
        }
        const order = await tx.get<{ next: number }>(
            "SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM hours_outbox",
        );
        const id = crypto.randomUUID();
        const created = new Date().toISOString();
        const body: WeekRequest = {
            request: {
                version: 2,
                device_id: device.value,
                operation_id: id,
                business_id: businessId,
                created_at: created,
            },
            expected_revision: previous
                ? (previous.result_revision ??
                  (JSON.parse(previous.payload) as WeekRequest).expected_revision + 1)
                : revision,
            days,
        };
        await tx.execute(
            "INSERT INTO hours_outbox (id, business_id, staff_id, actor_id, payload, state, predecessor_id, attempt_count, retry_at, created_at, sequence) VALUES (?, ?, ?, ?, ?, 'queued', ?, 0, 0, ?, ?)",
            [
                id,
                businessId,
                staffId,
                actorId,
                JSON.stringify(body),
                previous?.id ?? null,
                created,
                order.next,
            ],
        );
        return { id, revision: body.expected_revision + 1, payload: JSON.stringify(body) };
    });
}

export async function discardRejectedHours(
    db: CommonPowerSyncDatabase,
    businessId: string,
    staffId: string,
): Promise<void> {
    await db.writeTransaction(async (tx) => {
        const rejected = await tx.getOptional(
            "SELECT id FROM hours_outbox WHERE business_id = ? AND staff_id = ? AND state = 'rejected'",
            [businessId, staffId],
        );
        const sending = await tx.getOptional(
            "SELECT id FROM hours_outbox WHERE business_id = ? AND staff_id = ? AND state = 'sending'",
            [businessId, staffId],
        );
        if (!rejected || sending) throw new Error("working week is not ready to discard");
        await tx.execute("DELETE FROM hours_outbox WHERE business_id = ? AND staff_id = ?", [
            businessId,
            staffId,
        ]);
    });
}

type HoursTransport = (path: string, init?: RequestInit) => Promise<Response>;

export async function uploadHoursOnce(
    db: CommonPowerSyncDatabase,
    fetch: HoursTransport,
    signal: AbortSignal,
): Promise<boolean> {
    const row = await db.writeTransaction(async (tx) => {
        const observed = await tx.getAll<{ id: string; result_revision: number }>(
            "SELECT o.id, o.result_revision FROM hours_outbox o JOIN staff s ON s.id = o.staff_id AND s.business_id = o.business_id WHERE o.state = 'accepted' AND s.hours_revision >= o.result_revision",
        );
        for (const parent of observed) {
            const children = await tx.getAll<OutboxRow>(
                "SELECT * FROM hours_outbox WHERE predecessor_id = ?",
                [parent.id],
            );
            for (const child of children) {
                let payload = child.payload;
                if (child.attempt_count === 0) {
                    const body = JSON.parse(payload) as WeekRequest;
                    body.expected_revision = parent.result_revision;
                    payload = JSON.stringify(body);
                }
                await tx.execute(
                    "UPDATE hours_outbox SET predecessor_id = NULL, payload = ? WHERE id = ?",
                    [payload, child.id],
                );
            }
            await tx.execute("DELETE FROM hours_outbox WHERE id = ?", [parent.id]);
        }
        const next = await tx.getOptional<OutboxRow>(
            "SELECT o.* FROM hours_outbox o LEFT JOIN hours_outbox p ON p.id = o.predecessor_id WHERE o.state IN ('queued', 'sending') AND o.retry_at <= ? AND (o.predecessor_id IS NULL OR p.state = 'accepted' OR o.attempt_count > 0) ORDER BY o.sequence LIMIT 1",
            [Date.now()],
        );
        if (!next) return null;
        if (next.attempt_count === 0 && next.predecessor_id) {
            const parent = await tx.get<{ result_revision: number }>(
                "SELECT result_revision FROM hours_outbox WHERE id = ?",
                [next.predecessor_id],
            );
            const body = JSON.parse(next.payload) as WeekRequest;
            body.expected_revision = parent.result_revision;
            next.payload = JSON.stringify(body);
        }
        next.attempt_count++;
        await tx.execute(
            "UPDATE hours_outbox SET state = 'sending', payload = ?, attempt_count = ?, retry_at = ? WHERE id = ?",
            [next.payload, next.attempt_count, Date.now() + 20_000, next.id],
        );
        return next;
    });
    if (!row) return false;
    const retry = async (code: string, delay?: number): Promise<void> => {
        const backoff = Math.min(300_000, 1000 * 2 ** Math.min(row.attempt_count, 8));
        await db.execute(
            "UPDATE hours_outbox SET state = 'queued', error_code = ?, retry_at = ? WHERE id = ? AND state = 'sending'",
            [code, Date.now() + (delay ?? backoff * (0.8 + Math.random() * 0.4)), row.id],
        );
    };
    const controller = new AbortController();
    const abort = (): void => {
        controller.abort();
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) controller.abort();
    const timer = setTimeout(abort, 15_000);
    try {
        const response = await abortable(
            fetch(`/v1/hours/${encodeURIComponent(row.staff_id)}/week`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Business-Id": row.business_id },
                body: row.payload,
                signal: controller.signal,
            }),
            controller.signal,
        );
        if (response.ok) {
            const result = await abortable(
                response.json() as Promise<{ revision: number }>,
                controller.signal,
            );
            if (!Number.isSafeInteger(result.revision)) throw new Error("invalid hours result");
            await db.execute(
                "UPDATE hours_outbox SET state = 'accepted', result_revision = ?, error_code = NULL WHERE id = ?",
                [result.revision, row.id],
            );
        } else if ([401, 408, 429].includes(response.status) || response.status >= 500) {
            const after = response.headers.get("Retry-After");
            const seconds = after === null ? NaN : Number(after);
            const until = after === null ? NaN : Date.parse(after);
            const delay = Number.isFinite(seconds) ? seconds * 1000 : until - Date.now();
            await retry(
                `http_${String(response.status)}`,
                Number.isFinite(delay) ? Math.max(1000, Math.min(delay, 300_000)) : undefined,
            );
        } else {
            await db.execute(
                "UPDATE hours_outbox SET state = 'rejected', error_code = ? WHERE id = ? AND state != 'accepted'",
                [`http_${String(response.status)}`, row.id],
            );
        }
    } catch {
        await retry(signal.aborted ? "paused" : "transport");
    } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
    }
    return true;
}

async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    let abort = (): void => undefined;
    const stopped = new Promise<never>((_, reject) => {
        abort = () => {
            reject(new Error("hours upload paused"));
        };
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
    });
    try {
        return await Promise.race([work, stopped]);
    } finally {
        signal.removeEventListener("abort", abort);
    }
}

export function startHoursUploads(
    db: CommonPowerSyncDatabase,
    fetch: HoursTransport,
): () => Promise<void> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: Promise<void> = Promise.resolve();
    const run = (): void => {
        pending = uploadHoursOnce(db, fetch, controller.signal)
            .then(() => undefined)
            .catch(() => undefined)
            .finally(() => {
                if (!controller.signal.aborted) timer = setTimeout(run, 1000);
            });
    };
    run();
    return async () => {
        controller.abort();
        clearTimeout(timer);
        await pending;
    };
}
