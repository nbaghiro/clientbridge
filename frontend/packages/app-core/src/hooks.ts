import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

// A value a component owns until its parent passes `value`, like a native input.
export function useControllable<T>(
    value: T | undefined,
    defaultValue: T,
    onChange?: (next: T) => void,
): [T, (next: T) => void] {
    const [own, setOwn] = useState(defaultValue);
    const controlled = value !== undefined;
    const set = useCallback(
        (next: T) => {
            if (!controlled) setOwn(next);
            onChange?.(next);
        },
        [controlled, onChange],
    );
    return [controlled ? value : own, set];
}

// True for a moment after `flash()`, e.g. a "Copied" confirmation.
export function useFlash(ms = 2000): [boolean, () => void] {
    const [on, setOn] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(
        () => () => {
            if (timer.current !== null) clearTimeout(timer.current);
        },
        [],
    );
    const flash = useCallback(() => {
        if (timer.current !== null) clearTimeout(timer.current);
        setOn(true);
        timer.current = setTimeout(() => {
            setOn(false);
        }, ms);
    }, [ms]);
    return [on, flash];
}
