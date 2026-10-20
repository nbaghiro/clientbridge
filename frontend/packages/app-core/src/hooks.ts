import { businessQuery } from "@clientbridge/sync";
import { type AdditionalOptions, useQuery } from "@powersync/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
    type CalendarDay,
    addDays,
    addMonths,
    dateKey,
    formatMonthYear,
    monthWeeks,
    parseDateKey,
    startOfMonth,
    startOfWeek,
    wallTime,
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
        opts?: { onSuccess?: () => void; errorMessage?: string | ((error: unknown) => string) },
    ) => void;
}

export function useAsyncAction(): AsyncAction {
    const [busy, setBusy] = useState(false);
    const running = useRef(false);
    const [error, setError] = useState<string | null>(null);

    const run = (
        fn: () => Promise<unknown>,
        opts?: { onSuccess?: () => void; errorMessage?: string | ((error: unknown) => string) },
    ): void => {
        if (running.current) return;
        running.current = true;
        const go = async (): Promise<void> => {
            setBusy(true);
            setError(null);
            try {
                await fn();
                opts?.onSuccess?.();
            } catch (failure) {
                const message = opts?.errorMessage;
                setError(
                    typeof message === "function"
                        ? message(failure)
                        : (message ?? strings.common.somethingWrongRetry),
                );
            } finally {
                running.current = false;
                setBusy(false);
            }
        };
        go().catch(() => undefined);
    };

    return { busy, error, setError, run };
}

// fetch rejects with a TypeError when the request never reached a server
export function isConnectionFailure(error: unknown): boolean {
    return error instanceof TypeError;
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
    const generation = useRef(0);
    current.current = load;
    const refresh = useCallback(async (): Promise<void> => {
        const request = ++generation.current;
        setLoading(true);
        setError(null);
        try {
            const next = await current.current();
            if (request === generation.current) setData(next);
        } catch (e) {
            if (request === generation.current)
                setError(e instanceof Error ? e : new Error(String(e)));
        } finally {
            if (request === generation.current) setLoading(false);
        }
    }, []);
    useEffect(() => {
        setData(null);
        refresh().catch(() => undefined);
        return () => {
            generation.current += 1;
        };
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
export function useMonthGrid(value: string, zone: string, min?: string, max?: string): MonthGrid {
    const start = useCallback((): string => {
        const today = dateKey(new Date(), zone);
        const from = parseDateKey(value, zone) !== null ? value : today;
        if (min !== undefined && min !== "" && from < min) return min;
        if (max !== undefined && max !== "" && from > max) return max;
        return from;
    }, [value, zone, min, max]);
    const [active, setActiveKey] = useState(start);
    const [view, setView] = useState<"days" | "years">("days");
    const bounds = useMemo(() => ({ min, max }), [min, max]);
    const day = parseDateKey(active, zone) ?? new Date();
    const setActive = useCallback(
        (key: string): void => {
            if (parseDateKey(key, zone) === null) return;
            if (min !== undefined && parseDateKey(min, zone) !== null && key < min)
                setActiveKey(min);
            else if (max !== undefined && parseDateKey(max, zone) !== null && key > max)
                setActiveKey(max);
            else setActiveKey(key);
        },
        [zone, min, max],
    );
    const move = (by: DayMove, dir: 1 | -1): void => {
        const next =
            by === "day"
                ? addDays(day, dir, zone)
                : by === "week"
                  ? addDays(day, dir * 7, zone)
                  : by === "month"
                    ? addMonths(day, dir, zone)
                    : by === "year"
                      ? addMonths(day, dir * 12, zone)
                      : addDays(startOfWeek(day, zone), dir === 1 ? 6 : 0, zone);
        setActive(dateKey(next, zone));
    };
    const yearOf = (d: Date): number => wallTime(d, zone).year;
    const thisYear = yearOf(new Date());
    const minDay = parseDateKey(min ?? "", zone);
    const maxDay = parseDateKey(max ?? "", zone);
    const firstYear = minDay === null ? thisYear - 100 : yearOf(minDay);
    const lastYear = maxDay === null ? thisYear + 10 : yearOf(maxDay);
    const monthStart = startOfMonth(day, zone);
    const first = dateKey(monthStart, zone);
    const last = dateKey(addDays(addMonths(monthStart, 1, zone), -1, zone), zone);
    const shownYear = yearOf(day);
    return {
        title: formatMonthYear(day, zone),
        weekdays: useMemo(() => weekdayNames(), []),
        weeks: monthWeeks(day, value, bounds, zone),
        active,
        setActive,
        move,
        canPrev: min === undefined || min === "" || min < first,
        canNext: max === undefined || max === "" || max > last,
        view,
        setView,
        years: Array.from({ length: lastYear - firstYear + 1 }, (_, i) => ({
            year: firstYear + i,
            selected: firstYear + i === shownYear,
        })),
        pickYear: (year) => {
            setActive(dateKey(addMonths(day, (year - shownYear) * 12, zone), zone));
            setView("days");
        },
        reset: () => {
            setActiveKey(start());
            setView("days");
        },
    };
}

export function useBusinessQuery<Row = Record<string, unknown>>(
    sql: string,
    parameters: unknown[] = [],
    options?: AdditionalOptions,
) {
    return useQuery<Row>(businessQuery(sql), parameters, options);
}

export function useNow(ms = 60_000): Date {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const timer = setInterval(() => {
            setNow(new Date());
        }, ms);
        return () => {
            clearInterval(timer);
        };
    }, [ms]);
    return now;
}
