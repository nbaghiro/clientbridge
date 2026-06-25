import { useEffect, useState } from "react";

import { backendUrl, powersyncUrl } from "../lib/powersync";
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

function Overlay({ onClose }: { onClose: () => void }) {
    const { status, tables, totalRows } = useClientState();

    return (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/40 backdrop-blur-sm">
            <aside className="flex h-full w-full max-w-md flex-col bg-ink font-mono text-xs text-bg shadow-card">
                <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
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

                <div className="space-y-1 border-b border-white/10 px-4 py-3">
                    <Row k="connected" v={String(status.connected)} good={status.connected} />
                    <Row k="connecting" v={String(status.connecting)} />
                    <Row k="has synced" v={String(status.hasSynced ?? false)} />
                    <Row k="last synced" v={status.lastSyncedAt?.toLocaleTimeString() ?? "—"} />
                    <Row k="downloading" v={String(status.dataFlowStatus.downloading)} />
                    <Row k="uploading" v={String(status.dataFlowStatus.uploading)} />
                    <Row k="backend" v={backendUrl} />
                    <Row k="powersync" v={powersyncUrl} />
                </div>

                <div className="flex items-center justify-between px-4 py-2 text-bg/60">
                    <span>{tables.length} tables with rows</span>
                    <span className="tabular-nums">{totalRows} rows on device</span>
                </div>

                <div className="flex-1 overflow-auto px-4 pb-4">
                    {tables.length === 0 ? (
                        <div className="py-10 text-center text-bg/40">
                            no local rows yet — waiting for first sync…
                        </div>
                    ) : (
                        tables.map((t) => (
                            <div
                                key={t.table}
                                className="flex items-center justify-between border-b border-white/5 py-1"
                            >
                                <span>{t.table}</span>
                                <span className="tabular-nums text-bg/80">{t.rows}</span>
                            </div>
                        ))
                    )}
                </div>
            </aside>
        </div>
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
