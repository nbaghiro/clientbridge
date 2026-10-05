import { useStripeAccountId } from "@clientbridge/app-core";
import { StripeProvider } from "@stripe/stripe-react-native";
import type { ReactElement } from "react";

import { stripeMerchantId, stripePublishableKey } from "../lib/config";

const URL_SCHEME = "clientbridge";

// A native module: needs an Expo dev build and a publishable key; it does not run in Expo Go.

/** Charges go directly to the business's connected Stripe account; with no key the card forms say so. */
export function StripeAppProvider({ children }: { children: ReactElement }) {
    const account = useStripeAccountId();
    if (stripePublishableKey.length === 0) return children;
    // Omit stripeAccountId entirely until the connected account has synced (exactOptionalPropertyTypes).
    const accountProp = account !== null ? { stripeAccountId: account } : {};
    return (
        <StripeProvider
            publishableKey={stripePublishableKey}
            merchantIdentifier={stripeMerchantId}
            urlScheme={URL_SCHEME}
            {...accountProp}
        >
            {children}
        </StripeProvider>
    );
}
