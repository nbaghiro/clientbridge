import { createContext, useContext } from "react";

import { activeLocale, type Locale } from "./locale";
import { strings } from "./strings";
import { BUNDLED_ZONES, type SupportedZone } from "./zones";

const MS_PER_MIN = 60_000;
const MS_PER_DAY = 86_400_000;

// CLDR starts en-CA weeks on Sunday; the product shows Monday-first weeks in English.
const FIRST_WEEKDAY: Record<Locale, number> = { "en-CA": 1, "en-XA": 1 };

type DateOptions = Omit<Intl.DateTimeFormatOptions, "timeZone" | "timeZoneName">;

/** Each zone's UTC offsets as [UTC second it starts, minutes], from the server's tzdata release. */
export interface ZoneTable {
    version: string;
    zones: Readonly<Record<string, readonly (readonly [number, number])[]>>;
}

interface WallTime {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    // 0 is Sunday, as in Date.getDay().
    weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

// Intl only words a wall clock: times are shifted by the zone table first and formatted in UTC.
function dateFormat(options: DateOptions): Intl.DateTimeFormat {
    const locale = activeLocale();
    const key = `${locale}|${JSON.stringify(options)}`;
    let format = formatters.get(key);
    if (format === undefined) {
        format = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
        formatters.set(key, format);
    }
    return format;
}

const shown = new Map<string, string>();

// Polyfilled Intl is slow on Hermes, and screens format the same few instants over and over.
function show(zone: string, options: DateOptions, d: Date | number): string {
    const wall = +d + offsetAt(+d, zone);
    const key = `${activeLocale()}|${JSON.stringify(options)}|${String(wall)}`;
    let text = shown.get(key);
    if (text === undefined) {
        text = dateFormat(options).format(wall);
        if (shown.size > 20_000) shown.clear();
        shown.set(key, text);
    }
    return text;
}

const pieces = new Map<string, Intl.DateTimeFormatPart[]>();

function partsOf(zone: string, options: DateOptions, d: Date | number): Intl.DateTimeFormatPart[] {
    const wall = +d + offsetAt(+d, zone);
    const key = `${activeLocale()}|${JSON.stringify(options)}|${String(wall)}`;
    let parts = pieces.get(key);
    if (parts === undefined) {
        parts = dateFormat(options).formatToParts(wall);
        if (pieces.size > 20_000) pieces.clear();
        pieces.set(key, parts);
    }
    return parts;
}

// Calendar days given only as keys are read and shown in UTC, which no offset shifts.
export const CALENDAR = "UTC";

/** "YYYY-MM-DD" for a calendar day; out-of-range months and days roll over. */
export function dayKey(year: number, month: number, day: number): string {
    return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

/** PowerSync stores Postgres timestamptz as text ("2026-06-26 10:00:00+00"); parse it as UTC-safe. */
export function parseTimestamp(value: string): Date {
    let iso = value.includes("T") ? value : value.replace(" ", "T");
    iso = iso.replace(/([+-]\d{2})$/, "$1:00");
    if (!/([zZ]|[+-]\d{2}:\d{2})$/.test(iso)) iso += "Z";
    return new Date(iso);
}

/** A stored date or timestamp; a bare "YYYY-MM-DD" is that calendar day in `zone`. */
export function readDate(value: string, zone: string): Date {
    return (value.length === 10 ? parseDateKey(value, zone) : null) ?? parseTimestamp(value);
}

let device: string | null = null;

/** Mobile reads the device zone from the native settings, since its Intl polyfill carries no zone data. */
export function setDeviceZone(zone: string): void {
    device = zone;
}

/** The zone the device runs in; only for telling a visitor that times are shown in another zone. */
export function deviceZone(): string {
    return device ?? new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

let zoneTable: ZoneTable = BUNDLED_ZONES;

const newer = (a: string, b: string): boolean => {
    const [ay = 0, ar = 0] = a.split(".").map(Number);
    const [by = 0, br = 0] = b.split(".").map(Number);
    return ay !== by ? ay > by : ar > br;
};

/** Use a zone table the server sent when its tzdata release is newer than the one bundled. */
export function adoptZoneTable(table: ZoneTable): boolean {
    if (!newer(table.version, zoneTable.version)) return false;
    zoneTable = table;
    offsets.clear();
    shown.clear();
    pieces.clear();
    return true;
}

export function zoneTableVersion(): string {
    return zoneTable.version;
}

const MS_PER_QUARTER = 15 * MS_PER_MIN;
const offsets = new Map<string, number>();

/** The UTC offset in ms a zone has at `time`: from the server's table, or Intl for a visitor's own zone. */
function offsetAt(time: number, zone: string): number {
    if (zone === CALENDAR) return 0;
    const rules = zoneTable.zones[zone];
    if (rules === undefined) return deviceOffsetAt(time, zone);
    const second = Math.floor(time / 1000);
    let lo = 0;
    let hi = rules.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if ((rules[mid]?.[0] ?? 0) <= second) lo = mid;
        else hi = mid - 1;
    }
    return (rules[lo]?.[1] ?? 0) * MS_PER_MIN;
}

const deviceClocks = new Map<string, Intl.DateTimeFormat>();

function deviceClock(zone: string): Intl.DateTimeFormat {
    let clock = deviceClocks.get(zone);
    if (clock === undefined) {
        clock = new Intl.DateTimeFormat("en-CA", {
            timeZone: zone,
            year: "numeric",
            month: "numeric",
            day: "numeric",
            hour: "numeric",
            minute: "numeric",
            hourCycle: "h23",
            numberingSystem: "latn",
        });
        deviceClocks.set(zone, clock);
    }
    return clock;
}

// Zones change offset only on a quarter hour, so one Intl call serves each zone's quarter hour.
function deviceOffsetAt(time: number, zone: string): number {
    const quarter = Math.floor(time / MS_PER_QUARTER);
    const key = `${zone}|${String(quarter)}`;
    let offset = offsets.get(key);
    if (offset === undefined) {
        const at = quarter * MS_PER_QUARTER;
        const parts = deviceClock(zone).formatToParts(at);
        const field = (type: Intl.DateTimeFormatPartTypes): number =>
            Number(parts.find((p) => p.type === type)?.value ?? 0);
        const wall = Date.UTC(
            field("year"),
            field("month") - 1,
            field("day"),
            field("hour") % 24,
            field("minute"),
        );
        offset = wall - at;
        if (offsets.size > 50_000) offsets.clear();
        offsets.set(key, offset);
    }
    return offset;
}

/** The calendar fields of an instant as a clock in `zone` reads them. */
export function wallTime(d: Date, zone: string): WallTime {
    const local = new Date(d.getTime() + offsetAt(d.getTime(), zone));
    return {
        year: local.getUTCFullYear(),
        month: local.getUTCMonth() + 1,
        day: local.getUTCDate(),
        hour: local.getUTCHours(),
        minute: local.getUTCMinutes(),
        weekday: local.getUTCDay(),
    };
}

/** The instant a clock in `zone` shows the given fields; out-of-range days and months roll over. */
export function zonedDate(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    zone: string,
): Date {
    const local = Date.UTC(year, month - 1, day, hour, minute);
    const first = local - offsetAt(local, zone);
    const second = local - offsetAt(first, zone);
    return new Date(second);
}

export function startOfDay(d: Date, zone: string): Date {
    const w = wallTime(d, zone);
    return zonedDate(w.year, w.month, w.day, 0, 0, zone);
}

/** Midnight in `zone`, `n` calendar days after the day of `d`. */
export function addDays(d: Date, n: number, zone: string): Date {
    const w = wallTime(d, zone);
    return zonedDate(w.year, w.month, w.day + n, 0, 0, zone);
}

export function firstWeekday(): number {
    return FIRST_WEEKDAY[activeLocale()];
}

export function startOfWeek(d: Date, zone: string): Date {
    const diff = (wallTime(d, zone).weekday - firstWeekday() + 7) % 7;
    return addDays(d, -diff, zone);
}

export function startOfMonth(d: Date, zone: string): Date {
    const w = wallTime(d, zone);
    return zonedDate(w.year, w.month, 1, 0, 0, zone);
}

export function sameDay(a: Date, b: Date, zone: string): boolean {
    return dateKey(a, zone) === dateKey(b, zone);
}

export function dateKey(d: Date, zone: string): string {
    const w = wallTime(d, zone);
    return `${String(w.year)}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

/** "HH:MM" on a 24-hour clock in `zone`. */
export function clockKey(d: Date, zone: string): string {
    const w = wallTime(d, zone);
    return `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
}

/** Short relative time for activity feeds: "just now", "5m", "3h", "2d", else a short date. */
export function formatRelativeTime(value: string, zone: string, now: Date = new Date()): string {
    const then = parseTimestamp(value);
    const mins = Math.floor((now.getTime() - then.getTime()) / MS_PER_MIN);
    if (mins < 1) return strings.common.relativeTime.justNow;
    if (mins < 60) return strings.common.relativeTime.minutes(mins);
    const hours = Math.floor(mins / 60);
    if (hours < 24) return strings.common.relativeTime.hours(hours);
    const days = Math.floor(hours / 24);
    if (days < 7) return strings.common.relativeTime.days(days);
    return formatShortDay(then, zone);
}

export function formatTime(d: Date, zone: string): string {
    return formatClock(clockKey(d, zone));
}

/** "9:00 a.m. – 5:00 p.m." */
export function formatTimeRange(start: Date, end: Date, zone: string): string {
    return strings.common.range(formatTime(start, zone), formatTime(end, zone));
}

/** "9" or "4:30" for a 24-hour "09:00" or "16:30": a shift's ends, without the day period. */
export function formatClockShort(hhmm: string): string {
    const [h = 0, m = 0] = hhmm.split(":").map(Number);
    const options: DateOptions =
        m === 0 ? { hour: "numeric" } : { hour: "numeric", minute: "2-digit" };
    return withoutPeriod(partsOf("UTC", options, Date.UTC(2000, 0, 1, h, m)));
}

function withoutPeriod(parts: Intl.DateTimeFormatPart[]): string {
    return parts
        .filter((p) => p.type !== "dayPeriod")
        .map((p) => p.value)
        .join("")
        .trim();
}

/** "9:30–10:15 a.m.": the compact range, which names a shared day period once. */
export function formatShortTimeRange(start: Date, end: Date, zone: string): string {
    const period = (d: Date): string | undefined =>
        partsOf(zone, { hour: "numeric", minute: "2-digit" }, d).find((p) => p.type === "dayPeriod")
            ?.value;
    const from =
        period(start) === period(end) ? formatTimeOfPeriod(start, zone) : formatTime(start, zone);
    return strings.common.shortRange(from, formatTime(end, zone));
}

/** "9:30" under a morning or afternoon heading: the time without its day period. */
export function formatTimeOfPeriod(d: Date, zone: string): string {
    return withoutPeriod(partsOf(zone, { hour: "numeric", minute: "2-digit" }, d));
}

/** "9 a.m." for an hour of the day on any clock. */
export function formatHour(hour: number): string {
    return show("UTC", { hour: "numeric" }, Date.UTC(2000, 0, 1, hour));
}

/** "9:30 a.m." for a 24-hour "09:30" on any clock. */
export function formatClock(hhmm: string): string {
    const [h = 0, m = 0] = hhmm.split(":").map(Number);
    return show("UTC", { hour: "numeric", minute: "2-digit" }, Date.UTC(2000, 0, 1, h, m));
}

export function formatWeekday(d: Date, zone: string): string {
    return show(zone, { weekday: "short" }, d);
}

export function formatLongWeekday(d: Date, zone: string): string {
    return show(zone, { weekday: "long" }, d);
}

/** "Fri, October 9" */
export function formatWeekdayMonthDay(d: Date, zone: string): string {
    return show(zone, { weekday: "short", month: "long", day: "numeric" }, d);
}

export function formatMonthDay(d: Date, zone: string): string {
    return show(zone, { month: "long", day: "numeric" }, d);
}

export function formatShortDay(d: Date, zone: string): string {
    return show(zone, { month: "short", day: "numeric" }, d);
}

export function formatFullDate(d: Date, zone: string): string {
    return show(zone, { weekday: "long", month: "long", day: "numeric" }, d);
}

export function formatMonthYear(d: Date, zone: string): string {
    return show(zone, { month: "long", year: "numeric" }, d);
}

/** "Oct 2026" */
export function formatShortMonthYear(d: Date, zone: string): string {
    return show(zone, { month: "short", year: "numeric" }, d);
}

export function formatDate(d: Date, zone: string): string {
    return show(zone, { year: "numeric", month: "short", day: "numeric" }, d);
}

/** "October 9, 2026" */
export function formatLongDate(d: Date, zone: string): string {
    return show(zone, { year: "numeric", month: "long", day: "numeric" }, d);
}

/** "Oct 9, 2026, 2:30 p.m." */
export function formatDateTime(d: Date, zone: string): string {
    return show(
        zone,
        {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
        },
        d,
    );
}

/** "Oct 9, 2:30 p.m." */
export function formatShortDayTime(d: Date, zone: string): string {
    return show(
        zone,
        {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
        },
        d,
    );
}

/** "Fri 2:30 p.m." */
export function formatWeekdayTime(d: Date, zone: string): string {
    return strings.common.weekdayAndTime(formatWeekday(d, zone), formatTime(d, zone));
}

/** "Fri, Oct 9, 2:30 p.m." */
export function formatDayTime(d: Date, zone: string): string {
    return show(
        zone,
        {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
        },
        d,
    );
}

/** "Wed, Oct 8": a near date where the year goes without saying. */
export function weekdayDay(d: Date, zone: string): string {
    return show(zone, { weekday: "short", month: "short", day: "numeric" }, d);
}

/** "Wed, Oct 8, 2027" */
function weekdayDayYear(d: Date, zone: string): string {
    return show(
        zone,
        {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
        },
        d,
    );
}

const ZONE_NAMES: Record<SupportedZone, () => string> = {
    "America/St_Johns": () => strings.datetime.zoneNames.newfoundland,
    "America/Halifax": () => strings.datetime.zoneNames.atlantic,
    "America/Toronto": () => strings.datetime.zoneNames.eastern,
    "America/Winnipeg": () => strings.datetime.zoneNames.central,
    "America/Regina": () => strings.datetime.zoneNames.saskatchewan,
    "America/Edmonton": () => strings.datetime.zoneNames.mountain,
    "America/Whitehorse": () => strings.datetime.zoneNames.yukon,
    "America/Vancouver": () => strings.datetime.zoneNames.pacific,
    "America/Creston": () => strings.datetime.zoneNames.creston,
    "America/Dawson_Creek": () => strings.datetime.zoneNames.dawsonCreek,
    "America/Fort_Nelson": () => strings.datetime.zoneNames.fortNelson,
    "America/Atikokan": () => strings.datetime.zoneNames.atikokan,
    "America/Blanc-Sablon": () => strings.datetime.zoneNames.blancSablon,
};

const isSupported = (zone: string): zone is SupportedZone => zone in ZONE_NAMES;

/** The name of the zone a visitor is told times are in: "Pacific Time". */
export function formatZoneName(zone: string, at: Date = new Date()): string {
    if (isSupported(zone)) return ZONE_NAMES[zone]();
    return (
        new Intl.DateTimeFormat(activeLocale(), { timeZone: zone, timeZoneName: "longGeneric" })
            .formatToParts(at)
            .find((p) => p.type === "timeZoneName")?.value ?? zone
    );
}

/** True when clocks in both zones read the same at `at`. */
export function sameClock(a: string, b: string, at: Date = new Date()): boolean {
    return a === b || offsetAt(+at, a) === offsetAt(+at, b);
}

export function formatShortMonth(d: Date, zone: string): string {
    return show(zone, { month: "short" }, d);
}

/** A day of the month on any calendar, without its weekday or month. */
export function formatDayNumber(d: Date, zone: string): string {
    return show(zone, { day: "numeric" }, d);
}

function nearDay(d: Date, zone: string, now: Date): string | null {
    const days = daysUntil(d, zone, now);
    if (days === 0) return strings.common.today;
    if (days === -1) return strings.common.yesterday;
    if (days === 1) return strings.common.tomorrow;
    return null;
}

/** "Today", "Yesterday" or "Tomorrow", else the short ("Wed, Oct 8") or long date. */
export function relativeDay(
    d: Date,
    zone: string,
    style: "short" | "long" = "short",
    now: Date = new Date(),
): string {
    return (
        nearDay(d, zone, now) ?? (style === "long" ? formatFullDate(d, zone) : weekdayDay(d, zone))
    );
}

/** "Today, 2:30 p.m." or "Wed, Oct 8, 9:00 a.m." */
export function relativeDayTime(d: Date, zone: string, now: Date = new Date()): string {
    const near = nearDay(d, zone, now);
    return near === null
        ? formatDayTime(d, zone)
        : strings.common.dayAndTime(near, formatTime(d, zone));
}

/** A feed timestamp: the time today, the weekday and time this week, else the date. */
export function stampLabel(d: Date, zone: string, now: Date = new Date()): string {
    const days = -daysUntil(d, zone, now);
    if (days === 0) return formatTime(d, zone);
    if (days > 0 && days < 7) return formatWeekdayTime(d, zone);
    return formatDate(d, zone);
}

function dayNumber(key: string): number {
    const [y = 1970, m = 1, d = 1] = key.split("-").map(Number);
    return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

/** Whole calendar days in `zone` from `now` to `d`; negative when `d` is in the past. */
export function daysUntil(d: Date, zone: string, now: Date = new Date()): number {
    return dayNumber(dateKey(d, zone)) - dayNumber(dateKey(now, zone));
}

/** A "YYYY-MM-DD" key as midnight in `zone`, or null when it isn't a real day. */
export function parseDateKey(key: string, zone: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (m === null) return null;
    const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
    return zonedDate(year, month, day, 0, 0, zone);
}

/** A picked "YYYY-MM-DDTHH:MM" as the instant a clock in `zone` reads it. */
export function parseWallDateTime(value: string, zone: string): Date {
    return combineDayAndTime(value.slice(0, 10), value.slice(11, 16), zone);
}

/** A typed 24-hour time on a day given as a date or a key, in `zone`. */
export function combineDayAndTime(day: Date | string, hhmm: string, zone: string): Date {
    const [h = 0, m = 0] = hhmm.split(":").map(Number);
    if (typeof day === "string") {
        const [y = 1970, mo = 1, d = 1] = day.split("-").map(Number);
        return zonedDate(y, mo, d, h, m, zone);
    }
    const w = wallTime(day, zone);
    return zonedDate(w.year, w.month, w.day, h, m, zone);
}

/** The instant `minutes` past midnight on the day of `d`, as a clock in `zone` counts them. */
export function minutesInto(d: Date, minutes: number, zone: string): Date {
    const w = wallTime(d, zone);
    return zonedDate(w.year, w.month, w.day, 0, minutes, zone);
}

/** Midnight on the same day of the month `n` months on, held to the last day of a shorter month. */
export function addMonths(d: Date, n: number, zone: string): Date {
    const w = wallTime(d, zone);
    const last = new Date(Date.UTC(w.year, w.month - 1 + n + 1, 0)).getUTCDate();
    return zonedDate(w.year, w.month + n, Math.min(w.day, last), 0, 0, zone);
}

/** "Wed, Oct 8" this year, "Wed, Oct 8, 2027" in any other. */
export function formatPickedDay(d: Date, zone: string, now: Date = new Date()): string {
    return wallTime(d, zone).year === wallTime(now, zone).year
        ? weekdayDay(d, zone)
        : weekdayDayYear(d, zone);
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

/** Six weeks covering the month of `month`, so the grid never changes height. */
export function monthWeeks(
    month: Date,
    selected: string,
    bounds: DayBounds,
    zone: string,
    now: Date = new Date(),
): CalendarDay[][] {
    const first = startOfWeek(startOfMonth(month, zone), zone);
    const shown = wallTime(month, zone).month;
    const today = dateKey(now, zone);
    return Array.from({ length: 6 }, (_, w) =>
        Array.from({ length: 7 }, (_, i) => {
            const d = addDays(first, w * 7 + i, zone);
            const key = dateKey(d, zone);
            const fields = wallTime(d, zone);
            return {
                key,
                day: fields.day,
                inMonth: fields.month === shown,
                today: key === today,
                selected: key === selected,
                disabled: outOfBounds(key, bounds),
                label: formatFullDate(d, zone),
            };
        }),
    );
}

/** Weekday numbers (0 is Sunday) in the order the locale's week runs. */
export function weekOrder(): number[] {
    return Array.from({ length: 7 }, (_, i) => (firstWeekday() + i) % 7);
}

/** A weekday's name on its own, 0 being Sunday. */
export function formatWeekdayName(weekday: number, width: "short" | "long" = "long"): string {
    // 2006-01-01 was a Sunday.
    return show("UTC", { weekday: width }, Date.UTC(2006, 0, 1 + weekday));
}

/** Short weekday names in week order. */
export function weekdayNames(): string[] {
    return weekOrder().map((d) => formatWeekdayName(d, "short"));
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

/** An indexable whole-day bound on the raw text, a day wide for any stored format; pair with utcSql. */
export function utcBeforeSql(column: string, param: string): string {
    return `${column} < date(${param}, '+2 days')`;
}

/** The lower bound to pair with utcBeforeSql, widened by `spanDays` for rows that start earlier. */
export function utcFromSql(column: string, param: string, spanDays = 0): string {
    return `${column} >= date(${param}, '-${String(spanDays + 1)} days')`;
}

// The app shell provides the business row's zone once it has synced (see useBusinessLoad).
export const BusinessZoneContext = createContext<string | null>(null);

/** The business's time zone, which staff surfaces show times and group days in. */
export function useBusinessZone(): string {
    const zone = useContext(BusinessZoneContext);
    if (zone === null) throw new Error("useBusinessZone needs a BusinessZoneContext provider");
    return zone;
}
