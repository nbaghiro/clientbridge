import { useQuery } from "@powersync/react";
import { useState } from "react";

import type { ApiLike } from "../util/api";
import type { Intent } from "../util/intent";
import { useInteractivePurchase } from "./payments";

export interface PackageRow {
    id: string;
    client_id: string;
    item_id: string;
    item_name: string | null;
    sessions_total: number;
    sessions_used: number;
    status: string;
}

const CLIENT_PACKAGES_SQL = `
SELECT p.id, p.client_id, p.item_id, i.name AS item_name,
       p.sessions_total, p.sessions_used, p.status
FROM packages p LEFT JOIN items i ON i.id = p.item_id
WHERE p.client_id = ? ORDER BY p.created_at DESC`;

export function useClientPackages(clientId: string): PackageRow[] {
    return useQuery<PackageRow>(CLIENT_PACKAGES_SQL, [clientId]).data;
}

export function packageStatusIntent(status: string): Intent {
    switch (status) {
        case "active":
            return "success";
        case "pending":
            return "accent";
        case "expired":
            return "danger";
        default:
            return "neutral"; // used, canceled
    }
}

export function sessionsRemaining(pkg: PackageRow): number {
    return Math.max(0, pkg.sessions_total - pkg.sessions_used);
}

/** A session can be drawn down only from an active package with sessions left. */
export function canConsume(pkg: PackageRow): boolean {
    return pkg.status === "active" && pkg.sessions_used < pkg.sessions_total;
}

export interface PackagePurchaseInput {
    client_id: string;
    item_id: string;
    payment_method_id?: string | undefined;
}

export interface PackagePurchaseResult {
    package_id: string;
    payment_id: string;
    client_secret: string;
}

export function purchasePackage(
    api: ApiLike,
    input: PackagePurchaseInput,
    idempotencyKey: string,
): Promise<PackagePurchaseResult> {
    return api.post<PackagePurchaseResult>("/v1/packages", input, { idempotencyKey });
}

export function consumeSession(api: ApiLike, packageId: string): Promise<PackageRow> {
    return api.post<PackageRow>(`/v1/packages/${packageId}/consume`, {});
}

export interface PackageSaleForm {
    itemId: string;
    setItemId: (v: string) => void;
    paymentMethodId: string; // "" = pay with a new card (interactive)
    setPaymentMethodId: (v: string) => void;
    busy: boolean;
    error: string | null;
    clientSecret: string | null;
    submit: () => void;
    cancel: () => void;
    complete: () => void;
}

/** Sell-package form: pick a `kind="package"` item + a saved card (off-session) or a new card
 *  (interactive Elements confirm). Mirrors `useSubscriptionForm` over the shared purchase seam. */
export function usePackageSaleForm(
    api: ApiLike,
    clientId: string,
    onDone: () => void,
): PackageSaleForm {
    const [itemId, setItemId] = useState("");
    const [paymentMethodId, setPaymentMethodId] = useState("");
    const purchase = useInteractivePurchase(() => {
        setItemId("");
        setPaymentMethodId("");
        onDone();
    });

    const submit = (): void => {
        if (itemId === "") {
            purchase.setError("Choose a package");
            return;
        }
        const interactive = paymentMethodId === "";
        purchase.submit(
            (idempotencyKey) =>
                purchasePackage(
                    api,
                    {
                        client_id: clientId,
                        item_id: itemId,
                        payment_method_id: interactive ? undefined : paymentMethodId,
                    },
                    idempotencyKey,
                ),
            interactive,
            "Couldn't sell this package. Please try again.",
        );
    };

    return {
        itemId,
        setItemId,
        paymentMethodId,
        setPaymentMethodId,
        busy: purchase.busy,
        error: purchase.error,
        clientSecret: purchase.clientSecret,
        submit,
        cancel: purchase.cancel,
        complete: purchase.complete,
    };
}
