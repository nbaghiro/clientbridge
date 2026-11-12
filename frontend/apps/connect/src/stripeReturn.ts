import {
    STRIPE_RETURN_PARAMS,
    type StripeReturn,
    stripeReturn,
} from "@clientbridge/app-core/public";
import { useEffect, useState } from "react";

/** Stripe's answer on a page it redirected back to, read once before the URL drops it. */
export function useStripeReturn(): StripeReturn | null {
    const [returned] = useState(() => stripeReturn(window.location.search));
    useEffect(() => {
        const clean = new URL(window.location.href);
        for (const param of STRIPE_RETURN_PARAMS) clean.searchParams.delete(param);
        if (clean.href !== window.location.href)
            window.history.replaceState(window.history.state, "", clean.toString());
    }, []);
    return returned;
}
