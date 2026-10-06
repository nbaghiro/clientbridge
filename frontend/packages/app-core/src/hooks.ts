import { useMemo, useState } from "react";

import { strings } from "./strings";

interface AsyncAction {
    busy: boolean;
    error: string | null;
    setError: (message: string | null) => void;
    // Fire-and-forget: failures are captured into `error`, so callers never await or handle it.
    run: (
        fn: () => Promise<unknown>,
        opts?: { onSuccess?: () => void; errorMessage?: string },
    ) => void;
}

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

/** Shared list-search state: a query string + the memoized filtered rows. `filter` must be stable. */
export function useSearch<T>(
    rows: T[],
    filter: (rows: T[], q: string) => T[],
): { q: string; setQ: (q: string) => void; filtered: T[] } {
    const [q, setQ] = useState("");
    const filtered = useMemo(() => filter(rows, q), [rows, filter, q]);
    return { q, setQ, filtered };
}
