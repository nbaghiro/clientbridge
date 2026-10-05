import { useRef, useState } from "react";

import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import { type ApiLike, newIdempotencyKey } from "../api";

/** The payment-method choice that means "enter a new card" rather than charge a saved one. */
export const NEW_CARD = "";

export interface CheckoutMethod {
    id: string;
    label: string;
}

export interface CheckoutCharge {
    paymentMethodId?: string;
    idempotencyKey: string;
}

export interface Checkout {
    method: string;
    setMethod: (id: string) => void;
    allowNewCard: boolean;
    busy: boolean;
    error: string | null;
    setError: (message: string | null) => void;
    /** Set once a new-card charge needs the customer to confirm the card. */
    clientSecret: string | null;
    pay: (charge: (input: CheckoutCharge) => Promise<object>, errorMessage: string) => void;
    complete: () => void;
    cancel: () => void;
}

/** One idempotency key per attempt, kept across retries so a double-submit can't double-charge. */
export function useCheckout(
    onDone: () => void,
    opts: { allowNewCard?: boolean; defaultMethod?: string } = {},
): Checkout {
    const allowNewCard = opts.allowNewCard ?? true;
    const [chosen, setChosen] = useState<string | null>(null);
    const [clientSecret, setClientSecret] = useState<string | null>(null);
    const { busy, error, setError, run } = useAsyncAction();
    const keyRef = useRef<string | null>(null);
    const method = chosen ?? opts.defaultMethod ?? NEW_CARD;

    const reset = (): void => {
        keyRef.current = null;
        setClientSecret(null);
        setError(null);
    };

    const finish = (): void => {
        reset();
        setChosen(null);
        onDone();
    };

    const pay: Checkout["pay"] = (charge, errorMessage) => {
        if (method === NEW_CARD && !allowNewCard) {
            setError(strings.checkout.chooseSavedMethod);
            return;
        }
        keyRef.current ??= newIdempotencyKey();
        const idempotencyKey = keyRef.current;
        run(
            async () => {
                const result = await charge(
                    method === NEW_CARD
                        ? { idempotencyKey }
                        : { paymentMethodId: method, idempotencyKey },
                );
                const secret = "client_secret" in result ? result.client_secret : null;
                if (method === NEW_CARD && typeof secret === "string") {
                    setClientSecret(secret);
                } else {
                    finish();
                }
            },
            { errorMessage },
        );
    };

    return {
        method,
        setMethod: (id) => {
            keyRef.current = null;
            setChosen(id);
        },
        allowNewCard,
        busy,
        error,
        setError,
        clientSecret,
        pay,
        complete: finish,
        cancel: reset,
    };
}

export interface SetupIntent {
    client_secret: string;
    stripe_account_id: string;
}

/** Open a Stripe SetupIntent to save a card for a client (confirmed client-side). */
export function startCardSetup(
    api: ApiLike,
    clientId: string,
    idempotencyKey: string,
): Promise<SetupIntent> {
    return api.post<SetupIntent>(`/v1/payments/setup-intent/${clientId}`, {}, { idempotencyKey });
}

/** Open a SetupIntent for an ACSS/PAD (pre-authorized debit) bank mandate. */
export function startPadSetup(
    api: ApiLike,
    clientId: string,
    idempotencyKey: string,
): Promise<SetupIntent> {
    return api.post<SetupIntent>(
        `/v1/payments/pad-setup-intent/${clientId}`,
        {},
        { idempotencyKey },
    );
}

export type SetupKind = "card" | "bank";

export interface AddPaymentMethod {
    kind: SetupKind | null;
    intent: SetupIntent | null;
    busy: boolean;
    error: string | null;
    start: (kind: SetupKind) => void;
    cancel: () => void;
    complete: () => void;
    setError: (message: string | null) => void;
}

/** The platform's PaymentMethodForm confirms the SetupIntent and then calls `complete`. */
export function useAddPaymentMethod(
    api: ApiLike,
    clientId: string,
    onDone: () => void,
): AddPaymentMethod {
    const [kind, setKind] = useState<SetupKind | null>(null);
    const [intent, setIntent] = useState<SetupIntent | null>(null);
    const { busy, error, setError, run } = useAsyncAction();
    const attemptRef = useRef<{ kind: SetupKind; key: string } | null>(null);

    const reset = (): void => {
        attemptRef.current = null;
        setKind(null);
        setIntent(null);
        setError(null);
    };

    const start = (next: SetupKind): void => {
        setKind(next);
        setIntent(null);
        if (attemptRef.current?.kind !== next) {
            attemptRef.current = { kind: next, key: newIdempotencyKey() };
        }
        const { key } = attemptRef.current;
        run(
            async () => {
                setIntent(
                    next === "card"
                        ? await startCardSetup(api, clientId, key)
                        : await startPadSetup(api, clientId, key),
                );
            },
            { errorMessage: strings.payments.setupStartError },
        );
    };

    return {
        kind,
        intent,
        busy,
        error,
        start,
        cancel: reset,
        complete: () => {
            reset();
            onDone();
        },
        setError,
    };
}
