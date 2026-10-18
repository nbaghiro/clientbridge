import { attemptKey, type Attempt } from "../api";
import { strings } from "../strings";
import type { Intent } from "../ui";
import { useEffect, useRef, useState } from "react";

export type AdminAccess = "loading" | "allowed" | "denied" | "signedOut" | "unavailable";

export async function checkAdminAccess(apiUrl: string): Promise<AdminAccess> {
    const response = await fetch(`${apiUrl}/admin/v1/session`, {
        credentials: "include",
        cache: "no-store",
    });
    if (response.status === 401) return "signedOut";
    if (response.status === 403) return "denied";
    return response.ok ? "allowed" : "unavailable";
}

export function useAdminAccess(
    check: () => Promise<AdminAccess>,
    subscribe: (refresh: () => void) => () => void,
) {
    const [access, setAccess] = useState<AdminAccess>("loading");
    useEffect(() => {
        let active = true;
        let generation = 0;
        const refresh = () => {
            const request = ++generation;
            check().then(
                (value) => {
                    if (active && request === generation) setAccess(value);
                },
                () => {
                    if (active && request === generation) setAccess("unavailable");
                },
            );
        };
        refresh();
        const unsubscribe = subscribe(refresh);
        return () => {
            active = false;
            unsubscribe();
        };
    }, [check, subscribe]);
    return access;
}

export type AdminSchemas = import("@clientbridge/api-client").components["schemas"] & {
    AdminEmails: import("@clientbridge/api-client").components["schemas"]["AdminEmail"][];
};

class AdminRequestError extends Error {
    constructor(readonly status: number) {
        super();
    }
}

async function adminRequest(base: string, path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${base}/admin/v1/${path}`, {
        credentials: "include",
        cache: "no-store",
        ...(body === undefined
            ? {}
            : {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(body),
              }),
    });
    if (!response.ok) throw new AdminRequestError(response.status);
    return (await response.json()) as unknown;
}

export function useAdminResource<K extends keyof AdminSchemas>(
    schema: K,
    base: string,
    path: string,
): { data: AdminSchemas[K] | null; error: number | null; refresh: () => void } {
    const [result, setResult] = useState<{
        path: string;
        data: AdminSchemas[K] | null;
        error: number | null;
    }>({
        path,
        data: null,
        error: null,
    });
    const [version, setVersion] = useState(0);
    useEffect(() => {
        let active = true;
        setResult({ path, data: null, error: null });
        adminRequest(base, path).then(
            (data) => {
                if (active) setResult({ path, data: data as AdminSchemas[K], error: null });
            },
            (error: unknown) => {
                if (active)
                    setResult({
                        path,
                        data: null,
                        error: error instanceof AdminRequestError ? error.status : 500,
                    });
            },
        );
        return () => {
            active = false;
        };
    }, [schema, base, path, version]);
    return {
        data: result.path === path ? result.data : null,
        error: result.path === path ? result.error : null,
        refresh: () => {
            setVersion((v) => v + 1);
        },
    };
}

export function useAdminFilters(initialBusiness = "", initialQuery = "", initialStatus = "") {
    const [query, setQuery] = useState(initialQuery);
    const [business, setBusiness] = useState(initialBusiness);
    const [status, setStatus] = useState(initialStatus);
    const [offset, setOffset] = useState(0);
    const [search, setSearch] = useState(initialQuery);
    useEffect(() => {
        const timer = setTimeout(() => {
            setSearch(query);
            setOffset(0);
        }, 250);
        return () => {
            clearTimeout(timer);
        };
    }, [query]);
    const params = new URLSearchParams({ q: search, offset: String(offset) });
    if (business) params.set("business_id", business);
    if (status) params.set("status", status);
    return {
        query,
        setQuery,
        business,
        setBusiness: (value: string) => {
            setBusiness(value);
            setOffset(0);
        },
        status,
        setStatus: (value: string) => {
            setStatus(value);
            setOffset(0);
        },
        offset,
        previous: () => {
            setOffset((v) => Math.max(0, v - 50));
        },
        next: () => {
            setOffset((v) => v + 50);
        },
        params: params.toString(),
    };
}

export function useAdminEmailForm(base: string) {
    const [recipient, setRecipient] = useState("");
    const [confirmed, setConfirmed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [outcome, setOutcome] = useState<AdminSchemas["AdminEmailResult"]["state"] | null>(null);
    const attempt = useRef<Attempt | null>(null);
    const sending = useRef(false);
    const send = (key: string, transport: "smtp" | "resend") => {
        if (sending.current || !confirmed) return;
        sending.current = true;
        const requestId = attemptKey(attempt, { key, transport, recipient });
        setBusy(true);
        setOutcome(null);
        adminRequest(base, `emails/${encodeURIComponent(key)}/send`, {
            recipient,
            transport,
            request_id: requestId,
        })
            .then(
                (data) => {
                    const result = data as AdminSchemas["AdminEmailResult"];
                    setOutcome(result.state);
                    if (result.state === "accepted" || result.state === "delivered")
                        attempt.current = null;
                },
                () => {
                    setOutcome("failed");
                },
            )
            .finally(() => {
                sending.current = false;
                setBusy(false);
                setConfirmed(false);
            })
            .catch(() => undefined);
    };
    return { recipient, setRecipient, confirmed, setConfirmed, busy, outcome, send };
}

export function adminLabel(value: string): string {
    const labels: Record<string, string> = {
        queued: strings.admin.valueQueued,
        sending: strings.admin.valueSending,
        accepted: strings.admin.valueAccepted,
        delivered: strings.admin.valueDelivered,
        ambiguous: strings.admin.valueAmbiguous,
        active: strings.admin.valueActive,
        closed: strings.admin.valueClosed,
        trialing: strings.admin.valueTrialing,
        premium: strings.admin.valuePremium,
        team: strings.admin.valueTeam,
        past_due: strings.admin.valuePastDue,
        lapsed: strings.admin.valueLapsed,
        pending: strings.admin.valuePending,
        succeeded: strings.admin.valueSucceeded,
        failed: strings.admin.valueFailed,
        canceled: strings.admin.valueCanceled,
        processed: strings.admin.valueProcessed,
        invited: strings.admin.valueInvited,
        removed: strings.admin.valueRemoved,
        owner: strings.admin.valueOwner,
        admin: strings.admin.valueAdmin,
        staff: strings.admin.valueStaff,
        contractor: strings.admin.valueContractor,
        payment: strings.admin.valuePayment,
        deposit: strings.admin.valueDeposit,
        refund: strings.admin.valueRefund,
        card: strings.admin.valueCard,
        etransfer: strings.admin.valueEtransfer,
        bank_eft: strings.admin.valueBankEft,
        cash: strings.admin.valueCash,
        cheque: strings.admin.valueCheque,
        other: strings.admin.valueOther,
        stripe: strings.admin.valueStripe,
        manual: strings.admin.valueManual,
        inactive: strings.admin.valueInactive,
        smtp: strings.admin.valueSmtp,
        resend: strings.admin.valueResend,
    };
    return labels[value] ?? value;
}

export function adminStatusIntent(status: string): Intent {
    if (["active", "succeeded", "processed", "accepted", "delivered"].includes(status))
        return "success";
    if (["failed", "past_due"].includes(status)) return "danger";
    if (["pending", "invited", "trialing", "queued", "sending", "ambiguous"].includes(status))
        return "warning";
    return "neutral";
}
export function groupAdminActivity(items: AdminSchemas["AdminActivity"][]) {
    const groups: Record<string, AdminSchemas["AdminActivity"][]> = {};
    for (const item of items) (groups[item.business_id] ??= []).push(item);
    return groups;
}
