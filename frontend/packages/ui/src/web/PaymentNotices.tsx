import { type PaymentNoticesProps, strings } from "@clientbridge/app-core/public";
import { ConnectComponentsProvider, ConnectNotificationBanner } from "@stripe/react-connect-js";
import { useRef } from "react";

import { Button } from "./Button";
import { Notice } from "./Notice";
import { type WebProps, cx } from "./props";
import { stripePublishableKey, useConnectInstance } from "./stripe";

const s = strings.paymentAccount;

export function PaymentNotices(props: WebProps<PaymentNoticesProps>) {
    return <NoticesSession key={props.scope} {...props} />;
}

function NoticesSession({
    fetchClientSecret,
    preview = false,
    className,
}: WebProps<PaymentNoticesProps>) {
    const root = useRef<HTMLElement>(null);
    const live = !preview && stripePublishableKey() !== "";
    const { instance, failed, fail, retry } = useConnectInstance(fetchClientSecret, live, root);
    if (preview) {
        return (
            <section aria-label={s.notices} className={className}>
                <Notice tone="info" banner>
                    {s.preview}
                </Notice>
            </section>
        );
    }
    if (failed) {
        return (
            <section aria-label={s.notices} className={cx("space-y-2", className)}>
                <Notice tone="danger" banner>
                    {s.error}
                </Notice>
                <Button variant="outline" onPress={retry}>
                    {s.retry}
                </Button>
            </section>
        );
    }
    // Stripe draws the banner only while the account has open notices.
    return (
        <section ref={root} aria-label={s.notices} className={className}>
            {instance === null ? null : (
                <ConnectComponentsProvider connectInstance={instance}>
                    <ConnectNotificationBanner onLoadError={fail} />
                </ConnectComponentsProvider>
            )}
        </section>
    );
}
