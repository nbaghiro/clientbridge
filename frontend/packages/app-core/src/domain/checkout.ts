import type { PublicBrand } from "./publicResource";
import { useCallback, useRef, useState } from "react";

import { usePublicResource } from "./publicResource";
import { useAsyncAction, useBusinessQuery, useRemote } from "../hooks";
import { formatDate, parseTimestamp, useBusinessZone } from "../datetime";
import { formatPhone } from "../format";
import { strings } from "../strings";
import {
    type ApiLike,
    type Attempt,
    attemptKey,
    failedStatus,
    failureMessage,
    newIdempotencyKey,
} from "../api";

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
    pay: (
        charge: (input: CheckoutCharge) => Promise<object>,
        errorMessage: string,
        request: unknown,
    ) => void;
    complete: () => void;
    cancel: () => void;
}

/** A server without Stripe keys answers 503; say so instead of asking the user to retry. */
export function paymentErrorMessage(e: unknown, fallback: string): string {
    return failedStatus(e) === 503 ? strings.payments.notConfigured : failureMessage(e, fallback);
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
    const keyRef = useRef<Attempt | null>(null);
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

    const pay: Checkout["pay"] = (charge, errorMessage, request) => {
        if (method === NEW_CARD && !allowNewCard) {
            setError(strings.checkout.chooseSavedMethod);
            return;
        }
        const idempotencyKey = attemptKey(keyRef, [method, request]);
        run(async () => {
            let result: object;
            try {
                result = await charge(
                    method === NEW_CARD
                        ? { idempotencyKey }
                        : { paymentMethodId: method, idempotencyKey },
                );
            } catch (e) {
                // only a declined card is final; anything else may have charged, so it keeps its key
                if (failedStatus(e) === 402) keyRef.current = null;
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
    texted: boolean;
}

interface OpenBankLink {
    id: string;
    verifying: boolean;
    expires_at: string;
}

type SetupKind = "card" | "bank";

const CLIENT_PHONE_SQL = `SELECT phone FROM clients WHERE id = ?`;
const CLIENT_BANKS_SQL = `SELECT id, mandate_status FROM payment_methods
WHERE client_id = ? AND method = 'bank_eft' ORDER BY id`;

export interface AddPaymentMethod {
    kind: SetupKind | null;
    intent: SetupIntent | null;
    bankLink: BankSetupLink | null;
    /** The client's earlier link while it is still open: what it waits on, and whether Stripe has it. */
    openBankLink: { note: string; verifying: boolean } | null;
    /** The client's mobile number as shown, or null when they can't be texted the link. */
    textTo: string | null;
    requestBankLink: (text: boolean) => void;
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
    const [created, setCreated] = useState<{ link: BankSetupLink; banks: string } | null>(null);
    const { busy, error, setError, run } = useAsyncAction();
    const attemptRef = useRef<{ kind: SetupKind; key: string } | null>(null);
    const zone = useBusinessZone();
    const phone = useBusinessQuery<{ phone: string | null }>(CLIENT_PHONE_SQL, [clientId]).data[0]
        ?.phone;
    const loadOpen = useCallback(
        () => api.get<OpenBankLink | null>(`/v1/payments/pad-links/${clientId}`),
        [api, clientId],
    );
    const banks = useBusinessQuery<{ id: string; mandate_status: string | null }>(
        CLIENT_BANKS_SQL,
        [clientId],
    ).data;
    // a bank that arrives or changes its mandate is the client acting on the link
    const banksKey = banks.map((b) => `${b.id}:${b.mandate_status ?? ""}`).join(",");
    const open = useRemote(loadOpen, `${clientId}|${banksKey}`);
    const bankLink = created?.banks === banksKey ? created.link : null;
    const openLink = bankLink === null ? open.data : null;

    const reset = (): void => {
        attemptRef.current = null;
        setKind(null);
        setIntent(null);
        setCreated(null);
        setError(null);
    };

    const start = (next: SetupKind): void => {
        setKind(next);
        setIntent(null);
        setError(null);
        if (next === "bank") {
            open.refresh().catch(() => undefined);
            return;
        }
        if (attemptRef.current?.kind !== next) {
            attemptRef.current = { kind: next, key: newIdempotencyKey() };
        }
        const { key } = attemptRef.current;
        run(async () => {
            try {
                setIntent(await startCardSetup(api, clientId, key));
            } catch (e) {
                setError(paymentErrorMessage(e, strings.payments.setupStartError));
            }
        });
    };

    return {
        kind,
        intent,
        bankLink,
        openBankLink:
            openLink === null
                ? null
                : {
                      verifying: openLink.verifying,
                      note: openLink.verifying
                          ? strings.checkout.bankLinkVerifying
                          : strings.checkout.bankLinkWaiting(
                                formatDate(parseTimestamp(openLink.expires_at), zone),
                            ),
                  },
        textTo: phone ? formatPhone(phone) : null,
        requestBankLink: (text) => {
            run(async () => {
                try {
                    const link = await api.post<BankSetupLink>(
                        `/v1/payments/pad-links/${clientId}`,
                        { text },
                    );
                    setCreated({ link, banks: banksKey });
                    await open.refresh();
                } catch (e) {
                    setError(failureMessage(e, strings.checkout.bankLinkStaffError));
                }
            });
        },
        revokeBankLink: () => {
            const id = bankLink?.id ?? openLink?.id;
            if (id === undefined) return;
            run(
                async () => {
                    await api.delete(`/v1/payments/pad-links/${id}`);
                    setCreated(null);
                    await open.refresh();
                },
                { errorMessage: strings.checkout.bankLinkStaffError },
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
    start: (token: string, email: string) => Promise<PublicPaymentSetup>;
}

// the shape the server issues; anything else can't be a link, so it isn't sent
const SETUP_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function createPublicPaymentSetupClient(baseUrl: string): PublicPaymentSetupClient {
    const request = async (token: string, email?: string): Promise<PublicPaymentSetup> => {
        if (!SETUP_TOKEN.test(token)) throw Object.assign(new Error(), { status: 404 });
        const starting = email !== undefined;
        const response = await fetch(`${baseUrl}/payment-method${starting ? "/start" : ""}`, {
            method: starting ? "POST" : "GET",
            headers: {
                "X-Payment-Setup-Token": token,
                ...(starting ? { "Content-Type": "application/json" } : {}),
            },
            ...(email === undefined ? {} : { body: JSON.stringify({ email }) }),
            cache: "no-store",
        });
        if (!response.ok)
            throw Object.assign(new Error(response.statusText), { status: response.status });
        return (await response.json()) as PublicPaymentSetup;
    };
    return {
        get: (token) => request(token),
        start: (token, email) => request(token, email),
    };
}

export function usePublicPaymentSetup(client: PublicPaymentSetupClient, token: string) {
    const resource = usePublicResource(client.get, token);
    const action = useAsyncAction();
    const [payerEmail, setPayerEmail] = useState("");
    return {
        ...resource,
        payerEmail,
        setPayerEmail,
        busy: action.busy,
        error: action.error,
        start: () => {
            action.run(
                async () => {
                    resource.setData(await client.start(token, payerEmail.trim()));
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
