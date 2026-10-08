import { type PaymentAccountProps, strings } from "@clientbridge/app-core/public";
import { themes } from "@clientbridge/tokens";
import { loadConnectAndInitialize, type StripeConnectInstance } from "@stripe/connect-js/pure";
import {
    ConnectAccountManagement,
    ConnectAccountOnboarding,
    ConnectComponentsProvider,
    ConnectPayments,
    ConnectPayouts,
} from "@stripe/react-connect-js";
import { useEffect, useRef, useState } from "react";

import { Button } from "./Button";
import { Notice } from "./Notice";
import { Skeleton } from "./Skeleton";
import { type WebProps, cx } from "./props";
import { prepareConnect, stripePublishableKey } from "./stripe";

const s = strings.paymentAccount;

export function PaymentAccount(props: WebProps<PaymentAccountProps>) {
    return <AccountSession key={props.scope} {...props} />;
}

function AccountSession({
    component,
    fetchClientSecret,
    onClose,
    preview = false,
    className,
}: WebProps<PaymentAccountProps>) {
    const root = useRef<HTMLDivElement>(null);
    const [instance, setInstance] = useState<StripeConnectInstance | null>(null);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const key = stripePublishableKey();
    useEffect(() => {
        if (key === "" || preview) return;
        let active = true;
        const isActive = (): boolean => active;
        const style = root.current ? getComputedStyle(root.current) : null;
        const color = (name: string, fallback: string): string => {
            const value = style?.getPropertyValue(name).trim() ?? "";
            return value === "" ? fallback : value;
        };
        let next: StripeConnectInstance | null = null;
        prepareConnect()
            .then(() => {
                if (!isActive()) return;
                next = loadConnectAndInitialize({
                    publishableKey: key,
                    fetchClientSecret: async () => {
                        if (!isActive()) throw new Error(s.expired);
                        try {
                            const secret = await fetchClientSecret();
                            if (!isActive()) throw new Error(s.expired);
                            return secret;
                        } catch (error) {
                            if (isActive()) setFailed(true);
                            throw error;
                        }
                    },
                    appearance: {
                        variables: {
                            colorPrimary: color("--accent", themes.pewter.color.accent),
                            colorText: color("--ink", themes.pewter.color.ink),
                            colorBackground: color("--surface", themes.pewter.color.surface),
                            colorDanger: color("--dan-fg", themes.pewter.color.danFg),
                            borderRadius: `${String(themes.pewter.radius.base)}px`,
                        },
                    },
                });
                setInstance(next);
            })
            .catch(() => {
                if (isActive()) setFailed(true);
            });
        return () => {
            active = false;
            if (next !== null) next.logout().catch(() => undefined);
        };
    }, [key, preview, fetchClientSecret, attempt]);
    const retry = (): void => {
        setFailed(false);
        setInstance(null);
        setAttempt((value) => value + 1);
    };
    return (
        <section aria-label={s[component]}>
            <div
                ref={root}
                className={cx(
                    "flex max-h-[90vh] flex-col rounded-xl border border-line bg-surface shadow-card",
                    className,
                )}
            >
                <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
                    <h2 className="font-display text-lg font-bold text-ink">{s[component]}</h2>
                    <Button variant="outline" onPress={onClose}>
                        {s.close}
                    </Button>
                </div>
                <div className="min-h-48 overflow-y-auto p-5">
                    {preview || key === "" ? (
                        <Notice tone="info">{preview ? s.preview : s.unavailable}</Notice>
                    ) : failed ? (
                        <div className="space-y-3">
                            <Notice tone="danger">{s.error}</Notice>
                            <Button variant="outline" onPress={retry}>
                                {s.retry}
                            </Button>
                        </div>
                    ) : instance === null ? (
                        <Skeleton variant="line" count={3} label={s.loading} />
                    ) : (
                        <ConnectComponentsProvider connectInstance={instance}>
                            {component === "onboarding" ? (
                                <ConnectAccountOnboarding
                                    onExit={onClose}
                                    onLoadError={() => {
                                        setFailed(true);
                                    }}
                                />
                            ) : component === "account" ? (
                                <ConnectAccountManagement
                                    onLoadError={() => {
                                        setFailed(true);
                                    }}
                                />
                            ) : component === "payments" ? (
                                <ConnectPayments
                                    onLoadError={() => {
                                        setFailed(true);
                                    }}
                                />
                            ) : (
                                <ConnectPayouts
                                    onLoadError={() => {
                                        setFailed(true);
                                    }}
                                />
                            )}
                        </ConnectComponentsProvider>
                    )}
                </div>
            </div>
        </section>
    );
}
