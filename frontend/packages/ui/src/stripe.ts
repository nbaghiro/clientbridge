import { type Stripe, loadStripe } from "@stripe/stripe-js";

let publishableKey = "";
const byAccount = new Map<string, Promise<Stripe | null>>();

/** Each app sets the platform publishable key once at startup (it comes from that app's env). */
export function configureStripe(key: string | undefined): void {
    publishableKey = key ?? "";
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
