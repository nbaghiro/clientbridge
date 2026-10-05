import {
    type Checkout,
    type CheckoutMethod,
    NEW_CARD,
    strings,
} from "@clientbridge/app-core/public";
import type { ReactNode } from "react";

import { CardForm } from "./CardForm";
import { field, panel, primaryButton, quietButton } from "./styles";

export interface ChargeSheetProps {
    checkout: Checkout;
    /** The client's saved methods, already labelled. */
    methods: CheckoutMethod[];
    amountLabel: string;
    stripeAccount: string;
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
                stripeAccount={stripeAccount}
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
            className={panel}
        >
            {title !== undefined ? (
                <h3 className="text-sm font-semibold text-ink">{title}</h3>
            ) : null}
            {children}
            <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                {strings.checkout.payment}
                <select
                    value={checkout.method}
                    onChange={(e) => {
                        checkout.setMethod(e.target.value);
                    }}
                    className={field}
                >
                    <option value={NEW_CARD}>
                        {checkout.allowNewCard
                            ? strings.checkout.newCard
                            : strings.checkout.selectSavedMethod}
                    </option>
                    {methods.map((m) => (
                        <option key={m.id} value={m.id}>
                            {m.label}
                        </option>
                    ))}
                </select>
            </label>
            {!checkout.allowNewCard && methods.length === 0 ? (
                <p className="text-xs text-muted">{strings.checkout.addMethodFirst}</p>
            ) : null}
            {checkout.error !== null ? (
                <p className="text-sm text-danger">{checkout.error}</p>
            ) : null}
            <div className="flex justify-end gap-2">
                <button type="button" onClick={onCancel} className={quietButton}>
                    {strings.common.cancel}
                </button>
                <button type="submit" disabled={checkout.busy} className={primaryButton}>
                    {checkout.busy ? busyLabel : submitLabel}
                </button>
            </div>
        </form>
    );
}
