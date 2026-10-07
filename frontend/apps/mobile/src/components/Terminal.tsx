import { useStripeTerminalLocation } from "@clientbridge/app-core";
import { StripeTerminalProvider, useStripeTerminal } from "@stripe/stripe-terminal-react-native";
import { type ReactElement, useCallback, useEffect, useState } from "react";

import { terminalSimulated } from "../lib/config";

// Needs a dev build and a Tap to Pay device or `terminalSimulated`; it does not run in Expo Go.

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

type TerminalPhase = "connecting" | "ready" | "collecting" | "done" | "error";

interface TerminalCheckout {
    phase: TerminalPhase;
    error: string | null;
    ready: boolean;
    charge: (clientSecret: string) => void;
}

/** Tap to Pay: connect a reader, then collect and confirm the order's PaymentIntent. */
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
    const locationId = useStripeTerminalLocation();

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
        if (connectedReader != null || reader === undefined || locationId === null) return;
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
