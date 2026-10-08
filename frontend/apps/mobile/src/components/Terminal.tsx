import { strings, useStripeTerminalLocation } from "@clientbridge/app-core";
import { StripeTerminalProvider, useStripeTerminal } from "@stripe/stripe-terminal-react-native";
import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";

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
    retry: (() => void) | null;
}

/** Tap to Pay: connect a reader, then collect and confirm the order's PaymentIntent. */
export function useTerminalCheckout(): TerminalCheckout {
    const {
        initialize,
        cancelDiscovering,
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

    const [attempt, setAttempt] = useState(0);
    const [canRetry, setCanRetry] = useState(true);
    const active = useRef(true);
    const connecting = useRef(false);
    const charging = useRef(false);
    const readerRef = useRef(connectedReader);
    readerRef.current = connectedReader;
    const t = strings.terminal;
    useEffect(() => {
        active.current = true;
        return () => {
            active.current = false;
        };
    }, []);

    useEffect(() => {
        let current = true;
        const isCurrent = (): boolean => current;
        setPhase("connecting");
        setError(null);
        setCanRetry(true);
        (async () => {
            const initialized = await initialize();
            if (!isCurrent()) return;
            if (initialized.error) {
                setError(t.unavailable);
                setPhase("error");
                return;
            }
            if (readerRef.current != null) {
                setPhase("ready");
                return;
            }
            const result = await discoverReaders({
                discoveryMethod: "tapToPay",
                simulated: terminalSimulated,
            });
            if (isCurrent() && result.error) {
                setError(t.discoveryError);
                setPhase("error");
            }
        })().catch(() => {
            if (isCurrent()) {
                setError(t.unavailable);
                setPhase("error");
            }
        });
        return () => {
            current = false;
            cancelDiscovering().catch(() => undefined);
        };
    }, [initialize, discoverReaders, cancelDiscovering, attempt, t]);

    useEffect(() => {
        const reader = discoveredReaders[0];
        if (
            connectedReader != null ||
            reader === undefined ||
            locationId === null ||
            connecting.current
        )
            return;
        connecting.current = true;
        (async () => {
            const result = await connectReader({ discoveryMethod: "tapToPay", reader, locationId });
            if (!active.current) return;
            if (result.error) {
                setError(t.connectionError);
                setPhase("error");
            } else {
                setError(null);
                setPhase("ready");
            }
        })()
            .catch(() => {
                if (active.current) {
                    setError(t.connectionError);
                    setPhase("error");
                }
            })
            .finally(() => {
                connecting.current = false;
            });
    }, [discoveredReaders, connectedReader, connectReader, locationId, t, attempt]);

    useEffect(() => {
        if (phase !== "connecting" || discoveredReaders.length === 0 || locationId !== null) return;
        const timer = setTimeout(() => {
            setError(t.locationMissing);
            setPhase("error");
        }, 30_000);
        return () => {
            clearTimeout(timer);
        };
    }, [phase, discoveredReaders.length, locationId, t]);

    const charge = useCallback(
        (clientSecret: string): void => {
            if (charging.current || !active.current) return;
            charging.current = true;
            const isActive = (): boolean => active.current;
            setCanRetry(false);
            (async () => {
                setPhase("collecting");
                setError(null);
                const retrieved = await retrievePaymentIntent(clientSecret);
                if (!isActive()) return;
                if (retrieved.error) {
                    setError(t.paymentError);
                    setPhase("error");
                    return;
                }
                const collected = await collectPaymentMethod({
                    paymentIntent: retrieved.paymentIntent,
                });
                if (!isActive()) return;
                if (collected.error) {
                    setError(t.paymentError);
                    setPhase("error");
                    return;
                }
                const confirmed = await confirmPaymentIntent({
                    paymentIntent: collected.paymentIntent,
                });
                if (!isActive()) return;
                if (confirmed.error) {
                    setError(t.paymentError);
                    setPhase("error");
                    return;
                }
                setPhase("done");
            })()
                .catch(() => {
                    if (active.current) {
                        setError(t.paymentError);
                        setPhase("error");
                    }
                })
                .finally(() => {
                    charging.current = false;
                });
        },
        [retrievePaymentIntent, collectPaymentMethod, confirmPaymentIntent, t],
    );

    return {
        phase,
        error,
        ready: connectedReader != null && phase === "ready",
        charge,
        retry: canRetry
            ? () => {
                  setAttempt((value) => value + 1);
              }
            : null,
    };
}
