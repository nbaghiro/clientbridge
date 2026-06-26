import { useStatus } from "@powersync/react";

import { Logo } from "./icons";

// Intentionally near-blank: proves the sync engine is live (status dot) and hints at the hidden
// debug view. Real screens (calendar/clients/invoices) replace this.
export function Shell({ onSignOut }: { onSignOut: () => void }) {
    const status = useStatus();
    const label = status.connected ? "connected" : status.connecting ? "connecting…" : "offline";

    return (
        <div className="flex min-h-full flex-col items-center justify-center gap-7 p-8">
            <div className="flex flex-col items-center gap-3 text-center">
                <div className="flex items-center gap-2 text-accent">
                    <Logo className="h-6 w-6" />
                    <span className="text-xs font-semibold uppercase tracking-[0.25em]">
                        Clientbridge
                    </span>
                </div>
                <h1 className="max-w-md font-display text-3xl font-bold leading-tight text-ink">
                    The bridge between you and your clients.
                </h1>
            </div>

            <div className="flex items-center gap-2 text-sm text-ink-soft">
                <span
                    className={`h-2 w-2 rounded-full ${status.connected ? "bg-success" : "bg-muted"}`}
                />
                PowerSync · {label}
                {status.lastSyncedAt ? ` · synced ${status.lastSyncedAt.toLocaleTimeString()}` : ""}
            </div>

            <p className="text-xs text-muted">
                type{" "}
                <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-ink-soft">
                    debug
                </kbd>{" "}
                or press{" "}
                <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-ink-soft">
                    ⌘⇧D
                </kbd>{" "}
                to inspect client state
            </p>

            <button
                type="button"
                onClick={onSignOut}
                className="text-xs text-muted underline-offset-4 hover:text-ink-soft hover:underline"
            >
                Sign out
            </button>
        </div>
    );
}
