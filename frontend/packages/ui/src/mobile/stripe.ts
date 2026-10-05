let publishableKey = "";

/** Each app sets the platform publishable key once at startup (it comes from that app's config). */
export function configureStripe(key: string | undefined): void {
    publishableKey = key ?? "";
}

export function stripeConfigured(): boolean {
    return publishableKey !== "";
}
