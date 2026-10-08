import { useEffect, useRef, useState } from "react";

import { newIdempotencyKey } from "../api";
import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import type { ProgressStep } from "../ui";
import { type PublicBrand, usePublicResource } from "./publicResource";

interface PublicOrder {
    pickup_from: string | null;
    pickup_to: string | null;
    address: string | null;
    phone: string | null;
    number: number | null;
    business_name: string;
    brand: PublicBrand;
    status: string;
    pickup_status: string | null;
    created_at: string;
    preparing_at: string | null;
    ready_at: string | null;
    picked_up_at: string | null;
    notify_sms: boolean;
    refund_pending?: boolean;
    can_cancel: boolean;
    receipt_token: string | null;
    currency: string;
    subtotal_cents: number;
    tax_total_cents: number;
    total_cents: number;
    lines: { description: string; quantity: number; amount_cents: number }[];
    taxes: { code: string; cents: number }[];
}

export function createPublicOrderClient(baseUrl: string) {
    const request = async (token: string, alert?: boolean): Promise<PublicOrder> => {
        const response = await fetch(
            `${baseUrl}/order/${encodeURIComponent(token)}${alert === undefined ? "" : "/alerts"}`,
            alert === undefined
                ? undefined
                : {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ notify_sms: alert }),
                  },
        );
        if (!response.ok)
            throw Object.assign(new Error(strings.publicOrder.error), { status: response.status });
        return (await response.json()) as PublicOrder;
    };
    return {
        get: (token: string) => request(token),
        alerts: (token: string, value: boolean) => request(token, value),
        cancel: async (token: string, key: string): Promise<PublicOrder> => {
            const response = await fetch(`${baseUrl}/order/${encodeURIComponent(token)}/cancel`, {
                method: "POST",
                headers: { "Idempotency-Key": key },
            });
            if (!response.ok) throw new Error(strings.publicOrder.error);
            return (await response.json()) as PublicOrder;
        },
    };
}

export function usePublicOrder(client: ReturnType<typeof createPublicOrderClient>, token: string) {
    const resource = usePublicResource(client.get, token);
    const { busy, error, setError, run } = useAsyncAction();
    const { setData } = resource;
    const [confirmCancel, setConfirmCancel] = useState(false);
    const cancelKey = useRef<string | null>(null);
    useEffect(() => {
        let live = true;
        const refresh = (): void => {
            client
                .get(token)
                .then((data) => {
                    if (live) setData(data);
                })
                .catch(() => undefined);
        };
        const timer = setInterval(refresh, 15000);
        return () => {
            live = false;
            clearInterval(timer);
        };
    }, [client, token, setData]);
    const order = resource.data;
    const at =
        order?.pickup_status === "picked_up"
            ? 3
            : order?.pickup_status === "ready"
              ? 2
              : order?.pickup_status === "preparing"
                ? 1
                : 0;
    const s = strings.publicOrder;
    const labels = [s.placed, s.preparing, s.ready, s.collected];
    const dates = [order?.created_at, order?.preparing_at, order?.ready_at, order?.picked_up_at];
    const steps: ProgressStep[] = labels.map((label, index) => ({
        key: String(index),
        label,
        state: index < at ? "done" : index === at ? "current" : "todo",
    }));
    return {
        ...resource,
        order,
        busy,
        error,
        steps,
        dates,
        confirmCancel,
        setConfirmCancel,
        cancel: () => {
            cancelKey.current ??= newIdempotencyKey();
            const key = cancelKey.current;
            run(
                async () => {
                    const updated = await client.cancel(token, key);
                    setData(updated);
                    setConfirmCancel(false);
                    if (!updated.refund_pending && updated.status !== "refunded") {
                        cancelKey.current = null;
                        setError(s.cancelFailed);
                    }
                },
                { errorMessage: s.error },
            );
        },
        title: order?.refund_pending
            ? s.refundPending
            : order?.status === "refunded" || order?.status === "void"
              ? s.canceled
              : order?.status === "open"
                ? s.awaitingPayment
                : (labels[at] ?? s.placed),
        setAlerts: (value: boolean) => {
            run(
                async () => {
                    setData(await client.alerts(token, value));
                },
                { errorMessage: s.error },
            );
        },
    };
}
