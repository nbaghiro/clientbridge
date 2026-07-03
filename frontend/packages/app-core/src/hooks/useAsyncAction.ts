import { useState } from "react";

import { strings } from "../strings";

export interface AsyncAction {
    busy: boolean;
    error: string | null;
    setError: (message: string | null) => void;
    // Fire-and-forget: failures are captured into `error`, so callers never await or handle it.
    run: (
        fn: () => Promise<unknown>,
        opts?: { onSuccess?: () => void; errorMessage?: string },
    ) => void;
}

/** Shared busy/error wrapper for a one-shot mutation: sets busy, clears error, runs, reports failure. */
export function useAsyncAction(): AsyncAction {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const run = (
        fn: () => Promise<unknown>,
        opts?: { onSuccess?: () => void; errorMessage?: string },
    ): void => {
        const go = async (): Promise<void> => {
            setBusy(true);
            setError(null);
            try {
                await fn();
                opts?.onSuccess?.();
            } catch {
                setError(opts?.errorMessage ?? strings.common.somethingWrongRetry);
            } finally {
                setBusy(false);
            }
        };
        go().catch(() => undefined);
    };

    return { busy, error, setError, run };
}
