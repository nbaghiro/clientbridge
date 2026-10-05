import {
    type Checkout,
    type CheckoutMethod,
    NEW_CARD,
    strings,
} from "@clientbridge/app-core/public";
import type { ReactNode } from "react";

import { Button } from "./Button";
import { CardForm } from "./CardForm";
import { Select } from "./Field";
import { Notice } from "./Notice";
import { stripeAccount as currentStripeAccount } from "./stripe";

export interface ChargeSheetProps {
    checkout: Checkout;
    methods: CheckoutMethod[];
    amountLabel: string;
    // Defaults to the account the app set with setStripeAccount.
    stripeAccount?: string;
    submitLabel: string;
    busyLabel: string;
    onSubmit: () => void;
    onCancel: () => void;
    title?: string;
    /** The sale's own fields (what is being bought), shown above the payment choice. */
    children?: ReactNode;
}

export function ChargeSheet({
    checkout,
    methods,
    amountLabel,
    stripeAccount,
    submitLabel,
    busyLabel,
    onSubmit,
    onCancel,
    title,
    children,
}: ChargeSheetProps) {
    if (checkout.clientSecret !== null) {
        return (
            <CardForm
                clientSecret={checkout.clientSecret}
                stripeAccount={stripeAccount ?? currentStripeAccount()}
                submitLabel={strings.checkout.charge(amountLabel)}
                busyLabel={strings.checkout.charging}
                onDone={checkout.complete}
                onCancel={checkout.cancel}
            />
        );
    }
    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                onSubmit();
            }}
            className="mt-3 space-y-3 rounded-md border border-line bg-bg p-4"
        >
            {title !== undefined ? (
                <h3 className="text-sm font-semibold text-ink">{title}</h3>
            ) : null}
            {children}
            <Select
                label={strings.checkout.payment}
                value={checkout.method}
                options={[
                    {
                        key: NEW_CARD,
                        label: checkout.allowNewCard
                            ? strings.checkout.newCard
                            : strings.checkout.selectSavedMethod,
                    },
                    ...methods.map((m) => ({ key: m.id, label: m.label })),
                ]}
                onChange={checkout.setMethod}
            />
            {!checkout.allowNewCard && methods.length === 0 ? (
                <p className="text-xs text-muted">{strings.checkout.addMethodFirst}</p>
            ) : null}
            {checkout.error !== null ? <Notice tone="danger">{checkout.error}</Notice> : null}
            <div className="flex justify-end gap-2">
                <Button variant="quiet" onPress={onCancel}>
                    {strings.common.cancel}
                </Button>
                <Button submit busy={checkout.busy}>
                    {checkout.busy ? busyLabel : submitLabel}
                </Button>
            </div>
        </form>
    );
}
