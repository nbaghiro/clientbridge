// Generic date utilities shared across the app (not calendar-specific).
import { strings } from "./strings";

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
    if (mins < 1) return strings.common.relativeTime.justNow;
    if (mins < 60) return strings.common.relativeTime.minutes(mins);
    const hours = Math.floor(mins / 60);
    if (hours < 24) return strings.common.relativeTime.hours(hours);
    const days = Math.floor(hours / 24);
    if (days < 7) return strings.common.relativeTime.days(days);
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

export function formatShortDay(d: Date, locale = "en-CA"): string {
    return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
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

export function combineDayAndTime(day: Date | string, hhmm: string): Date {
    const base = typeof day === "string" ? ymdToLocalDate(day) : day;
    const [h = 0, m = 0] = hhmm.split(":").map(Number);
    return new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m);
}

/** "Wed, Oct 8": a near date where the year goes without saying. */
export function weekdayDay(d: Date, locale = "en-CA"): string {
    return d.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
}

/** "Today", "Yesterday" or "Tomorrow", else the short ("Wed, Oct 8") or long date. */
export function relativeDay(
    d: Date,
    style: "short" | "long" = "short",
    now: Date = new Date(),
): string {
    if (sameDay(d, now)) return strings.common.today;
    if (sameDay(d, addDays(now, -1))) return strings.common.yesterday;
    if (sameDay(d, addDays(now, 1))) return strings.common.tomorrow;
    return style === "long" ? formatFullDate(d) : weekdayDay(d);
}

/** "Today, 2:30 p.m." or "Wed, Oct 8, 9:00 a.m." */
export function relativeDayTime(d: Date, now: Date = new Date()): string {
    return `${relativeDay(d, "short", now)}, ${formatTime(d)}`;
}

/** A feed timestamp: the time today, the weekday and time this week, else the date. */
export function stampLabel(d: Date, now: Date = new Date()): string {
    const days = Math.round((startOfDay(now).getTime() - startOfDay(d).getTime()) / 86_400_000);
    if (days === 0) return formatTime(d);
    if (days > 0 && days < 7) return `${formatWeekday(d)} ${formatTime(d)}`;
    return formatDate(d);
}

/** Whole calendar days from `now` to `d`; negative when `d` is in the past. */
export function daysUntil(d: Date, now: Date = new Date()): number {
    return Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 86_400_000);
}
