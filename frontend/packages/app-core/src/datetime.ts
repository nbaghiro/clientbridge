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

/** A "YYYY-MM-DD" key as a local date, or null when it isn't a real day. */
export function parseDateKey(key: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (m === null) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return dateKey(d) === key ? d : null;
}

/** The same day of the month `n` months on, held to the last day of a shorter month. */
export function addMonths(d: Date, n: number): Date {
    const last = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate();
    return new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), last));
}

/** "Wed, Oct 8" this year, "Wed, Oct 8, 2027" in any other. */
export function formatPickedDay(d: Date, now: Date = new Date(), locale = "en-CA"): string {
    if (d.getFullYear() === now.getFullYear()) return weekdayDay(d, locale);
    return d.toLocaleDateString(locale, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

export interface CalendarDay {
    key: string;
    day: number;
    inMonth: boolean;
    today: boolean;
    selected: boolean;
    disabled: boolean;
    // The full date for screen readers.
    label: string;
}

interface DayBounds {
    min?: string | undefined;
    max?: string | undefined;
}

function outOfBounds(key: string, { min, max }: DayBounds): boolean {
    return (
        (min !== undefined && min !== "" && key < min) ||
        (max !== undefined && max !== "" && key > max)
    );
}

/** Six Monday-first weeks covering the month of `month`, so the grid never changes height. */
export function monthWeeks(
    month: Date,
    selected: string,
    bounds: DayBounds,
    now: Date = new Date(),
): CalendarDay[][] {
    const first = startOfWeek(startOfMonth(month));
    const today = dateKey(now);
    return Array.from({ length: 6 }, (_, w) =>
        Array.from({ length: 7 }, (_, i) => {
            const d = addDays(first, w * 7 + i);
            const key = dateKey(d);
            return {
                key,
                day: d.getDate(),
                inMonth: d.getMonth() === month.getMonth(),
                today: key === today,
                selected: key === selected,
                disabled: outOfBounds(key, bounds),
                label: formatFullDate(d),
            };
        }),
    );
}

/** Short weekday names, Monday first. */
export function weekdayNames(locale = "en-CA"): string[] {
    const monday = startOfWeek(new Date());
    return Array.from({ length: 7 }, (_, i) => formatWeekday(addDays(monday, i), locale));
}

/** "9:30 a.m." for a 24-hour "09:30". */
function formatClock(hhmm: string, locale = "en-CA"): string {
    return formatTime(combineDayAndTime(new Date(2000, 0, 1), hhmm), locale);
}

function minutesOf(hhmm: string): number {
    const [h = 0, m = 0] = hhmm.split(":").map(Number);
    return h * 60 + m;
}

function clock(minutes: number): string {
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Every `step` minutes from `min` to `max`, keyed "HH:MM", with `keep` added when it falls between steps. */
export function clockOptions(
    step = 15,
    min = "00:00",
    max = "23:59",
    keep = "",
): { key: string; label: string }[] {
    const keys: string[] = [];
    for (let t = minutesOf(min); t <= minutesOf(max); t += Math.max(step, 1)) keys.push(clock(t));
    if (/^\d{2}:\d{2}$/.test(keep) && !keys.includes(keep)) {
        keys.push(keep);
        keys.sort();
    }
    return keys.map((key) => ({ key, label: formatClock(key) }));
}

export function utcSql(column: string): string {
    return `datetime(CASE WHEN ${column} LIKE '%+__' THEN ${column} || ':00' ELSE ${column} END)`;
}
