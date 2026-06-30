import { StripeTerminalProvider, useStripeTerminal } from "@stripe/stripe-terminal-react-native";
import { type ReactElement, useCallback, useEffect, useState } from "react";

import { stripeTerminalLocationId, terminalSimulated } from "../lib/config";

// NOTE: @stripe/stripe-terminal-react-native is a native module — it needs an EAS / Expo dev build
// AND a Tap-to-Pay-capable device (or a simulated reader) to run; it does NOT work in Expo Go, and
// tsc passes without either. Connecting a Tap-to-Pay reader also needs a Stripe Terminal *location
// id* (the backend doesn't mint one yet — it's read from config; with `terminalSimulated` the SDK
// discovers a test reader instead).

/** Wraps a subtree in the Terminal SDK, feeding it our backend connection-token endpoint as the
 *  token provider (the same `useConnectionToken(api)` seam the POS already exposes). */
export function TerminalProvider({
    tokenProvider,
    children,
}: {
    tokenProvider: () => Promise<string>;
    children: ReactElement;
}) {
    return (
        <StripeTerminalProvider tokenProvider={tokenProvider}>{children}</StripeTerminalProvider>
    );
}

export type TerminalPhase = "connecting" | "ready" | "collecting" | "done" | "error";

export interface TerminalCheckout {
    phase: TerminalPhase;
    error: string | null;
    ready: boolean;
    charge: (clientSecret: string) => void;
}

/** Card-present checkout over Tap to Pay: initialize → discover → connect a reader, then
 *  retrieve → collect → confirm the order's PaymentIntent. The caller watches `phase` for "done". */
export function useTerminalCheckout(): TerminalCheckout {
    const {
        initialize,
        discoverReaders,
        connectReader,
        retrievePaymentIntent,
        collectPaymentMethod,
        confirmPaymentIntent,
        discoveredReaders,
        connectedReader,
    } = useStripeTerminal();

    const [phase, setPhase] = useState<TerminalPhase>("connecting");
    const [error, setError] = useState<string | null>(null);

    // Initialize + start discovering a Tap-to-Pay reader on mount.
    useEffect(() => {
        void (async () => {
            await initialize();
            const res = await discoverReaders({
                discoveryMethod: "tapToPay",
                simulated: terminalSimulated,
            });
            if (res.error) {
                setError(res.error.message);
                setPhase("error");
            }
        })();
    }, [initialize, discoverReaders]);

    // Connect the first discovered reader.
    useEffect(() => {
        const reader = discoveredReaders[0];
        if (connectedReader != null || reader === undefined) return;
        void (async () => {
            const res = await connectReader({
                discoveryMethod: "tapToPay",
                reader,
                locationId: stripeTerminalLocationId,
            });
            if (res.error) {
                setError(res.error.message);
                setPhase("error");
            } else {
                setError(null);
                setPhase("ready");
            }
        })();
    }, [discoveredReaders, connectedReader, connectReader]);

    const charge = useCallback(
        (clientSecret: string): void => {
            void (async () => {
                setPhase("collecting");
                setError(null);
                const retrieved = await retrievePaymentIntent(clientSecret);
                if (retrieved.error) {
                    setError(retrieved.error.message);
                    setPhase("error");
                    return;
                }
                const collected = await collectPaymentMethod({
                    paymentIntent: retrieved.paymentIntent,
                });
                if (collected.error) {
                    setError(collected.error.message);
                    setPhase("error");
                    return;
                }
                const confirmed = await confirmPaymentIntent({
                    paymentIntent: collected.paymentIntent,
                });
                if (confirmed.error) {
                    setError(confirmed.error.message);
                    setPhase("error");
                    return;
                }
                setPhase("done");
            })();
        },
        [retrievePaymentIntent, collectPaymentMethod, confirmPaymentIntent],
    );

    return { phase, error, ready: connectedReader != null, charge };
}
