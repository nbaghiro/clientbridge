import { useConnectOnboarding } from "@clientbridge/app-core";

import { api } from "../lib/api";

export function PaymentsSettings() {
    const {
        phase,
        busy,
        error,
        headline,
        ctaLabel,
        showCta,
        requirements,
        payoutsEnabled,
        connect,
        refresh,
    } = useConnectOnboarding(api, (url) => {
        window.location.href = url;
    });

    return (
        <div>
            <h1 className="font-display text-2xl font-bold text-ink">Payments</h1>
            <p className="mt-1 text-sm text-muted">
                Take card payments through Stripe and get paid out to your bank.
            </p>

            <div className="mt-6 rounded-lg border border-line bg-surface p-6">
                {phase === "loading" ? (
                    <p className="text-sm text-muted">Loading…</p>
                ) : phase === "error" ? (
                    <>
                        <p className="text-sm text-danger">
                            We couldn’t load your payment status. Please try again.
                        </p>
                        <button
                            type="button"
                            onClick={refresh}
                            className="mt-4 rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink-soft transition hover:bg-bg"
                        >
                            Try again
                        </button>
                    </>
                ) : (
                    <>
                        <p
                            className={
                                phase === "disabled"
                                    ? "text-sm font-medium text-danger"
                                    : "text-sm font-medium text-ink"
                            }
                        >
                            {headline}
                        </p>
                        {phase === "enabled" && (
                            <p className="mt-1 text-sm text-muted">
                                {payoutsEnabled
                                    ? "Connected to Stripe. Payouts are active."
                                    : "Connected to Stripe. Payouts start once your bank details are verified."}
                            </p>
                        )}
                        {requirements.length > 0 && (
                            <ul className="mt-3 space-y-1">
                                {requirements.map((req) => (
                                    <li key={req} className="text-sm text-ink-soft">
                                        • {req}
                                    </li>
                                ))}
                            </ul>
                        )}
                        {showCta && (
                            <button
                                type="button"
                                onClick={connect}
                                disabled={busy}
                                className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-60"
                            >
                                {busy ? "Opening…" : ctaLabel}
                            </button>
                        )}
                    </>
                )}
                {error !== null && <p className="mt-3 text-sm text-danger">{error}</p>}
            </div>
        </div>
    );
}
