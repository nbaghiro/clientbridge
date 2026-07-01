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

/** Short relative time for activity feeds: "just now", "5m", "3h", "2d", else a short date. */
export function formatRelativeTime(
    value: string,
    now: Date = new Date(),
    locale = "en-CA",
): string {
    const then = parseTimestamp(value);
    const mins = Math.floor((now.getTime() - then.getTime()) / MS_PER_MIN);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    return then.toLocaleDateString(locale, { month: "short", day: "numeric" });
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

export function formatFullDate(d: Date, locale = "en-CA"): string {
    return d.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" });
}

export function formatMonthYear(d: Date, locale = "en-CA"): string {
    return d.toLocaleDateString(locale, { month: "long", year: "numeric" });
}

export function formatDate(d: Date, locale = "en-CA"): string {
    return d.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
}

function ymdToLocalDate(ymd: string): Date {
    const [y = 1970, mo = 1, d = 1] = ymd.split("-").map(Number);
    return new Date(y, mo - 1, d);
}

/** Combine a calendar day (a Date or a "YYYY-MM-DD" string) with a wall-clock "HH:MM" into a local
 *  Date — the single home for turning a picked day + time into a booking start (web string-parsed it
 *  while mobile built it numerically; sharing it keeps the two from drifting). */
export function combineDayAndTime(day: Date | string, hhmm: string): Date {
    const base = typeof day === "string" ? ymdToLocalDate(day) : day;
    const [h = 0, m = 0] = hhmm.split(":").map(Number);
    return new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m);
}
