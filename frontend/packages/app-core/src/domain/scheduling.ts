import { usePowerSync, useQuery } from "@powersync/react";
import { useEffect, useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import { useBusinessId } from "../hooks/primitives";
import { strings } from "../strings";
import { newRowId } from "../util/primitives";

/** Weekday order for the editor, 0 = Monday … 6 = Sunday — matching the server's `date.weekday()`. */
export const WEEKDAYS: { weekday: number; label: string }[] = [
    { weekday: 0, label: strings.scheduling.monday },
    { weekday: 1, label: strings.scheduling.tuesday },
    { weekday: 2, label: strings.scheduling.wednesday },
    { weekday: 3, label: strings.scheduling.thursday },
    { weekday: 4, label: strings.scheduling.friday },
    { weekday: 5, label: strings.scheduling.saturday },
    { weekday: 6, label: strings.scheduling.sunday },
];

const DEFAULT_START = "09:00";
const DEFAULT_END = "17:00";
const HHMM = /^\d{2}:\d{2}$/;

export interface DayHours {
    weekday: number;
    open: boolean;
    start: string; // "HH:MM"
    end: string; // "HH:MM"
}

interface RecurringRow {
    weekday: number | null;
    start_time: string | null;
    end_time: string | null;
    is_available: number;
}

export interface AvailabilityEditor {
    days: DayHours[] | null; // null until the staff's rows have loaded
    setOpen: (weekday: number, open: boolean) => void;
    setTime: (weekday: number, which: "start" | "end", value: string) => void;
    busy: boolean;
    error: string | null;
    saved: boolean;
    submit: () => void;
}

const SQL =
    "SELECT weekday, start_time, end_time, is_available FROM availability WHERE staff_id = ? AND type = 'recurring'";

/** Seed a full 7-day grid from the staff's recurring rows; unconfigured days fall back to
 *  business-hours defaults (weekdays open 9–5, weekends closed). */
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
            open: row.is_available === 1,
            start: (row.start_time ?? DEFAULT_START).slice(0, 5),
            end: (row.end_time ?? DEFAULT_END).slice(0, 5),
        };
    });
}

/** Weekly-availability editor for one staff member (recurring windows, sync-write). Seeds a 7-day
 *  grid from the synced rows, then replaces that staff's recurring rows on save. Render the consumer
 *  with `key={staffId}` so switching staff remounts and reseeds cleanly. */
export function useAvailabilityEditor(staffId: string | null): AvailabilityEditor {
    const db = usePowerSync();
    const businessId = useBusinessId();
    const { data, isLoading } = useQuery<RecurringRow>(SQL, [staffId ?? ""]);
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
                setError(strings.scheduling.timeFormatError);
                return;
            }
            if (d.start >= d.end) {
                setError(strings.scheduling.timeOrderError);
                return;
            }
        }
        run(
            async () => {
                await db.writeTransaction(async (tx) => {
                    await tx.execute(
                        "DELETE FROM availability WHERE staff_id = ? AND type = 'recurring'",
                        [staffId],
                    );
                    for (const d of days) {
                        await tx.execute(
                            "INSERT INTO availability (id, business_id, staff_id, type, weekday, start_time, end_time, is_available, note) VALUES (?, ?, ?, 'recurring', ?, ?, ?, ?, NULL)",
                            [
                                newRowId("av"),
                                businessId,
                                staffId,
                                d.weekday,
                                d.open ? `${d.start}:00` : null,
                                d.open ? `${d.end}:00` : null,
                                d.open ? 1 : 0,
                            ],
                        );
                    }
                });
            },
            {
                onSuccess: () => {
                    setSaved(true);
                },
                errorMessage: strings.scheduling.saveError,
            },
        );
    };

    return { days, setOpen, setTime, busy, error, saved, submit };
}
