import { startOnboarding, useConnectStatus } from "@clientbridge/app-core";
import { useState } from "react";

import { api } from "../lib/api";

export function PaymentsSettings() {
    const status = useConnectStatus(api);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function connect(): Promise<void> {
        setBusy(true);
        setError(null);
        try {
            const { url } = await startOnboarding(api);
            window.location.href = url;
        } catch {
            setError("Couldn't start Stripe onboarding. Please try again.");
            setBusy(false);
        }
    }

    return (
        <div>
            <h1 className="font-display text-2xl font-bold text-ink">Payments</h1>
            <p className="mt-1 text-sm text-muted">
                Take card payments through Stripe and get paid out to your bank.
            </p>

            <div className="mt-6 rounded-lg border border-line bg-surface p-6">
                {status === null ? (
                    <p className="text-sm text-muted">Loading…</p>
                ) : status.charges_enabled ? (
                    <>
                        <p className="text-sm font-medium text-ink">
                            Payments enabled — you can take card payments.
                        </p>
                        <p className="mt-1 text-sm text-muted">Connected to Stripe.</p>
                    </>
                ) : status.connected ? (
                    <>
                        <p className="text-sm font-medium text-ink">
                            Onboarding in progress — finish your Stripe setup.
                        </p>
                        <button
                            type="button"
                            onClick={() => void connect()}
                            disabled={busy}
                            className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-60"
                        >
                            {busy ? "Opening…" : "Continue setup"}
                        </button>
                    </>
                ) : (
                    <>
                        <p className="text-sm font-medium text-ink">
                            Connect Stripe to take card payments and get paid out.
                        </p>
                        <button
                            type="button"
                            onClick={() => void connect()}
                            disabled={busy}
                            className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-60"
                        >
                            {busy ? "Opening…" : "Connect Stripe"}
                        </button>
                    </>
                )}
                {error !== null && <p className="mt-3 text-sm text-danger-fg">{error}</p>}
            </div>
        </div>
    );
}
