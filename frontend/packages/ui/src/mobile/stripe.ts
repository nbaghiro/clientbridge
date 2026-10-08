let publishableKey = "";

/** Each app sets the platform publishable key once at startup (it comes from that app's config). */
export function configureStripe(key: string | undefined): void {
    publishableKey = key ?? "";
}

let currentAccount = "";

/** On mobile the StripeProvider targets the account; this keeps the same call as web. */
export function setStripeAccount(account: string | null | undefined): void {
    currentAccount = account ?? "";
}

export function stripeAccount(): string {
    return currentAccount;
}

export function stripeConfigured(): boolean {
    return publishableKey !== "";
}

export function stripePublishableKey(): string {
    return publishableKey;
}
