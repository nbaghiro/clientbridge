import { useStripeTerminalLocation } from "@clientbridge/app-core";
import { StripeTerminalProvider, useStripeTerminal } from "@stripe/stripe-terminal-react-native";
import { type ReactElement, useCallback, useEffect, useState } from "react";

import { stripeTerminalLocationId, terminalSimulated } from "../lib/config";

// NOTE: @stripe/stripe-terminal-react-native is a native module — it needs an EAS / Expo dev build
// AND a Tap-to-Pay-capable device (or a simulated reader) to run; it does NOT work in Expo Go, and
// tsc passes without either. The Terminal *location id* the reader connects under is minted by the
// backend on the first connection-token call (then synced); config is only a fallback. With
// `terminalSimulated` the SDK discovers a test reader instead of real hardware.

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
    // Prefer the backend-minted, synced location; fall back to config until it has synced.
    const locationId = useStripeTerminalLocation() ?? stripeTerminalLocationId;

    // Initialize + start discovering a Tap-to-Pay reader on mount.
    useEffect(() => {
        (async () => {
            await initialize();
            const res = await discoverReaders({
                discoveryMethod: "tapToPay",
                simulated: terminalSimulated,
            });
            if (res.error) {
                setError(res.error.message);
                setPhase("error");
            }
        })().catch(() => undefined);
    }, [initialize, discoverReaders]);

    // Connect the first discovered reader once we know which location to connect it under.
    useEffect(() => {
        const reader = discoveredReaders[0];
        if (connectedReader != null || reader === undefined || locationId === "") return;
        (async () => {
            const res = await connectReader({ discoveryMethod: "tapToPay", reader, locationId });
            if (res.error) {
                setError(res.error.message);
                setPhase("error");
            } else {
                setError(null);
                setPhase("ready");
            }
        })().catch(() => undefined);
    }, [discoveredReaders, connectedReader, connectReader, locationId]);

    const charge = useCallback(
        (clientSecret: string): void => {
            (async () => {
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
            })().catch(() => undefined);
        },
        [retrievePaymentIntent, collectPaymentMethod, confirmPaymentIntent],
    );

    return { phase, error, ready: connectedReader != null, charge };
}
