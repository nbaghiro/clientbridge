import { usePowerSync } from "@powersync/react";
import { useCallback, useEffect, useState } from "react";

import { connectPowerSync, powersyncUrl } from "../lib/powersync";
import { useClientState } from "../lib/useClientState";

// Hidden developer overlay. Open by typing "debug" anywhere, or ⌘/Ctrl+Shift+D. Esc closes.
export function DebugPanel() {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        let buffer = "";
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === "Escape") {
                setOpen(false);
                return;
            }
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "d") {
                e.preventDefault();
                setOpen((o) => !o);
                return;
            }
            // Don't hijack typing inside the SQL console.
            if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
                return;
            }
            if (e.key.length === 1) {
                buffer = (buffer + e.key.toLowerCase()).slice(-5);
                if (buffer === "debug") setOpen(true);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("keydown", onKey);
        };
    }, []);

    if (!open) return null;
    return (
        <Overlay
            onClose={() => {
                setOpen(false);
            }}
        />
    );
}

type Mode = "tables" | "query";
type Rows = Record<string, unknown>[];

function Overlay({ onClose }: { onClose: () => void }) {
    const { status, tables, totalRows, refresh } = useClientState();
    const db = usePowerSync();

    const [mode, setMode] = useState<Mode>("tables");
    const [selected, setSelected] = useState<string | null>(null);
    const [sql, setSql] = useState("SELECT * FROM clients LIMIT 20");
    const [rows, setRows] = useState<Rows>([]);
    const [error, setError] = useState<string | null>(null);
    const [ms, setMs] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);

    // Run any read query against the local SQLite replica and show the result grid.
    const exec = useCallback(
        async (query: string): Promise<void> => {
            setLoading(true);
            const started = performance.now();
            try {
                const result = await db.getAll<Record<string, unknown>>(query);
                setRows(result);
                setError(null);
            } catch (e) {
                setRows([]);
                setError(e instanceof Error ? e.message : String(e));
            } finally {
                setMs(Math.round(performance.now() - started));
                setLoading(false);
            }
        },
        [db],
    );

    // Drill into a table → SELECT * from it.
    useEffect(() => {
        if (selected) void exec(`SELECT * FROM "${selected}" LIMIT 200`);
    }, [selected, exec]);

    const reconnect = async (): Promise<void> => {
        await db.disconnect();
        await connectPowerSync();
    };

    const testWrite = async (): Promise<void> => {
        await db.execute(
            "INSERT INTO clients (id, business_id, name, status, tags, custom_fields, lifetime_value_cents) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                `cl_test_${Date.now()}`,
                "bz_birchbark",
                `Test ${new Date().toLocaleTimeString()}`,
                "active",
                "[]",
                "{}",
                0,
            ],
        );
        await refresh();
        if (selected) void exec(`SELECT * FROM "${selected}" LIMIT 200`);
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-6 backdrop-blur-sm"
            onClick={onClose}
        >
            <aside
                className="flex h-[86vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink font-mono text-xs text-bg shadow-2xl"
                onClick={(e) => {
                    e.stopPropagation();
                }}
            >
                <header className="flex items-center justify-between border-b border-white/10 px-5 py-3">
                    <span className="font-sans text-sm font-semibold tracking-wide">
                        client state · debug
                    </span>
                    <button
                        className="rounded px-2 py-0.5 text-bg/60 hover:bg-white/10 hover:text-bg"
                        onClick={onClose}
                    >
                        ✕ esc
                    </button>
                </header>

                <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-5 py-2">
                    <Tool
                        label="↻ refresh"
                        onClick={() => {
                            void refresh();
                        }}
                    />
                    <Tool
                        label="⟳ reconnect"
                        onClick={() => {
                            void reconnect();
                        }}
                    />
                    <Tool
                        label="＋ test write"
                        onClick={() => {
                            void testWrite();
                        }}
                    />
                    <span className="mx-1 text-bg/20">|</span>
                    <Tab
                        label="tables"
                        active={mode === "tables"}
                        onClick={() => {
                            setMode("tables");
                        }}
                    />
                    <Tab
                        label="query"
                        active={mode === "query"}
                        onClick={() => {
                            setMode("query");
                        }}
                    />
                </div>

                <div className="grid grid-cols-3 gap-x-8 gap-y-0.5 border-b border-white/10 px-5 py-2">
                    <Row k="connected" v={String(status.connected)} good={status.connected} />
                    <Row k="has synced" v={String(status.hasSynced ?? false)} />
                    <Row k="last synced" v={status.lastSyncedAt?.toLocaleTimeString() ?? "—"} />
                    <Row k="downloading" v={String(status.dataFlowStatus.downloading)} />
                    <Row k="uploading" v={String(status.dataFlowStatus.uploading)} />
                    <Row k="powersync" v={powersyncUrl} />
                </div>

                {mode === "query" ? (
                    <QueryView
                        sql={sql}
                        onChange={setSql}
                        onRun={() => {
                            void exec(sql);
                        }}
                        rows={rows}
                        error={error}
                        ms={ms}
                        loading={loading}
                    />
                ) : selected ? (
                    <Detail
                        name={selected}
                        rows={rows}
                        error={error}
                        loading={loading}
                        onBack={() => {
                            setSelected(null);
                            setRows([]);
                            setError(null);
                        }}
                        onReload={() => {
                            void exec(`SELECT * FROM "${selected}" LIMIT 200`);
                        }}
                    />
                ) : (
                    <TableList
                        tables={tables}
                        totalRows={totalRows}
                        onPick={(name) => {
                            setSelected(name);
                        }}
                    />
                )}
            </aside>
        </div>
    );
}

function TableList({
    tables,
    totalRows,
    onPick,
}: {
    tables: { table: string; rows: number }[];
    totalRows: number;
    onPick: (name: string) => void;
}) {
    return (
        <>
            <div className="flex items-center justify-between px-5 py-2 text-bg/60">
                <span>{tables.length} tables with rows · click to inspect</span>
                <span className="tabular-nums">{totalRows} rows on device</span>
            </div>
            <div className="grid flex-1 grid-cols-2 content-start gap-x-8 overflow-auto px-3 pb-4 lg:grid-cols-3">
                {tables.length === 0 ? (
                    <div className="col-span-full py-10 text-center text-bg/40">
                        no local rows yet — waiting for first sync…
                    </div>
                ) : (
                    tables.map((t) => (
                        <button
                            key={t.table}
                            className="flex items-center justify-between rounded px-2 py-1 text-left hover:bg-white/10"
                            onClick={() => {
                                onPick(t.table);
                            }}
                        >
                            <span>{t.table}</span>
                            <span className="tabular-nums text-bg/70">{t.rows} ›</span>
                        </button>
                    ))
                )}
            </div>
        </>
    );
}

function Detail({
    name,
    rows,
    error,
    loading,
    onBack,
    onReload,
}: {
    name: string;
    rows: Rows;
    error: string | null;
    loading: boolean;
    onBack: () => void;
    onReload: () => void;
}) {
    return (
        <>
            <div className="flex items-center justify-between px-5 py-2 text-bg/70">
                <button className="rounded px-1 hover:bg-white/10 hover:text-bg" onClick={onBack}>
                    ‹ tables
                </button>
                <span className="font-semibold text-bg">
                    {name} · {rows.length} rows
                </span>
                <button className="rounded px-1 hover:bg-white/10 hover:text-bg" onClick={onReload}>
                    ↻
                </button>
            </div>
            <Grid rows={rows} error={error} loading={loading} />
        </>
    );
}

function QueryView({
    sql,
    onChange,
    onRun,
    rows,
    error,
    ms,
    loading,
}: {
    sql: string;
    onChange: (v: string) => void;
    onRun: () => void;
    rows: Rows;
    error: string | null;
    ms: number | null;
    loading: boolean;
}) {
    return (
        <>
            <div className="border-b border-white/10 px-5 py-3">
                <textarea
                    className="h-24 w-full resize-none rounded border border-white/15 bg-black/30 p-3 font-mono text-xs text-bg outline-none focus:border-white/40"
                    spellCheck={false}
                    value={sql}
                    onChange={(e) => {
                        onChange(e.target.value);
                    }}
                    onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onRun();
                    }}
                />
                <div className="mt-2 flex items-center justify-between">
                    <span className="text-bg/40">
                        {loading ? "running…" : `${rows.length} rows`}
                        {ms !== null && !loading ? ` · ${ms}ms` : ""}
                    </span>
                    <Tool label="run ⌘↵" onClick={onRun} />
                </div>
            </div>
            <Grid rows={rows} error={error} loading={loading} />
        </>
    );
}

function Grid({ rows, error, loading }: { rows: Rows; error: string | null; loading: boolean }) {
    if (loading) {
        return (
            <div className="flex flex-1 items-center justify-center gap-3 text-bg/50">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-bg/20 border-t-bg/70" />
                running…
            </div>
        );
    }
    if (error) {
        return (
            <div className="flex-1 overflow-auto px-5 py-4 text-danger">
                <pre className="whitespace-pre-wrap">{error}</pre>
            </div>
        );
    }
    if (rows.length === 0) {
        return <div className="flex-1 px-5 py-10 text-center text-bg/40">no rows</div>;
    }
    const cols = Object.keys(rows[0] ?? {});
    return (
        <div className="flex-1 overflow-auto">
            <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-ink">
                    <tr>
                        {cols.map((c) => (
                            <th
                                key={c}
                                className="border-b border-white/15 px-3 py-1.5 text-left font-semibold text-bg/60"
                            >
                                {c}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r, i) => (
                        <tr key={i} className="hover:bg-white/5">
                            {cols.map((c) => {
                                const text = fmt(r[c]);
                                return (
                                    <td
                                        key={c}
                                        title={text}
                                        className="max-w-[20rem] truncate border-b border-white/5 px-3 py-1.5 text-bg/85"
                                    >
                                        {text}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function fmt(v: unknown): string {
    if (v === null || v === undefined) return "·";
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
        return String(v);
    }
    return JSON.stringify(v);
}

function Tool({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <button
            className="rounded border border-white/15 px-2 py-1 text-bg/80 hover:bg-white/10 hover:text-bg"
            onClick={onClick}
        >
            {label}
        </button>
    );
}

function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button
            className={`rounded px-2 py-1 ${active ? "bg-white/15 text-bg" : "text-bg/50 hover:text-bg"}`}
            onClick={onClick}
        >
            {label}
        </button>
    );
}

function Row({ k, v, good }: { k: string; v: string; good?: boolean }) {
    return (
        <div className="flex items-center justify-between gap-4">
            <span className="text-bg/50">{k}</span>
            <span className={`truncate ${good ? "text-success" : "text-bg/90"}`}>{v}</span>
        </div>
    );
}
