import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
    type CalendarDay,
    addDays,
    addMonths,
    dateKey,
    formatMonthYear,
    monthWeeks,
    parseDateKey,
    startOfWeek,
    weekdayNames,
} from "./datetime";
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

type LoadState = "loading" | "ready" | "empty" | "error";

export interface Load {
    state: LoadState;
    ready: boolean;
    // Ready or empty: the screen draws its content (with empty lists) rather than a placeholder.
    hasData: boolean;
    retrying: boolean;
    retry: () => void;
}

// The shape of a PowerSync `useQuery` result and of `useRemote`, so either can feed `useLoad`.
export interface LoadSource {
    isLoading: boolean;
    error?: Error | null | undefined;
    refresh?: (() => Promise<void> | void) | undefined;
}

/** One load state for a screen: loading until every source answers, error if any failed. */
export function useLoad(sources: LoadSource[], empty: boolean): Load {
    const [retrying, setRetrying] = useState(false);
    const latest = useRef(sources);
    latest.current = sources;
    const failed = sources.some((s) => s.error !== undefined && s.error !== null);
    const loading = sources.some((s) => s.isLoading);
    const state: LoadState = failed ? "error" : loading ? "loading" : empty ? "empty" : "ready";
    const retry = useCallback(() => {
        setRetrying(true);
        Promise.all(latest.current.map(async (s) => s.refresh?.()))
            .catch(() => undefined)
            .finally(() => {
                setRetrying(false);
            });
    }, []);
    return {
        state,
        ready: state === "ready",
        hasData: state === "ready" || state === "empty",
        retrying,
        retry,
    };
}

export interface Remote<T> extends LoadSource {
    data: T | null;
    error: Error | null;
    refresh: () => Promise<void>;
}

/** A server-only figure: fetched on mount and whenever `key` changes, with a refresh for retry. */
export function useRemote<T>(load: () => Promise<T>, key = ""): Remote<T> {
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState<Error | null>(null);
    const [isLoading, setLoading] = useState(true);
    const current = useRef(load);
    current.current = load;
    const refresh = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError(null);
        try {
            setData(await current.current());
        } catch (e) {
            setError(e instanceof Error ? e : new Error(String(e)));
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => {
        refresh().catch(() => undefined);
    }, [refresh, key]);
    return { data, error, isLoading, refresh };
}

type DayMove = "day" | "week" | "month" | "year" | "weekEdge";

interface MonthGrid {
    title: string;
    weekdays: readonly string[];
    weeks: CalendarDay[][];
    // The day keyboard focus sits on; it also picks the month shown.
    active: string;
    setActive: (key: string) => void;
    move: (by: DayMove, dir: 1 | -1) => void;
    canPrev: boolean;
    canNext: boolean;
    view: "days" | "years";
    setView: (view: "days" | "years") => void;
    years: readonly { year: number; selected: boolean }[];
    pickYear: (year: number) => void;
    // Back to the chosen day (or today) and the day view, for each time the picker opens.
    reset: () => void;
}

// The month grid behind a date picker: which month shows, the focused day, and keyboard moves.
export function useMonthGrid(value: string, min?: string, max?: string): MonthGrid {
    const start = useCallback((): string => {
        const today = dateKey(new Date());
        const from = parseDateKey(value) !== null ? value : today;
        if (min !== undefined && min !== "" && from < min) return min;
        if (max !== undefined && max !== "" && from > max) return max;
        return from;
    }, [value, min, max]);
    const [active, setActiveKey] = useState(start);
    const [view, setView] = useState<"days" | "years">("days");
    const bounds = useMemo(() => ({ min, max }), [min, max]);
    const day = parseDateKey(active) ?? new Date();
    const setActive = useCallback(
        (key: string): void => {
            const d = parseDateKey(key);
            if (d === null) return;
            const minD = parseDateKey(min ?? "");
            const maxD = parseDateKey(max ?? "");
            if (minD !== null && d < minD) setActiveKey(dateKey(minD));
            else if (maxD !== null && d > maxD) setActiveKey(dateKey(maxD));
            else setActiveKey(key);
        },
        [min, max],
    );
    const move = (by: DayMove, dir: 1 | -1): void => {
        const next =
            by === "day"
                ? addDays(day, dir)
                : by === "week"
                  ? addDays(day, dir * 7)
                  : by === "month"
                    ? addMonths(day, dir)
                    : by === "year"
                      ? addMonths(day, dir * 12)
                      : addDays(startOfWeek(day), dir === 1 ? 6 : 0);
        setActive(dateKey(next));
    };
    const thisYear = new Date().getFullYear();
    const firstYear = parseDateKey(min ?? "")?.getFullYear() ?? thisYear - 100;
    const lastYear = parseDateKey(max ?? "")?.getFullYear() ?? thisYear + 10;
    const first = dateKey(new Date(day.getFullYear(), day.getMonth(), 1));
    const last = dateKey(new Date(day.getFullYear(), day.getMonth() + 1, 0));
    return {
        title: formatMonthYear(day),
        weekdays: useMemo(() => weekdayNames(), []),
        weeks: monthWeeks(day, value, bounds),
        active,
        setActive,
        move,
        canPrev: min === undefined || min === "" || min < first,
        canNext: max === undefined || max === "" || max > last,
        view,
        setView,
        years: Array.from({ length: lastYear - firstYear + 1 }, (_, i) => ({
            year: firstYear + i,
            selected: firstYear + i === day.getFullYear(),
        })),
        pickYear: (year) => {
            setActive(dateKey(addMonths(day, (year - day.getFullYear()) * 12)));
            setView("days");
        },
        reset: () => {
            setActiveKey(start());
            setView("days");
        },
    };
}
