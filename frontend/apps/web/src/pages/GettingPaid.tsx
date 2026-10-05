import { strings, useConnectOnboarding } from "@clientbridge/app-core";

import { Button, Notice } from "@clientbridge/ui";
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
                        <Notice tone="danger">{strings.gettingPaid.loadError}</Notice>
                        <div className="mt-4">
                            <Button variant="outline" onPress={refresh}>
                                {strings.gettingPaid.tryAgain}
                            </Button>
                        </div>
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
                            <div className="mt-4">
                                <Button onPress={connect} busy={busy}>
                                    {busy ? strings.gettingPaid.opening : ctaLabel}
                                </Button>
                            </div>
                        )}
                    </>
                )}
                {error !== null && (
                    <div className="mt-3">
                        <Notice tone="danger">{error}</Notice>
                    </div>
                )}
            </div>
        </div>
    );
}
