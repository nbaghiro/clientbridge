// Generic date utilities shared across the app (not calendar-specific).
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
