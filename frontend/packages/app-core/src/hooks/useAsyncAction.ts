import { useState } from "react";

export interface AsyncAction {
    busy: boolean;
    error: string | null;
    setError: (message: string | null) => void;
    run: (
        fn: () => Promise<unknown>,
        opts?: { onSuccess?: () => void; errorMessage?: string },
    ) => Promise<void>;
}

/** Shared busy/error wrapper for a one-shot mutation: sets busy, clears error, runs, reports failure. */
export function useAsyncAction(): AsyncAction {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const run = async (
        fn: () => Promise<unknown>,
        opts?: { onSuccess?: () => void; errorMessage?: string },
    ): Promise<void> => {
        setBusy(true);
        setError(null);
        try {
            await fn();
            opts?.onSuccess?.();
        } catch {
            setError(opts?.errorMessage ?? "Something went wrong. Please try again.");
        } finally {
            setBusy(false);
        }
    };

    return { busy, error, setError, run };
}
