import type { ShellTarget } from "@clientbridge/app-core";
import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

// `new` opens a target's create form and `open` one record; pages read both with useLinkIntent.
const PATHS: Record<ShellTarget, string> = {
    today: "/today",
    schedule: "/schedule",
    booking: "/schedule",
    hours: "/setup/team",
    sale: "/payments/sales",
    checkout: "/payments/sales",
    orders: "/payments/sales",
    invoices: "/payments/invoices",
    invoice: "/payments/invoices",
    estimate: "/payments/invoices?doc=estimates",
    payments: "/payments",
    giftCards: "/payments/gift-cards",
    refunds: "/payments/refunds",
    clients: "/clients",
    client: "/clients",
    inbox: "/inbox",
    message: "/inbox",
    reviews: "/inbox?segment=reviews",
    stock: "/setup/services",
    catalog: "/setup/services",
    reports: "/payments/reports",
    staffPay: "/payments/staff-pay",
    business: "/setup/business",
    team: "/setup/team",
    gettingPaid: "/setup/getting-paid",
    onlineBooking: "/setup/online-booking",
    search: "/today",
    notifications: "/today",
};

const CREATES = new Set<ShellTarget>(["booking", "client", "invoice", "estimate", "message"]);

export function linkPath(target: ShellTarget, refId: string | null = null): string {
    const base = PATHS[target];
    const join = base.includes("?") ? "&" : "?";
    if (refId !== null) return `${base}${join}open=${encodeURIComponent(refId)}`;
    return CREATES.has(target) ? `${base}${join}new=1` : base;
}

export interface ShellControls {
    openSearch: () => void;
    openNotifications: () => void;
}

export const ShellContext = createContext<ShellControls>({
    openSearch: () => undefined,
    openNotifications: () => undefined,
});

/** Opens what a shell target names: a page, a record, a create form, search or the bell. */
export function useOpenLink(): (target: ShellTarget, refId?: string | null) => void {
    const navigate = useNavigate();
    const shell = useContext(ShellContext);
    return useCallback(
        (target, refId = null) => {
            if (target === "search") shell.openSearch();
            else if (target === "notifications") shell.openNotifications();
            else {
                const done = navigate(linkPath(target, refId));
                if (done) done.catch(() => undefined);
            }
        },
        [navigate, shell],
    );
}

/** A page's part of a deep link: run `onCreate` or `onOpen` once, then drop the params. */
export function useLinkIntent(handlers: {
    onCreate?: () => void;
    onOpen?: (id: string) => void;
}): URLSearchParams {
    const [params, setParams] = useSearchParams();
    const create = params.get("new");
    const open = params.get("open");
    const latest = useRef(handlers);
    latest.current = handlers;
    useEffect(() => {
        if (create === null && open === null) return;
        if (create !== null) latest.current.onCreate?.();
        if (open !== null) latest.current.onOpen?.(open);
        setParams(
            (p) => {
                p.delete("new");
                p.delete("open");
                return p;
            },
            { replace: true },
        );
    }, [create, open, setParams]);
    return params;
}
