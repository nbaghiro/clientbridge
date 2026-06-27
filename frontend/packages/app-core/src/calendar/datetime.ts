const MS_PER_MIN = 60_000;

/** PowerSync stores Postgres timestamptz as text ("2026-06-26 10:00:00+00"); parse it as UTC-safe. */
export function parseTimestamp(value: string): Date {
    let iso = value.includes("T") ? value : value.replace(" ", "T");
    iso = iso.replace(/([+-]\d{2})$/, "$1:00"); // bare "+00" → "+00:00"
    if (!/([zZ]|[+-]\d{2}:\d{2})$/.test(iso)) iso += "Z"; // no offset → it's UTC
    return new Date(iso);
}

export function startOfDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function addMinutes(d: Date, n: number): Date {
    return new Date(d.getTime() + n * MS_PER_MIN);
}

export function startOfWeek(d: Date, weekStartsOn = 1): Date {
    const diff = (d.getDay() - weekStartsOn + 7) % 7;
    return addDays(startOfDay(d), -diff);
}

export function startOfMonth(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function sameDay(a: Date, b: Date): boolean {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
}

export function isSameMonth(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function minutesSinceMidnight(d: Date): number {
    return d.getHours() * 60 + d.getMinutes();
}

export function dateKey(d: Date): string {
    const m = `${d.getMonth() + 1}`.padStart(2, "0");
    const day = `${d.getDate()}`.padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
}

export function dayColumns(anchor: Date, count: number): Date[] {
    const start = startOfDay(anchor);
    return Array.from({ length: count }, (_, i) => addDays(start, i));
}

export function weekColumns(anchor: Date, weekStartsOn = 1): Date[] {
    return dayColumns(startOfWeek(anchor, weekStartsOn), 7);
}

export function monthMatrix(anchor: Date, weekStartsOn = 1): Date[][] {
    const first = startOfWeek(startOfMonth(anchor), weekStartsOn);
    return Array.from({ length: 6 }, (_, w) =>
        Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d)),
    );
}

export function formatTime(d: Date, locale = "en-CA"): string {
    return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

export function formatHour(hour: number, locale = "en-CA"): string {
    return new Date(2000, 0, 1, hour).toLocaleTimeString(locale, { hour: "numeric" });
}

export function formatWeekday(d: Date, locale = "en-CA"): string {
    return d.toLocaleDateString(locale, { weekday: "short" });
}

export function formatMonthDay(d: Date, locale = "en-CA"): string {
    return d.toLocaleDateString(locale, { month: "long", day: "numeric" });
}

export function formatRangeLabel(cols: Date[], locale = "en-CA"): string {
    const first = cols.at(0);
    const last = cols.at(-1);
    if (!first || !last) return "";
    if (cols.length === 1) {
        return first.toLocaleDateString(locale, { month: "long", day: "numeric", year: "numeric" });
    }
    const a = first.toLocaleDateString(locale, { month: "short", day: "numeric" });
    const b = last.toLocaleDateString(
        locale,
        isSameMonth(first, last)
            ? { day: "numeric", year: "numeric" }
            : { month: "short", day: "numeric", year: "numeric" },
    );
    return `${a} – ${b}`;
}
