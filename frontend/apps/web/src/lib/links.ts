import {
    type ShellTarget,
    clearTasks,
    openTask,
    taskFor,
    unsavedConfirm,
} from "@clientbridge/app-core";
import { confirm } from "@clientbridge/ui";
import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import { useBlocker, useLocation, useNavigate, useSearchParams } from "react-router-dom";

// `new` opens a page's own create form and `open` one record; pages read both with useLinkIntent.
const PATHS: Record<ShellTarget, string> = {
    today: "/today",
    schedule: "/schedule",
    booking: "/schedule",
    hours: "/setup/team#hours",
    sale: "/payments/sales",
    checkout: "/payments/sales",
    orders: "/payments/sales?view=board",
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
    taxReturns: "/payments/tax",
    payouts: "/payments/payouts",
    business: "/setup/business",
    brand: "/setup/business#brand",
    setup: "/setup/start",
    taxes: "/setup/taxes",
    team: "/setup/team",
    gettingPaid: "/setup/getting-paid",
    onlineBooking: "/setup/online-booking",
    search: "/today",
    notifications: "/today",
};

const CREATES = new Set<ShellTarget>(["message"]);

export function linkPath(target: ShellTarget, refId: string | null = null): string {
    const base = PATHS[target];
    const join = base.includes("?") ? "&" : "?";
    if (refId !== null) return `${base}${join}open=${encodeURIComponent(refId)}`;
    return CREATES.has(target) ? `${base}${join}new=1` : base;
}

/** Asks before an in-app link or a reload throws away unsaved edits. */
export function useLeaveGuard(dirty: boolean): void {
    const blocker = useBlocker(
        ({ currentLocation, nextLocation }) =>
            dirty && currentLocation.pathname !== nextLocation.pathname,
    );
    useEffect(() => {
        if (blocker.state !== "blocked") return;
        confirm(unsavedConfirm("leave"))
            .then((ok) => {
                if (ok) blocker.proceed();
                else blocker.reset();
            })
            .catch(() => {
                blocker.reset();
            });
    }, [blocker]);
    useEffect(() => {
        if (!dirty) return;
        const warn = (event: BeforeUnloadEvent): void => {
            event.preventDefault();
        };
        window.addEventListener("beforeunload", warn);
        return () => {
            window.removeEventListener("beforeunload", warn);
        };
    }, [dirty]);
}

/** Lands on the section a link's hash names, staying on it while sections above it finish loading. */
export function useScrollToHash(ready: boolean): void {
    const { hash } = useLocation();
    useEffect(() => {
        const target = ready ? document.getElementById(hash.slice(1)) : null;
        if (target === null) return;
        const land = (): void => {
            target.scrollIntoView();
        };
        land();
        const settling = new ResizeObserver(land);
        if (target.parentElement !== null) settling.observe(target.parentElement);
        const stop = setTimeout(() => {
            settling.disconnect();
        }, 1500);
        return () => {
            clearTimeout(stop);
            settling.disconnect();
        };
    }, [hash, ready]);
}

export interface ShellControls {
    openSearch: () => void;
    openNotifications: () => void;
}

export const ShellContext = createContext<ShellControls>({
    openSearch: () => undefined,
    openNotifications: () => undefined,
});

/** Starts a task in place, or opens the page, search or the bell a shell target names. */
export function useOpenLink(): (target: ShellTarget, refId?: string | null) => void {
    const navigate = useNavigate();
    const shell = useContext(ShellContext);
    return useCallback(
        (target, refId = null) => {
            const task = taskFor(target, refId);
            if (task !== null) {
                openTask(task);
                return;
            }
            clearTasks();
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
