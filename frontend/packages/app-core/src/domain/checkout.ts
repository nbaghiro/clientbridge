import type { PublicBrand } from "./publicResource";
import { useRef, useState } from "react";

import { usePublicResource } from "./publicResource";
import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import { type ApiLike, failedStatus, newIdempotencyKey } from "../api";

/** The payment-method choice that means "enter a new card" rather than charge a saved one. */
export const NEW_CARD = "";

export interface CheckoutMethod {
    id: string;
    label: string;
}

interface CheckoutCharge {
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

/** A server without Stripe keys answers 503; say so instead of asking the user to retry. */
export function paymentErrorMessage(e: unknown, fallback: string): string {
    return failedStatus(e) === 503 ? strings.payments.notConfigured : fallback;
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
        run(async () => {
            let result: object;
            try {
                result = await charge(
                    method === NEW_CARD
                        ? { idempotencyKey }
                        : { paymentMethodId: method, idempotencyKey },
                );
            } catch (e) {
                setError(paymentErrorMessage(e, errorMessage));
                return;
            }
            const secret = "client_secret" in result ? result.client_secret : null;
            if (typeof secret === "string" && method === NEW_CARD) {
                setClientSecret(secret);
            } else {
                finish();
            }
        });
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

interface SetupIntent {
    client_secret: string;
    stripe_account_id: string;
}

function startCardSetup(
    api: ApiLike,
    clientId: string,
    idempotencyKey: string,
): Promise<SetupIntent> {
    return api.post<SetupIntent>(`/v1/payments/setup-intent/${clientId}`, {}, { idempotencyKey });
}

interface BankSetupLink {
    id: string;
    url: string;
    expires_at: string;
}

type SetupKind = "card" | "bank";

export interface AddPaymentMethod {
    kind: SetupKind | null;
    intent: SetupIntent | null;
    bankLink: BankSetupLink | null;
    revokeBankLink: () => void;
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
    const [bankLink, setBankLink] = useState<BankSetupLink | null>(null);
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
        run(async () => {
            try {
                if (next === "card") setIntent(await startCardSetup(api, clientId, key));
                else
                    setBankLink(
                        await api.post<BankSetupLink>(`/v1/payments/pad-links/${clientId}`, {}),
                    );
            } catch (e) {
                setError(
                    next === "bank" && failedStatus(e) === 409
                        ? strings.checkout.bankLinkRequirements
                        : paymentErrorMessage(e, strings.payments.setupStartError),
                );
            }
        });
    };

    return {
        kind,
        intent,
        bankLink,
        revokeBankLink: () => {
            if (bankLink === null) return;
            run(
                async () => {
                    await api.delete(`/v1/payments/pad-links/${bankLink.id}`);
                    setBankLink(null);
                },
                { errorMessage: strings.checkout.bankLinkError },
            );
        },
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

interface PublicPaymentSetup {
    brand: PublicBrand;
    business_name: string;
    client_name: string;
    expires_at: string;
    status: string;
    stripe_account_id: string;
    client_secret: string | null;
    verification_url: string | null;
}

interface PublicPaymentSetupClient {
    get: (token: string) => Promise<PublicPaymentSetup>;
    start: (token: string) => Promise<PublicPaymentSetup>;
}

export function createPublicPaymentSetupClient(baseUrl: string): PublicPaymentSetupClient {
    const request = async (token: string, start = false): Promise<PublicPaymentSetup> => {
        const response = await fetch(`${baseUrl}/payment-method${start ? "/start" : ""}`, {
            method: start ? "POST" : "GET",
            headers: { "X-Payment-Setup-Token": token },
            cache: "no-store",
        });
        if (!response.ok)
            throw Object.assign(new Error(response.statusText), { status: response.status });
        return (await response.json()) as PublicPaymentSetup;
    };
    return { get: (token) => request(token), start: (token) => request(token, true) };
}

export function usePublicPaymentSetup(client: PublicPaymentSetupClient, token: string) {
    const resource = usePublicResource(client.get, token);
    const action = useAsyncAction();
    return {
        ...resource,
        busy: action.busy,
        error: action.error,
        start: () => {
            action.run(
                async () => {
                    resource.setData(await client.start(token));
                },
                { errorMessage: strings.checkout.bankLinkError },
            );
        },
        refresh: () => {
            action.run(
                async () => {
                    resource.setData(await client.get(token));
                },
                { errorMessage: strings.checkout.bankLinkError },
            );
        },
    };
}
