// Pewter-themed shell — verifies the design tokens flow through Tailwind.
// Next: router, PowerSyncContext provider, and the dashboard / calendar / clients screens.
export function App() {
    return (
        <div className="flex min-h-full items-center justify-center p-8">
            <div className="w-full max-w-md rounded border-card border-line bg-surface p-8 shadow-card">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-accent">
                    Clientbridge
                </div>
                <h1 className="font-display text-2xl font-bold leading-tight text-ink">
                    The bridge between you and your clients.
                </h1>
                <p className="mt-3 text-sm text-ink-soft">
                    Web shell is wired to the Pewter design system. Offline-first via PowerSync,
                    server-authoritative through FastAPI.
                </p>
                <button className="mt-6 rounded bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:bg-accent-strong">
                    Get started
                </button>
            </div>
        </div>
    );
}
