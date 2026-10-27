import { WASQLiteVFS, WebPowerSyncDatabase } from "@powersync/web";

import { AppSchema } from "../src/schema";
import { BUSINESS, COUNTS, TOTAL, buildRows } from "./data";

const ROWS_PER_LINE = 1000;
const PROBE_TIMEOUT_MS = 15_000;
const VFS_BY_NAME = new Map<string, WASQLiteVFS>(
    Object.values(WASQLiteVFS).map((vfs) => [vfs, vfs]),
);

class BenchDatabase extends WebPowerSyncDatabase {
    get multiTabs(): boolean {
        return this.resolvedOpenOptions.enableMultiTabs;
    }
}

let db: BenchDatabase | null = null;
let progress = { applied: 0, lines: 0 };

function database(): BenchDatabase {
    if (!db) throw new Error("no database is open");
    return db;
}

function described(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

interface OpfsFile {
    path: string;
    size: number | string;
}

async function opfsFiles(): Promise<OpfsFile[] | { error: string }> {
    const out: OpfsFile[] = [];
    async function walk(directory: FileSystemDirectoryHandle, prefix: string): Promise<void> {
        for await (const [name, handle] of directory.entries()) {
            if (handle instanceof FileSystemDirectoryHandle) {
                await walk(handle, `${prefix}${name}/`);
                continue;
            }
            let size: number | string;
            try {
                size = (await handle.getFile()).size;
            } catch (error) {
                size = `error ${described(error)}`;
            }
            out.push({ path: `${prefix}${name}`, size });
        }
    }
    try {
        await walk(await navigator.storage.getDirectory(), "");
    } catch (error) {
        return { error: described(error) };
    }
    return out;
}

async function indexedDbNames(): Promise<string[] | { error: string }> {
    try {
        return (await indexedDB.databases()).map((entry) => entry.name ?? "");
    } catch (error) {
        return { error: described(error) };
    }
}

function syncLines() {
    const rows = buildRows(AppSchema);
    let op = 0;
    const data: string[] = [];
    const buckets: { bucket: string; checksum: number; count: number; priority: number }[] = [];
    for (const [table, list] of Object.entries(rows)) {
        const bucket = `bench_${table}`;
        buckets.push({ bucket, checksum: 0, count: list.length, priority: 3 });
        for (let i = 0; i < list.length; i += ROWS_PER_LINE) {
            const ops = list.slice(i, i + ROWS_PER_LINE).map((row) => ({
                op_id: String(++op),
                op: "PUT",
                object_type: table,
                object_id: row.id,
                data: JSON.stringify(row.data),
                checksum: 0,
                subkey: null,
            }));
            data.push(
                JSON.stringify({
                    data: { bucket, has_more: false, after: null, next_after: null, data: ops },
                }),
            );
        }
    }
    return {
        checkpoint: JSON.stringify({
            checkpoint: { last_op_id: String(op), write_checkpoint: null, buckets },
        }),
        data,
        complete: JSON.stringify({ checkpoint_complete: { last_op_id: String(op) } }),
        ops: op,
    };
}

async function control(op: string, payload: string | null): Promise<string> {
    return database().writeTransaction(async (tx) => {
        const { r } = await tx.get<{ r: string }>(
            "SELECT CAST(powersync_control(?, ?) AS TEXT) AS r",
            [op, payload],
        );
        return r;
    });
}

async function counts(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const table of Object.keys(COUNTS)) {
        out[table] = (await database().get<{ n: number }>(`SELECT count(*) AS n FROM ${table}`)).n;
    }
    return out;
}

async function sqliteSize(): Promise<{ bytes: number; freeBytes: number }> {
    const pages = (await database().get<{ page_count: number }>("PRAGMA page_count")).page_count;
    const size = (await database().get<{ page_size: number }>("PRAGMA page_size")).page_size;
    const free = (await database().get<{ freelist_count: number }>("PRAGMA freelist_count"))
        .freelist_count;
    return { bytes: pages * size, freeBytes: free * size };
}

async function estimate(): Promise<{ usage: number | null; quota: number | null }> {
    const { usage, quota } = await navigator.storage.estimate();
    return { usage: usage ?? null, quota: quota ?? null };
}

const LIST_SQL = `SELECT b.id, b.starts_at, b.status, c.name AS client, s.name AS subject, i.name AS service
FROM bookings b
JOIN clients c ON c.id = b.client_id
LEFT JOIN subjects s ON s.id = b.subject_id
JOIN slots sl ON sl.id = b.slot_id
JOIN items i ON i.id = sl.item_id
WHERE b.business_id = ? AND b.deleted_at IS NULL
ORDER BY b.starts_at DESC
LIMIT 50`;

const LEDGER_SQL = `SELECT a.id, a.category, SUM(e.amount_cents) AS balance
FROM accounts a JOIN entries e ON e.account_id = a.id
WHERE a.business_id = ?
GROUP BY a.id ORDER BY balance DESC LIMIT 50`;

const bench = {
    env() {
        return {
            userAgent: navigator.userAgent,
            vendor: navigator.vendor,
            sharedWorker: typeof SharedWorker !== "undefined",
            safari: "safari" in window,
            opfs: typeof navigator.storage.getDirectory === "function",
            crossOriginIsolated: self.crossOriginIsolated,
        };
    },
    dataset() {
        return { business: BUSINESS, rows: TOTAL };
    },
    probe(): Promise<{ granted: boolean | null; error: string | null; ms: number }> {
        const started = performance.now();
        const worker = new Worker(new URL("./probe.ts", import.meta.url), { type: "module" });
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                worker.terminate();
                resolve({ granted: null, error: "timeout", ms: performance.now() - started });
            }, PROBE_TIMEOUT_MS);
            worker.onmessage = (
                event: MessageEvent<{ granted: boolean; error: string | null }>,
            ) => {
                clearTimeout(timer);
                worker.terminate();
                resolve({ ...event.data, ms: performance.now() - started });
            };
        });
    },
    async open(vfs: string, name: string) {
        const known = VFS_BY_NAME.get(vfs);
        if (!known) throw new Error(`unknown VFS ${vfs}`);
        const started = performance.now();
        db = new BenchDatabase({ schema: AppSchema, database: { dbFilename: name, vfs: known } });
        await db.init();
        return { ms: performance.now() - started, multiTabs: db.multiTabs };
    },
    async populate() {
        const lines = syncLines();
        progress = { applied: 0, lines: lines.data.length };
        const started = performance.now();
        await control(
            "start",
            JSON.stringify({
                parameters: {},
                checkpoint_mode: "legacy",
                include_defaults: true,
                active_streams: [],
            }),
        );
        await control("connection", "established");
        await control("line_text", lines.checkpoint);
        for (const line of lines.data) {
            await control("line_text", line);
            progress.applied++;
        }
        const last = await control("line_text", lines.complete);
        const ms = performance.now() - started;
        await control("stop", null);
        const found = await counts();
        const wrong = Object.entries(COUNTS).filter(([table, n]) => found[table] !== n);
        if (wrong.length)
            throw new Error(
                `row counts differ: ${JSON.stringify(wrong.map(([t, n]) => [t, n, found[t]]))}; last instruction ${last}`,
            );
        return { ms, ops: lines.ops, lines: lines.data.length };
    },
    startPopulate(): void {
        bench.populate().catch(() => undefined);
    },
    progress() {
        return progress;
    },
    async total(): Promise<number> {
        const parts = Object.keys(COUNTS).map((table) => `(SELECT count(*) FROM ${table})`);
        return (await database().get<{ n: number }>(`SELECT ${parts.join(" + ")} AS n`)).n;
    },
    async read() {
        const started = performance.now();
        const list = await database().getAll(LIST_SQL, [BUSINESS]);
        const listed = performance.now();
        const ledger = await database().getAll(LEDGER_SQL, [BUSINESS]);
        return {
            listMs: listed - started,
            ledgerMs: performance.now() - listed,
            listRows: list.length,
            ledgerRows: ledger.length,
        };
    },
    estimate,
    sqliteSize,
    async storage() {
        return {
            estimate: await estimate(),
            sqlite: db ? await sqliteSize() : null,
            opfs: await opfsFiles(),
            indexedDb: await indexedDbNames(),
        };
    },
    async write(tag: string, n: number) {
        const started = performance.now();
        for (let i = 0; i < n; i++) {
            await database().execute(
                "INSERT INTO notes (id, body, business_id, parent_type, parent_id, created_at) VALUES (?, ?, ?, 'client', 'x', ?)",
                [
                    `${tag}_${i}_${Math.random().toString(36).slice(2)}`,
                    `note from ${tag}`,
                    BUSINESS,
                    new Date().toISOString(),
                ],
            );
        }
        return { ms: performance.now() - started };
    },
    async notesByTab(): Promise<Record<string, number>> {
        const rows = await database().getAll<{ body: string; n: number }>(
            "SELECT body, count(*) AS n FROM notes WHERE body LIKE 'note from %' GROUP BY body",
        );
        return Object.fromEntries(rows.map((row) => [row.body.slice("note from ".length), row.n]));
    },
    async integrity(): Promise<string> {
        const rows = await database().getAll<Record<string, string>>("PRAGMA integrity_check");
        return rows.map((row) => Object.values(row)[0]).join(";");
    },
    async clear() {
        const started = performance.now();
        await database().disconnectAndClear();
        return { ms: performance.now() - started };
    },
    async vacuum() {
        const started = performance.now();
        await database().execute("VACUUM");
        return { ms: performance.now() - started };
    },
    async wipe(): Promise<string[]> {
        const errors: string[] = [];
        try {
            const root = await navigator.storage.getDirectory();
            for await (const name of root.keys()) {
                try {
                    await root.removeEntry(name, { recursive: true });
                } catch (error) {
                    errors.push(`opfs ${name}: ${described(error)}`);
                }
            }
        } catch (error) {
            errors.push(`opfs: ${described(error)}`);
        }
        try {
            for (const { name } of await indexedDB.databases()) {
                if (!name) continue;
                await new Promise<void>((resolve) => {
                    const request = indexedDB.deleteDatabase(name);
                    request.onsuccess =
                        request.onerror =
                        request.onblocked =
                            () => {
                                resolve();
                            };
                });
            }
        } catch (error) {
            errors.push(`indexedDB: ${described(error)}`);
        }
        return errors;
    },
    async close(): Promise<void> {
        if (db) await db.close();
        db = null;
    },
};

export type Bench = typeof bench;

declare global {
    interface Window {
        bench: Bench;
        benchReady: boolean;
    }
}

window.bench = bench;
window.benchReady = true;
