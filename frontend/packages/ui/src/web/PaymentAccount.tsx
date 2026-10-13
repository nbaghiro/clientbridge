import { type PaymentAccountProps, strings } from "@clientbridge/app-core/public";
import {
    ConnectAccountManagement,
    ConnectAccountOnboarding,
    ConnectComponentsProvider,
    ConnectPayments,
    ConnectPayouts,
} from "@stripe/react-connect-js";
import { useRef } from "react";

import { Button } from "./Button";
import { Notice } from "./Notice";
import { Skeleton } from "./Skeleton";
import { type WebProps, cx } from "./props";
import { stripePublishableKey, useConnectInstance } from "./stripe";

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
    const key = stripePublishableKey();
    const { instance, failed, fail, retry } = useConnectInstance(fetchClientSecret, !preview, root);
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
                                <ConnectAccountOnboarding onExit={onClose} onLoadError={fail} />
                            ) : component === "account" ? (
                                <ConnectAccountManagement onLoadError={fail} />
                            ) : component === "payments" ? (
                                <ConnectPayments onLoadError={fail} />
                            ) : (
                                <ConnectPayouts onLoadError={fail} />
                            )}
                        </ConnectComponentsProvider>
                    )}
                </div>
            </div>
        </section>
    );
}
