import { usePowerSync, useQuery } from "@powersync/react";
import { useEffect, useState } from "react";

import { useAsyncAction } from "../hooks";
import { useBusinessId } from "./business";
import { strings } from "../strings";
import { newRowId } from "../api";

/** Weekday order for the editor, 0 = Monday … 6 = Sunday — matching the server's `date.weekday()`. */
export const WEEKDAYS: { weekday: number; label: string }[] = [
    { weekday: 0, label: strings.hours.monday },
    { weekday: 1, label: strings.hours.tuesday },
    { weekday: 2, label: strings.hours.wednesday },
    { weekday: 3, label: strings.hours.thursday },
    { weekday: 4, label: strings.hours.friday },
    { weekday: 5, label: strings.hours.saturday },
    { weekday: 6, label: strings.hours.sunday },
];

const DEFAULT_START = "09:00";
const DEFAULT_END = "17:00";
const HHMM = /^\d{2}:\d{2}$/;

interface DayHours {
    weekday: number;
    open: boolean;
    start: string; // "HH:MM"
    end: string; // "HH:MM"
}

interface RecurringRow {
    weekday: number | null;
    start_time: string | null;
    end_time: string | null;
    available: number;
}

interface HoursEditor {
    days: DayHours[] | null; // null until the staff's rows have loaded
    setOpen: (weekday: number, open: boolean) => void;
    setTime: (weekday: number, which: "start" | "end", value: string) => void;
    busy: boolean;
    error: string | null;
    saved: boolean;
    submit: () => void;
}

export const RECURRING_HOURS_SQL =
    "SELECT weekday, start_time, end_time, available FROM hours WHERE staff_id = ? AND basis = 'recurring'";

export const CLEAR_RECURRING_HOURS_SQL =
    "DELETE FROM hours WHERE staff_id = ? AND basis = 'recurring'";

export const INSERT_RECURRING_HOURS_SQL =
    "INSERT INTO hours (id, business_id, staff_id, basis, weekday, start_time, end_time, available, note) VALUES (?, ?, ?, 'recurring', ?, ?, ?, ?, NULL)";

/** Days with no rows default to weekdays 9 to 5 and weekends closed. */
function seedDays(rows: RecurringRow[]): DayHours[] {
    const byWeekday = new Map<number, RecurringRow>();
    for (const r of rows) if (r.weekday !== null) byWeekday.set(r.weekday, r);
    return WEEKDAYS.map(({ weekday }) => {
        const row = byWeekday.get(weekday);
        if (row === undefined) {
            return { weekday, open: weekday < 5, start: DEFAULT_START, end: DEFAULT_END };
        }
        return {
            weekday,
            open: row.available === 1,
            start: (row.start_time ?? DEFAULT_START).slice(0, 5),
            end: (row.end_time ?? DEFAULT_END).slice(0, 5),
        };
    });
}

/** Render with `key={staffId}` so switching staff reseeds the grid. */
export function useHoursEditor(staffId: string | null): HoursEditor {
    const db = usePowerSync();
    const businessId = useBusinessId();
    const { data, isLoading } = useQuery<RecurringRow>(RECURRING_HOURS_SQL, [staffId ?? ""]);
    const { busy, error, setError, run } = useAsyncAction();
    const [days, setDays] = useState<DayHours[] | null>(null);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        if (days === null && !isLoading && staffId !== null) {
            setDays(seedDays(data));
        }
    }, [days, isLoading, data, staffId]);

    const edit = (weekday: number, patch: Partial<DayHours>): void => {
        setSaved(false);
        setDays((d) => d?.map((x) => (x.weekday === weekday ? { ...x, ...patch } : x)) ?? d);
    };
    const setOpen = (weekday: number, open: boolean): void => {
        edit(weekday, { open });
    };
    const setTime = (weekday: number, which: "start" | "end", value: string): void => {
        edit(weekday, { [which]: value });
    };

    const submit = (): void => {
        if (days === null || staffId === null) return;
        if (businessId === null) {
            setError(strings.common.stillSyncing);
            return;
        }
        for (const d of days) {
            if (!d.open) continue;
            if (!HHMM.test(d.start) || !HHMM.test(d.end)) {
                setError(strings.hours.timeFormatError);
                return;
            }
            if (d.start >= d.end) {
                setError(strings.hours.timeOrderError);
                return;
            }
        }
        run(
            async () => {
                await db.writeTransaction(async (tx) => {
                    await tx.execute(CLEAR_RECURRING_HOURS_SQL, [staffId]);
                    for (const d of days) {
                        await tx.execute(INSERT_RECURRING_HOURS_SQL, [
                            newRowId("av"),
                            businessId,
                            staffId,
                            d.weekday,
                            d.open ? `${d.start}:00` : null,
                            d.open ? `${d.end}:00` : null,
                            d.open ? 1 : 0,
                        ]);
                    }
                });
            },
            {
                onSuccess: () => {
                    setSaved(true);
                },
                errorMessage: strings.hours.saveError,
            },
        );
    };

    return { days, setOpen, setTime, busy, error, saved, submit };
}
