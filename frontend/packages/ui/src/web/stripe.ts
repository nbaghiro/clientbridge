import { strings } from "@clientbridge/app-core/public";
import { themes } from "@clientbridge/tokens";
import { loadConnectAndInitialize, type StripeConnectInstance } from "@stripe/connect-js/pure";
import { type Stripe, loadStripe } from "@stripe/stripe-js";
import { type RefObject, useEffect, useState } from "react";

let publishableKey = "";
const byAccount = new Map<string, Promise<Stripe | null>>();

/** Each app sets the platform publishable key once at startup (it comes from that app's env). */
export function configureStripe(key: string | undefined): void {
    publishableKey = key ?? "";
}

let currentAccount = "";

/** The app keeps the signed-in business's connected account here so checkouts don't pass it around. */
export function setStripeAccount(account: string | null | undefined): void {
    currentAccount = account ?? "";
}

export function stripeAccount(): string {
    return currentAccount;
}

/** Stripe.js bound to a connected account (direct charges), or null when payments aren't set up. */
export function stripeFor(account: string): Promise<Stripe | null> | null {
    if (publishableKey === "" || account === "") return null;
    let promise = byAccount.get(account);
    if (promise === undefined) {
        promise = loadStripe(publishableKey, { stripeAccount: account });
        byAccount.set(account, promise);
    }
    return promise;
}

export function stripePublishableKey(): string {
    return publishableKey;
}

let connectScript: Promise<void> | null = null;

function prepareConnect(): Promise<void> {
    if (connectScript !== null) return connectScript;
    connectScript = new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://connect-js.stripe.com/v1.0/connect.js";
        script.async = true;
        const timer = window.setTimeout(fail, 20_000);
        function fail(): void {
            window.clearTimeout(timer);
            script.remove();
            connectScript = null;
            reject(new Error("connect_script_unavailable"));
        }
        script.addEventListener(
            "load",
            () => {
                window.clearTimeout(timer);
                resolve();
            },
            { once: true },
        );
        script.addEventListener("error", fail, { once: true });
        document.head.appendChild(script);
    });
    return connectScript;
}

interface ConnectSession {
    instance: StripeConnectInstance | null;
    failed: boolean;
    fail: () => void;
    retry: () => void;
}

/** One Connect.js instance per embedded session, themed from the CSS tokens under `root`. */
export function useConnectInstance(
    fetchClientSecret: () => Promise<string>,
    enabled: boolean,
    root: RefObject<HTMLElement | null>,
): ConnectSession {
    const [instance, setInstance] = useState<StripeConnectInstance | null>(null);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const key = publishableKey;
    useEffect(() => {
        if (key === "" || !enabled) return;
        let active = true;
        const isActive = (): boolean => active;
        const style = root.current ? getComputedStyle(root.current) : null;
        const color = (name: string, fallback: string): string => {
            const value = style?.getPropertyValue(name).trim() ?? "";
            return value === "" ? fallback : value;
        };
        let next: StripeConnectInstance | null = null;
        prepareConnect()
            .then(() => {
                if (!isActive()) return;
                next = loadConnectAndInitialize({
                    publishableKey: key,
                    fetchClientSecret: async () => {
                        if (!isActive()) throw new Error(strings.paymentAccount.expired);
                        try {
                            const secret = await fetchClientSecret();
                            if (!isActive()) throw new Error(strings.paymentAccount.expired);
                            return secret;
                        } catch (error) {
                            if (isActive()) setFailed(true);
                            throw error;
                        }
                    },
                    appearance: {
                        variables: {
                            colorPrimary: color("--accent", themes.pewter.color.accent),
                            colorText: color("--ink", themes.pewter.color.ink),
                            colorBackground: color("--surface", themes.pewter.color.surface),
                            colorDanger: color("--dan-fg", themes.pewter.color.danFg),
                            borderRadius: `${String(themes.pewter.radius.base)}px`,
                        },
                    },
                });
                setInstance(next);
            })
            .catch(() => {
                if (isActive()) setFailed(true);
            });
        return () => {
            active = false;
            if (next !== null) next.logout().catch(() => undefined);
        };
    }, [key, enabled, fetchClientSecret, attempt, root]);
    return {
        instance,
        failed,
        fail: () => {
            setFailed(true);
        },
        retry: () => {
            setFailed(false);
            setInstance(null);
            setAttempt((value) => value + 1);
        },
    };
}
