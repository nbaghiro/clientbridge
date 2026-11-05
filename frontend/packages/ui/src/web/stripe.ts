import { activeLocale } from "@clientbridge/app-core/public";
import {
    type ColorKey,
    STRIPE_FONTS,
    cssVarName,
    stripeConnectAppearance,
    themes,
} from "@clientbridge/tokens";
import { loadConnectAndInitialize, type StripeConnectInstance } from "@stripe/connect-js/pure";
import { type Stripe, loadStripe } from "@stripe/stripe-js";
import { type RefObject, useEffect, useRef, useState } from "react";

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
        promise = loadStripe(publishableKey, {
            stripeAccount: account,
            // the sandbox testing assistant floats over the form's own buttons
            developerTools: { assistant: { enabled: false } },
        });
        byAccount.set(account, promise);
    }
    return promise;
}

export function stripePublishableKey(): string {
    return publishableKey;
}

/** Theme colours resolved at `element`, so a business's brand colour reaches Stripe's frames. */
export function resolvedColors(element: HTMLElement | null): (key: ColorKey) => string {
    const style = element ? getComputedStyle(element) : null;
    return (key) => {
        const value = style?.getPropertyValue(cssVarName(key)).trim() ?? "";
        // Stripe takes plain colours only, not var() or color-mix() expressions
        return /^(#|rgb)/.test(value) ? value : themes.pewter.color[key];
    };
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
    const current = useRef<StripeConnectInstance | null>(null);
    const key = publishableKey;
    useEffect(() => {
        if (key === "" || !enabled) return;
        let active = true;
        const isActive = (): boolean => active;
        // Connect.js fails every later component with the page's first session error, so never reject
        const closed = new Promise<string>(() => undefined);
        let next: StripeConnectInstance | null = null;
        prepareConnect()
            .then(() => {
                if (!isActive()) return;
                next = loadConnectAndInitialize({
                    publishableKey: key,
                    fetchClientSecret: () =>
                        isActive()
                            ? fetchClientSecret().then(
                                  (secret) => (isActive() ? secret : closed),
                                  (error: unknown) => {
                                      if (!isActive()) return closed;
                                      setFailed(true);
                                      throw error;
                                  },
                              )
                            : closed,
                    appearance: stripeConnectAppearance(resolvedColors(root.current)),
                    fonts: STRIPE_FONTS,
                    locale: activeLocale("stripe"),
                });
                current.current = next;
                setInstance(next);
            })
            .catch(() => {
                if (isActive()) setFailed(true);
            });
        return () => {
            active = false;
            current.current = null;
            if (next !== null) next.logout().catch(() => undefined);
        };
    }, [key, enabled, fetchClientSecret, attempt, root]);
    return {
        instance,
        failed,
        fail: () => {
            if (instance !== null && instance === current.current) setFailed(true);
        },
        retry: () => {
            setFailed(false);
            setInstance(null);
            setAttempt((value) => value + 1);
        },
    };
}
