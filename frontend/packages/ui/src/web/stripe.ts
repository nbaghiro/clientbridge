import { type Stripe, loadStripe } from "@stripe/stripe-js";

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

export function prepareConnect(): Promise<void> {
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
