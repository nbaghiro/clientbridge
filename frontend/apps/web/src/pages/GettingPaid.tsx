import { strings, useConnectOnboarding } from "@clientbridge/app-core";

import { primaryButton } from "@clientbridge/ui";
import { api } from "../lib/api";

export function GettingPaid() {
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
            <p className="mt-1 text-sm text-muted">{strings.gettingPaid.subtitle}</p>

            <div className="mt-6 rounded-lg border border-line bg-surface p-6">
                {phase === "loading" ? (
                    <p className="text-sm text-muted">{strings.common.loading}</p>
                ) : phase === "error" ? (
                    <>
                        <p className="text-sm text-danger">{strings.gettingPaid.loadError}</p>
                        <button
                            type="button"
                            onClick={refresh}
                            className="mt-4 rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink-soft transition hover:bg-bg"
                        >
                            {strings.gettingPaid.tryAgain}
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
                                    ? strings.gettingPaid.payoutsActive
                                    : strings.gettingPaid.payoutsPending}
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
                                className={`${primaryButton} mt-4`}
                            >
                                {busy ? strings.gettingPaid.opening : ctaLabel}
                            </button>
                        )}
                    </>
                )}
                {error !== null && <p className="mt-3 text-sm text-danger">{error}</p>}
            </div>
        </div>
    );
}
