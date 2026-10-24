// Public clients use plain fetch, never the authed session; the slug or token is the credential.

import { useEffect, useRef, useState } from "react";

import {
    type Attempt,
    attemptKey,
    failedStatus,
    failureMessage,
    refusal,
    sendAttempt,
} from "../api";
import {
    addDays,
    dateKey,
    deviceZone,
    formatDayNumber,
    formatFullDate,
    formatShortMonth,
    formatTime,
    formatTimeRange,
    formatWeekday,
    formatZoneName,
    sameClock,
    parseDateKey,
    parseTimestamp,
    startOfWeek,
    wallTime,
} from "../datetime";
import { formatMoney, formatParts, normalizePhone, BUSINESS_CURRENCY } from "../format";
import { isConnectionFailure, useAsyncAction } from "../hooks";
import { strings } from "../strings";
import type { DocTotalLine, OptionMedia, ProgressStep } from "../ui";
import { personMedia } from "./files";
import {
    type PublicBrand,
    type PublicDraftStorage,
    readPublicDraft,
    writePublicDraft,
    usePublicResource,
} from "./publicResource";
import type { SubjectKind } from "./subjects";

const s = strings.publicBooking;
const m = strings.publicManage;

interface PublicService {
    id: string;
    name: string;
    description: string | null;
    duration_min: number | null;
    price_cents: number;
    currency: string;
    deposit_required: boolean;
    deposit_amount_cents: number;
    image_url: string | null;
    kind: string;
    category: string | null;
    color: string | null;
    staff_ids: string[];
    // a program's days, booked together from its start dates
    session_count?: number | null;
}

/** Price and length of a service, e.g. "$45.00 · 60 min". */
export function serviceSummary(svc: PublicService): string {
    return formatParts([
        formatMoney(svc.price_cents, svc.currency),
        svc.duration_min !== null ? s.minutes(svc.duration_min) : null,
    ]);
}

interface PublicStaff {
    id: string;
    name: string | null;
    title: string | null;
    color: string | null;
    // Only for members the business shows on its public profile.
    photo_url?: string | null;
}

interface PublicAddon {
    id: string;
    name: string;
    price_cents: number;
    currency: string;
    image_url: string | null;
    description: string | null;
    in_stock: boolean;
    addon_for: string[];
    // minutes it adds to the visit, times its quantity
    duration_min?: number | null;
}

interface PublicPolicy {
    self_service: boolean;
    cancel_cutoff_hours: number;
    reschedule_cutoff_hours: number;
    max_reschedules: number;
    // How many days ahead online booking reaches; the week strip stops there once the page sends it.
    horizon_days?: number;
}

interface PublicBookingPage {
    business_name: string;
    brand: PublicBrand;
    services: PublicService[];
    staff: PublicStaff[];
    addons: PublicAddon[];
    stripe_account_id: string | null;
    slug: string;
    now: string | null;
    timezone: string;
    policy: PublicPolicy | null;
    subject: SubjectKind | null;
}

interface OpenSlot {
    starts_at: string;
    ends_at: string;
    staff_id: string | null;
    waitlist: boolean;
}

interface PublicProgram {
    starts_at: string;
    staff_id: string;
    days: { starts_at: string; ends_at: string }[];
    seats_left: number;
}

interface DayOpenings {
    date: string;
    count: number;
    waitlist: number;
    closed: boolean;
    reason: string | null;
}

interface PublicBookingResult {
    booking_id: string;
    status: string;
    manage_token: string | null;
    deposit_cents: number;
    deposit_client_secret: string | null;
    stripe_account_id: string | null;
    waitlist_position: number | null;
    // each day of a program enrolment, in order; empty for one visit
    days?: { booking_id: string; starts_at: string; ends_at: string }[];
}

interface BookingInput {
    returningToken?: string | null;
    subjectId?: string | null;
    itemId: string;
    staffId: string;
    startsAt: string;
    client: { name: string; email: string | null; phone: string | null };
    subjectName: string;
    subjectAddress: string;
    note: string;
    addons: { itemId: string; quantity: number }[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, init);
    if (!res.ok) {
        throw await refusal(res);
    }
    return (await res.json()) as T;
}

interface PublicBookingClient {
    getServices: (slug: string) => Promise<PublicBookingPage>;
    getDays: (
        slug: string,
        q: { itemId: string; staffId: string; from: string; days: number; extraMin?: number },
    ) => Promise<DayOpenings[]>;
    getSlots: (
        slug: string,
        q: { itemId: string; staffId: string; date: string; extraMin?: number },
    ) => Promise<OpenSlot[]>;
    book: (
        slug: string,
        input: BookingInput,
        idempotencyKey: string,
    ) => Promise<PublicBookingResult>;
    joinWaitlist: (
        slug: string,
        input: BookingInput,
        idempotencyKey: string,
    ) => Promise<PublicBookingResult>;
    getPrograms: (slug: string, q: { itemId: string; staffId: string }) => Promise<PublicProgram[]>;
}

function bookingBody(input: BookingInput): string {
    return JSON.stringify({
        item_id: input.itemId,
        staff_id: input.staffId,
        starts_at: input.startsAt,
        client: input.client,
        subject_name: input.subjectName || null,
        subject_address: input.subjectAddress || null,
        returning_token: input.returningToken ?? null,
        subject_id: input.subjectId ?? null,
        note: input.note || null,
        addons: input.addons.map((x) => ({ item_id: x.itemId, quantity: x.quantity })),
    });
}

export function createPublicBookingClient(baseUrl: string): PublicBookingClient {
    const at = (slug: string): string => `${baseUrl}/book/${encodeURIComponent(slug)}`;
    return {
        getServices: (slug) => request<PublicBookingPage>(`${at(slug)}/services`),
        getDays: async (slug, { itemId, staffId, from, days, extraMin = 0 }) => {
            const q = new URLSearchParams({
                item_id: itemId,
                staff_id: staffId,
                from,
                days: String(days),
            });
            if (extraMin > 0) q.set("extra_min", String(extraMin));
            return (await request<{ days: DayOpenings[] }>(`${at(slug)}/days?${q.toString()}`))
                .days;
        },
        getSlots: async (slug, { itemId, staffId, date, extraMin = 0 }) => {
            const q = new URLSearchParams({ item_id: itemId, staff_id: staffId, date });
            if (extraMin > 0) q.set("extra_min", String(extraMin));
            return (await request<{ slots: OpenSlot[] }>(`${at(slug)}/slots?${q.toString()}`))
                .slots;
        },
        book: (slug, input, idempotencyKey) =>
            request<PublicBookingResult>(at(slug), {
                method: "POST",
                headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
                body: bookingBody(input),
            }),
        joinWaitlist: (slug, input, idempotencyKey) =>
            request<PublicBookingResult>(`${at(slug)}/waitlist`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
                body: bookingBody(input),
            }),
        getPrograms: async (slug, { itemId, staffId }) => {
            const q = new URLSearchParams({ item_id: itemId, staff_id: staffId });
            return (
                await request<{ programs: PublicProgram[] }>(`${at(slug)}/programs?${q.toString()}`)
            ).programs;
        },
    };
}

const ANY_STAFF = "any";

export function durationLabel(min: number): string {
    return min < 60 ? s.minutes(min) : s.hoursMinutes(Math.floor(min / 60), min % 60);
}

const dayOf = (key: string, zone: string): Date => parseDateKey(key, zone) ?? new Date(NaN);

const shiftKey = (key: string, n: number, zone: string): string =>
    dateKey(addDays(dayOf(key, zone), n, zone), zone);

interface DayWords {
    today: string;
    tomorrow: string;
}

// Mid-sentence day words; a label that starts a line takes the capitalised common ones.
const midSentence = (): DayWords => ({ today: s.today, tomorrow: s.tomorrow });
const lineStart = (): DayWords => ({
    today: strings.common.today,
    tomorrow: strings.common.tomorrow,
});

function dayLabel(key: string, today: string, zone: string, words = midSentence()): string {
    if (key === today) return words.today;
    if (key === shiftKey(today, 1, zone)) return words.tomorrow;
    return formatFullDate(dayOf(key, zone), zone);
}

export function whenLabel(startsAt: string, today: string, zone: string): string {
    const d = parseTimestamp(startsAt);
    return s.at(dayLabel(dateKey(d, zone), today, zone), formatTime(d, zone));
}

/** The same as whenLabel, for a label that starts a line: "Today at 2:30 p.m." */
export function whenTitle(startsAt: string, today: string, zone: string): string {
    const d = parseTimestamp(startsAt);
    return s.at(dayLabel(dateKey(d, zone), today, zone, lineStart()), formatTime(d, zone));
}

/** "Times are in Pacific Time" when the visitor's clock reads a different zone, else null. */
export function zoneNote(zone: string): string | null {
    return sameClock(zone, deviceZone()) ? null : s.timesIn(formatZoneName(zone));
}

interface SlotGroup {
    label: string;
    slots: { key: string; label: string; hint?: string }[];
}

export function groupSlots(
    slots: readonly OpenSlot[],
    zone: string,
    staffName?: (id: string) => string,
): SlotGroup[] {
    const parts: { label: string; test: (h: number) => boolean }[] = [
        { label: s.morning, test: (h) => h < 12 },
        { label: s.afternoon, test: (h) => h >= 12 && h < 17 },
        { label: s.evening, test: (h) => h >= 17 },
    ];
    return parts
        .map((p) => ({
            label: p.label,
            slots: slots
                .filter((x) => p.test(wallTime(parseTimestamp(x.starts_at), zone).hour))
                .map((x) => ({
                    key: x.starts_at,
                    label: formatTime(parseTimestamp(x.starts_at), zone),
                    ...(x.waitlist
                        ? { hint: s.waitlistHint }
                        : staffName && x.staff_id !== null
                          ? { hint: staffName(x.staff_id) }
                          : {}),
                })),
        }))
        .filter((g) => g.slots.length > 0);
}

interface StripDay {
    key: string;
    weekday: string;
    day: string;
    busy: number;
    closed: boolean;
    disabled: boolean;
    isToday: boolean;
}

export function toStrip(
    days: readonly DayOpenings[] | null,
    from: string,
    today: string,
    zone: string,
): StripDay[] {
    return Array.from({ length: 7 }, (_, i) => {
        const date = addDays(dayOf(from, zone), i, zone);
        const key = dateKey(date, zone);
        const o = days?.find((d) => d.date === key);
        return {
            key,
            weekday: formatWeekday(date, zone),
            day: formatDayNumber(date, zone),
            busy: o === undefined || o.count === 0 ? 0 : o.count < 4 ? 1 : o.count < 10 ? 2 : 3,
            closed: o?.closed === true,
            disabled: key < today || (o?.count === 0 && o.waitlist === 0 && !o.closed),
            isToday: key === today,
        };
    });
}

export interface CalendarEntry {
    uid: string;
    title: string;
    starts_at: string;
    ends_at: string;
    location: string;
}

const icsStamp = (iso: string): string =>
    parseTimestamp(iso)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "");

/** An .ics file with one event per visit, so "Add to calendar" works in Apple, Google and Outlook. */
export function icsFor(entries: readonly CalendarEntry[]): string {
    const esc = (t: string): string =>
        t.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r\n|\r|\n/g, "\\n");
    const stamp = icsStamp(new Date().toISOString());
    return [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Clientbridge//Booking//EN",
        ...entries.flatMap((e) => [
            "BEGIN:VEVENT",
            `UID:${e.uid}@clientbridge.ca`,
            `DTSTAMP:${stamp}`,
            `DTSTART:${icsStamp(e.starts_at)}`,
            `DTEND:${icsStamp(e.ends_at)}`,
            `SUMMARY:${esc(e.title)}`,
            `LOCATION:${esc(e.location)}`,
            "END:VEVENT",
        ]),
        "END:VCALENDAR",
    ].join("\r\n");
}

/** What a confirmation adds to a calendar: every day of a program enrolment, else the one visit. */
export function bookedEntries(
    result: {
        booking_id: string;
        days?: readonly { booking_id: string; starts_at: string; ends_at: string }[];
    },
    slot: { starts_at: string; ends_at: string },
    visit: { slug: string; title: string; location: string },
): CalendarEntry[] {
    const days =
        result.days === undefined || result.days.length === 0
            ? [{ booking_id: result.booking_id, starts_at: slot.starts_at, ends_at: slot.ends_at }]
            : result.days;
    return days.map((d) => ({
        uid: `${d.booking_id}.${visit.slug}`,
        title: visit.title,
        starts_at: d.starts_at,
        ends_at: d.ends_at,
        location: visit.location,
    }));
}

/** The business-zone day a saved start falls on, or null when it isn't a time. */
export function draftDay(startsAt: string, zone: string): string | null {
    const d = parseTimestamp(startsAt);
    return Number.isNaN(d.getTime()) ? null : dateKey(d, zone);
}

/** The last day online booking reaches, or null when the page doesn't say. */
export function horizonDay(today: string, days: number | undefined, zone: string): string | null {
    return days === undefined ? null : shiftKey(today, days, zone);
}

/** Where a move's week strip opens: the visit's week, never before today. */
export function visitWeekFrom(start: Date, today: string, zone: string): string {
    const week = dateKey(startOfWeek(start, zone), zone);
    return week < today ? today : week;
}

/** A refused booking or move: a lost connection, a time just taken, or the action's own message. */
export function bookingFailure(error: unknown, fallback: string): string {
    if (isConnectionFailure(error)) return s.connectionError;
    return failedStatus(error) === 409 ? s.slotTaken : failureMessage(error, fallback);
}

// the catalog's select word for a business that books only the client
const NO_SUBJECT: SubjectKind | "none" = "none";

/** Kinds whose visits go to the subject's address: a property, a site or a parked vehicle. */
export function isPlace(kind: SubjectKind | null): boolean {
    return kind === "property" || kind === "site" || kind === "vehicle";
}

/** A maps search for an address, which opens the maps app on a phone. */
export function mapsUrl(address: string): string {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/** Where a visit happens: the subject's own address for a place kind, or else the business's. */
export function visitAddress(
    kind: SubjectKind | null,
    attributes: Record<string, unknown> | null,
    businessAddress: string | null,
): string | null {
    const own = attributes?.address;
    if (isPlace(kind) && typeof own === "string" && own.trim() !== "") return own.trim();
    return businessAddress !== null && businessAddress.trim() !== ""
        ? businessAddress.trim()
        : null;
}

type BookingStep = "service" | "extras" | "time" | "details" | "pay" | "done";

/** A program's start dates as choices: its dates, daily hours, days and seats left. */
function programChoices(
    programs: readonly PublicProgram[],
    zone: string,
): { key: string; label: string; hint: string }[] {
    return programs.map((p) => {
        const first = p.days[0];
        const last = p.days.at(-1);
        const start = parseTimestamp(p.starts_at);
        return {
            key: p.starts_at,
            label:
                first && last
                    ? s.programDates(
                          formatFullDate(parseTimestamp(first.starts_at), zone),
                          formatFullDate(parseTimestamp(last.starts_at), zone),
                      )
                    : formatFullDate(start, zone),
            hint: formatParts([
                first
                    ? formatTimeRange(start, parseTimestamp(first.ends_at), zone)
                    : formatTime(start, zone),
                s.programDays(p.days.length),
                s.programSeats(p.seats_left),
            ]),
        };
    });
}

/** The add-ons offered with a service: those listed for it, or for every service. */
function offeredWith(addons: readonly PublicAddon[], serviceId: string | null): PublicAddon[] {
    return addons.filter(
        (x) => x.addon_for.length === 0 || (serviceId !== null && x.addon_for.includes(serviceId)),
    );
}

/** The minutes chosen add-ons add to a visit; a class session keeps its own length. */
export function extraMinutes(
    addons: readonly PublicAddon[],
    chosen: Readonly<Record<string, number>>,
    kind: string | null,
): number {
    if (kind === "class") return 0;
    return addons.reduce((sum, a) => sum + (a.duration_min ?? 0) * (chosen[a.id] ?? 0), 0);
}

/** "Adds 30 min" under an add-on that lengthens the visit, else null. */
export function addsLabel(addon: PublicAddon): string | null {
    const minutes = addon.duration_min ?? 0;
    return minutes > 0 ? s.addsTime(durationLabel(minutes)) : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The details step's problems; the subject is asked for only when the business books one. */
export function detailErrors(
    d: { name: string; phone: string; email: string; subjectName: string; subjectAddress: string },
    kind: SubjectKind | null,
    existingSubject: boolean,
): Record<"name" | "contact" | "email" | "subject" | "address", string | null> {
    return {
        name: d.name.trim() === "" ? s.nameRequired : null,
        contact:
            d.phone.trim() === "" && d.email.trim() === ""
                ? s.contactRequired
                : d.phone.trim() !== "" && normalizePhone(d.phone) === null
                  ? s.phoneInvalid
                  : null,
        email: d.email.trim() !== "" && !EMAIL.test(d.email.trim()) ? s.emailInvalid : null,
        subject: kind !== null && d.subjectName.trim() === "" ? s.subjectRequired(kind) : null,
        address:
            kind !== null && isPlace(kind) && !existingSubject && d.subjectAddress.trim() === ""
                ? s.addressRequired(kind)
                : null,
    };
}

const firstOf = (name: string | null): string => (name ?? "").split(" ")[0] ?? "";

/** The whole public booking flow: service, who and when, details with suggested extras, deposit. */
export function usePublicBookingFlow(
    client: PublicBookingClient,
    slug: string,
    initial?: {
        storage?: PublicDraftStorage | undefined;
        itemId?: string | undefined;
        staffId?: string | undefined;
        startsAt?: string | undefined;
    },
) {
    const { status, data: page } = usePublicResource(client.getServices, slug);
    const kind = page?.subject ?? null;
    // Until the page loads nothing is shown, so the visitor's own zone stands in.
    const zone = page?.timezone ?? deviceZone();
    const today = page?.now ? page.now.slice(0, 10) : dateKey(new Date(), zone);
    const storage = initial?.storage;
    const draftKey = `connect-booking:${slug}`;
    const [draft] = useState(() => readPublicDraft(storage, draftKey));
    const selection = useRef({
        itemId: initial?.itemId ?? draft.itemId,
        staffId: initial?.itemId ? initial.staffId : draft.staffId,
        startsAt: initial?.itemId ? initial.startsAt : draft.startsAt,
    }).current;
    const [step, setStep] = useState<BookingStep>("service");
    const initialApplied = useRef(false);
    const initialTime = useRef(selection.startsAt ?? "");
    const [itemId, setItemId] = useState("");
    const [staffId, setStaffId] = useState<string>(ANY_STAFF);
    const [weekFrom, setWeekFrom] = useState<string | null>(null);
    const [date, setDate] = useState<string | null>(null);
    const [days, setDays] = useState<DayOpenings[] | null>(null);
    const [daysError, setDaysError] = useState(false);
    const [slots, setSlots] = useState<OpenSlot[] | null>(null);
    const [slotsError, setSlotsError] = useState(false);
    const [programs, setPrograms] = useState<PublicProgram[] | null>(null);
    const [reload, setReload] = useState(0);
    const [startsAt, setStartsAt] = useState("");
    const [addons, setAddons] = useState<Record<string, number>>({});
    const [name, setName] = useState(draft.name ?? "");
    const [phone, setPhone] = useState(draft.phone ?? "");
    const [email, setEmail] = useState(draft.email ?? "");
    const [subjectName, setSubjectName] = useState(draft.subjectName ?? "");
    const [subjectAddress, setSubjectAddress] = useState(draft.subjectAddress ?? "");
    const [returningToken, setReturningToken] = useState<string | null>(null);
    const [subjectId, setSubjectId] = useState<string | null>(null);
    const [note, setNote] = useState(draft.note ?? "");
    const [touched, setTouched] = useState(false);
    const [result, setResult] = useState<PublicBookingResult | null>(null);
    const key = useRef<Attempt | null>(null);
    const { busy, error, setError, run } = useAsyncAction();

    useEffect(() => {
        if (!initialApplied.current) return;
        writePublicDraft(
            storage,
            draftKey,
            result
                ? null
                : {
                      itemId,
                      staffId,
                      startsAt,
                      name,
                      phone,
                      email,
                      subjectName,
                      subjectAddress,
                      note,
                  },
        );
    }, [
        storage,
        draftKey,
        result,
        itemId,
        staffId,
        startsAt,
        name,
        phone,
        email,
        subjectName,
        subjectAddress,
        note,
    ]);

    const clearReturning = (): void => {
        setReturningToken(null);
        setSubjectId(null);
        key.current = null;
    };
    useEffect(() => {
        setReturningToken(null);
        setSubjectId(null);
    }, [slug]);

    const from = weekFrom ?? today;
    const day =
        date ??
        days?.find((d) => d.count > 0 || d.waitlist > 0)?.date ??
        (days === null ? null : from);
    const service = page?.services.find((x) => x.id === itemId) ?? null;
    const program = (service?.session_count ?? null) !== null;
    const offered = program ? [] : offeredWith(page?.addons ?? [], service?.id ?? null);
    const extraMin = extraMinutes(offered, addons, service?.kind ?? null);
    const firstStep = (id: string): BookingStep =>
        (page?.services.find((x) => x.id === id)?.session_count ?? null) === null &&
        offeredWith(page?.addons ?? [], id).length > 0
            ? "extras"
            : "time";
    const staffFor =
        page?.staff.filter((x) => service === null || service.staff_ids.includes(x.id)) ?? [];
    const staffFirst = (id: string): string =>
        firstOf(page?.staff.find((x) => x.id === id)?.name ?? null);

    useEffect(() => {
        if (initialApplied.current || page === null || status !== "ready") return;
        initialApplied.current = true;
        const selected = page.services.find((candidate) => candidate.id === selection.itemId);
        if (!selected) return;
        setItemId(selected.id);
        if (selection.staffId && selected.staff_ids.includes(selection.staffId))
            setStaffId(selection.staffId);
        const starts = draftDay(selection.startsAt ?? "", zone);
        if (starts !== null && starts >= today) {
            setDate(starts);
            setWeekFrom(starts);
        }
        const extras =
            (selected.session_count ?? null) === null &&
            offeredWith(page.addons, selected.id).length > 0;
        setStep(extras ? "extras" : "time");
    }, [page, status, selection.itemId, selection.staffId, selection.startsAt, today, zone]);

    useEffect(() => {
        if (itemId === "" || status !== "ready" || !program) return;
        let live = true;
        setSlots(null);
        setSlotsError(false);
        client
            .getPrograms(slug, { itemId, staffId })
            .then((x) => {
                if (!live) return;
                setPrograms(x);
                setSlots(
                    x.map((p) => ({
                        starts_at: p.starts_at,
                        ends_at: p.days[0]?.ends_at ?? p.starts_at,
                        staff_id: p.staff_id,
                        waitlist: false,
                    })),
                );
            })
            .catch(() => {
                if (live) setSlotsError(true);
            });
        return () => {
            live = false;
        };
    }, [client, slug, itemId, staffId, program, status, reload]);

    useEffect(() => {
        if (itemId === "" || status !== "ready" || program) return;
        let live = true;
        setDays(null);
        setDaysError(false);
        client
            .getDays(slug, { itemId, staffId, from, days: 7, extraMin })
            .then((d) => {
                if (live) setDays(d);
            })
            .catch(() => {
                if (live) setDaysError(true);
            });
        return () => {
            live = false;
        };
    }, [client, slug, itemId, staffId, from, extraMin, program, status, reload]);

    useEffect(() => {
        if (program) return;
        setStartsAt("");
        if (itemId === "" || status !== "ready" || day === null) return;
        let live = true;
        setSlots(null);
        setSlotsError(false);
        client
            .getSlots(slug, { itemId, staffId, date: day, extraMin })
            .then((x) => {
                if (live) {
                    setSlots(x);
                    if (initialTime.current) {
                        const match = x.find(
                            (slot) =>
                                Date.parse(slot.starts_at) === Date.parse(initialTime.current),
                        );
                        if (match) {
                            setStartsAt(match.starts_at);
                            setStep("details");
                        }
                        initialTime.current = "";
                    }
                }
            })
            .catch(() => {
                if (live) setSlotsError(true);
            });
        return () => {
            live = false;
        };
    }, [client, slug, itemId, staffId, day, extraMin, program, status, reload]);

    const slot = slots?.find((x) => x.starts_at === startsAt) ?? null;
    const waitlist = slot?.waitlist === true;
    // a waitlist seat books no add-ons, so the totals leave them out
    const addonLines = waitlist
        ? []
        : offered
              .filter((x) => (addons[x.id] ?? 0) > 0)
              .map((x) => ({
                  addon: x,
                  quantity: addons[x.id] ?? 0,
                  cents: x.price_cents * (addons[x.id] ?? 0),
              }));
    const addonsCents = addonLines.reduce((sum, l) => sum + l.cents, 0);
    const depositCents =
        service?.deposit_required === true && !waitlist ? service.deposit_amount_cents : 0;
    const serviceCents = service?.price_cents ?? 0;
    const currency = service?.currency ?? BUSINESS_CURRENCY;

    const errors = detailErrors(
        { name, phone, email, subjectName, subjectAddress },
        kind,
        subjectId !== null,
    );
    const detailsOk = Object.values(errors).every((x) => x === null);
    const order: BookingStep[] = [
        "service",
        ...(offered.length > 0 ? (["extras"] as const) : []),
        "time",
        "details",
        ...(depositCents > 0 ? (["pay"] as const) : []),
    ];
    const labels: Record<BookingStep, string> = {
        service: s.stepService,
        time: s.stepTime,
        extras: s.stepExtras,
        details: s.stepDetails,
        pay: s.stepPay,
        done: s.doneTitle,
    };
    const at = order.indexOf(step);
    const steps = order.map((k, i): ProgressStep => ({
        key: k,
        label: labels[k],
        state: step === "done" || i < at ? "done" : i === at ? "current" : "todo",
    }));
    const canNext =
        step === "service"
            ? service !== null
            : step === "time"
              ? slot !== null
              : step === "extras"
                ? true
                : step === "details"
                  ? detailsOk
                  : false;

    const book = (): void => {
        if (service === null || slot === null) return;
        if (!detailsOk) {
            setTouched(true);
            return;
        }
        const input = {
            itemId: service.id,
            staffId,
            startsAt: slot.starts_at,
            client: {
                name: name.trim(),
                email: email.trim() || null,
                phone: normalizePhone(phone),
            },
            subjectName: kind === null ? "" : subjectName.trim(),
            subjectAddress: isPlace(kind) && subjectId === null ? subjectAddress.trim() : "",
            returningToken,
            subjectId: kind === null ? null : subjectId,
            note: note.trim(),
            addons: addonLines.map((l) => ({
                itemId: l.addon.id,
                quantity: l.quantity,
            })),
        };
        run(
            async () => {
                const r = await sendAttempt(key, input, (attempt) =>
                    waitlist
                        ? client.joinWaitlist(slug, input, attempt)
                        : client.book(slug, input, attempt),
                );
                setResult(r);
                setStep(r.deposit_client_secret !== null ? "pay" : "done");
            },
            {
                errorMessage: (e) => {
                    if (failedStatus(e) === 409) refreshTimes();
                    return bookingFailure(e, s.bookError);
                },
            },
        );
    };
    const refreshTimes = (): void => {
        setStartsAt("");
        key.current = null;
        setReload((n) => n + 1);
        setStep("time");
    };

    const lastDay = horizonDay(today, page?.policy?.horizon_days, zone);
    const laterWeek = lastDay === null || shiftKey(from, 7, zone) <= lastDay;
    const firstOpen =
        days?.find((d) => (d.count > 0 || d.waitlist > 0) && day !== null && d.date > day) ?? null;
    const closure = days?.find((d) => d.date === day && d.closed) ?? null;
    const slotStaff = slot?.staff_id
        ? (page?.staff.find((x) => x.id === slot.staff_id) ?? null)
        : null;

    const totalLines: DocTotalLine[] = addonLines.map((l) => ({
        key: l.addon.id,
        label: l.quantity > 1 ? strings.common.quantityOf(l.quantity, l.addon.name) : l.addon.name,
        cents: l.cents,
        kind: "subtotal",
    }));
    if (service !== null)
        totalLines.unshift({
            key: "service",
            label: service.name,
            cents: serviceCents,
            kind: "subtotal",
        });
    totalLines.push({
        key: "total",
        label: s.total,
        cents: serviceCents + addonsCents,
        kind: "total",
    });
    if (depositCents > 0)
        totalLines.push(
            { key: "now", label: s.dueNow, cents: depositCents, kind: "balance" },
            {
                key: "later",
                label: s.dueAtVisit,
                cents: serviceCents + addonsCents - depositCents,
                kind: "subtotal",
            },
        );

    return {
        status,
        page,
        today,
        zone,
        zoneNote: page ? zoneNote(zone) : null,
        step,
        steps,
        goTo: (k: BookingStep) => {
            if (order.indexOf(k) <= at) setStep(k);
        },
        next: () => {
            if (step === "details") {
                book();
                return;
            }
            if (!canNext) {
                setTouched(true);
                return;
            }
            const following = order[order.indexOf(step) + 1];
            if (following !== undefined) setStep(following);
        },
        back: () => {
            const prev = order[at - 1];
            if (prev !== undefined) setStep(prev);
        },
        canNext,
        categories: Array.from(new Set(page?.services.map((x) => x.category ?? "") ?? [])).map(
            (c) => ({
                category: c,
                services: page?.services.filter((x) => (x.category ?? "") === c) ?? [],
            }),
        ),
        service,
        setService: (id: string) => {
            setItemId(id);
            setStep(firstStep(id));
            key.current = null;
            const svc = page?.services.find((x) => x.id === id);
            if (svc && staffId !== ANY_STAFF && !svc.staff_ids.includes(staffId))
                setStaffId(ANY_STAFF);
        },
        staffOptions: [
            {
                id: ANY_STAFF,
                name: s.anyone,
                title: s.anyoneHint,
                color: null as string | null,
                media: undefined as OptionMedia | undefined,
            },
            ...staffFor.map((x) => ({
                id: x.id,
                name: x.name ?? "",
                title: x.title ?? "",
                color: x.color,
                media: x.photo_url ? personMedia(x.name ?? "", x.color, x.photo_url) : undefined,
            })),
        ],
        staffId,
        setStaffId: (id: string) => {
            setStaffId(id);
            setDate(null);
        },
        strip: toStrip(days, from, today, zone),
        canPrevWeek: from > today,
        prevWeek: () => {
            const d = shiftKey(from, -7, zone);
            setWeekFrom(d < today ? today : d);
            setDate(null);
        },
        canNextWeek: laterWeek,
        nextWeek: () => {
            if (!laterWeek) return;
            setWeekFrom(shiftKey(from, 7, zone));
            setDate(null);
        },
        date: day,
        setDate,
        dateLabel: day === null ? "" : dayLabel(day, today, zone),
        slots,
        slotsError: slotsError || daysError,
        retrySlots: () => {
            setReload((n) => n + 1);
        },
        slotGroups: groupSlots(slots ?? [], zone, staffId === ANY_STAFF ? staffFirst : undefined),
        firstOpen: firstOpen
            ? { key: firstOpen.date, label: dayLabel(firstOpen.date, today, zone) }
            : null,
        closure: closure?.reason ?? null,
        startsAt,
        pickSlot: (k: string) => {
            setStartsAt(k);
            key.current = null;
            setError(null);
        },
        slot,
        slotStaff,
        waitlist,
        waitlistNotice: waitlist ? s.waitlistNotice : null,
        offered,
        addons,
        toggleAddon: (id: string) => {
            key.current = null;
            setAddons((prev) => {
                if ((prev[id] ?? 0) > 0)
                    return Object.fromEntries(Object.entries(prev).filter(([k]) => k !== id));
                return { ...prev, [id]: 1 };
            });
        },
        addonLines,
        returningToken,
        subjectId,
        setReturning: (identity: { token: string; subjectId: string | null } | null): void => {
            setReturningToken(identity?.token ?? null);
            setSubjectId(identity?.subjectId ?? null);
            key.current = null;
        },
        selectUsual: (serviceId: string, previousStaffId: string): void => {
            const selected = page?.services.find((candidate) => candidate.id === serviceId);
            if (!selected) return;
            setItemId(selected.id);
            setStaffId(selected.staff_ids.includes(previousStaffId) ? previousStaffId : ANY_STAFF);
            setStartsAt("");
            setSlots(null);
            setDays(null);
            setDate(null);
            setWeekFrom(null);
            setAddons({});
            key.current = null;
            setError(null);
            setStep(firstStep(selected.id));
        },
        fields: {
            name,
            setName: (value: string): void => {
                setName(value);
                clearReturning();
            },
            phone,
            setPhone: (value: string): void => {
                setPhone(value);
                clearReturning();
            },
            email,
            setEmail: (value: string): void => {
                setEmail(value);
                clearReturning();
            },
            subjectName,
            setSubjectName: (value: string): void => {
                setSubjectName(value);
                setSubjectId(null);
                key.current = null;
            },
            subjectAddress,
            setSubjectAddress: (value: string): void => {
                setSubjectAddress(value);
                key.current = null;
            },
            note,
            setNote,
        },
        kind,
        notePlaceholder: s.notePlaceholder(kind ?? NO_SUBJECT),
        errors: touched
            ? errors
            : { name: null, contact: null, email: null, subject: null, address: null },
        totals: {
            service: formatMoney(serviceCents, currency),
            addons: formatMoney(addonsCents, currency),
            deposit: formatMoney(depositCents, currency),
            depositCents,
            dueLater: formatMoney(serviceCents + addonsCents - depositCents, currency),
            total: formatMoney(serviceCents + addonsCents, currency),
        },
        totalLines,
        currency,
        programs: program ? programChoices(programs ?? [], zone) : null,
        programNote: program ? s.programNote : null,
        when: slot
            ? program
                ? (programChoices(programs ?? [], zone).find((x) => x.key === slot.starts_at)
                      ?.label ?? null)
                : whenLabel(slot.starts_at, today, zone)
            : null,
        whenTitle: slot ? whenTitle(slot.starts_at, today, zone) : null,
        timeRange: slot
            ? formatTimeRange(parseTimestamp(slot.starts_at), parseTimestamp(slot.ends_at), zone)
            : null,
        result,
        waitlistBody:
            result?.status === "waitlisted" && slot
                ? s.waitlistBody(
                      result.waitlist_position ?? 1,
                      whenLabel(slot.starts_at, today, zone).replace(/\.$/, ""),
                  )
                : null,
        calendar:
            slot && service && page && result
                ? bookedEntries(result, slot, {
                      slug: page.slug,
                      title: s.calendarTitle(service.name, page.business_name),
                      location: page.business_name,
                  })
                : null,
        paid: () => {
            setStep("done");
        },
        busy,
        error,
        restart: () => {
            setResult(null);
            setStartsAt("");
            setAddons({});
            setItemId("");
            key.current = null;
            setStep("service");
        },
    };
}

export type PublicBookingFlow = ReturnType<typeof usePublicBookingFlow>;

interface ManagedBooking {
    address?: string | null;
    photo_urls?: string[];
    to_do?: { kind: "form" | "signature"; label: string; path: string | null }[];
    at_place?: boolean;
    booking_id: string;
    business_name: string;
    brand: PublicBrand;
    slug: string;
    client_name: string;
    subject: SubjectKind | null;
    subject_name: string | null;
    service: PublicService;
    staff: PublicStaff;
    starts_at: string;
    ends_at: string;
    status: string;
    deposit_cents: number;
    deposit_status: string;
    deposit_due: boolean;
    accepts_card: boolean;
    refund_status?: string | null;
    addons: { name: string; quantity: number; unit_cents: number }[];
    reschedules_used: number;
    policy: PublicPolicy;
    now: string;
    timezone: string;
    can_move: boolean;
    can_cancel: boolean;
    has_receipt?: boolean;
    blocked: ManageBlock | null;
    blocked_hours: number | null;
    waitlist_position: number | null;
    // a program's enrolled days, which a cancel releases together
    program_days?: number | null;
}

type ManageBlock =
    "status" | "by_phone" | "cutoff" | "class_session" | "reschedule_limit" | "member_unavailable";

/** Why the client can't change the visit online, worded from its code. */
function blockedReason(code: ManageBlock | null, hours: number | null): string | null {
    const b = strings.publicManage.blocked;
    switch (code) {
        case null:
            return null;
        case "cutoff":
            return b.cutoff(hours ?? 0);
        case "status":
            return b.status;
        case "by_phone":
            return b.by_phone;
        case "class_session":
            return b.class_session;
        case "reschedule_limit":
            return b.reschedule_limit;
        case "member_unavailable":
            return b.member_unavailable;
    }
}

interface ManageCancelResult {
    deposit: "refunded" | "kept" | "none" | "pending" | "failed";
    refund_cents: number;
}

interface DepositIntent {
    client_secret: string;
    stripe_account_id: string;
}

interface ManageBookingClient {
    message: (token: string, body: string, key: string) => Promise<{ id: string }>;
    payDeposit: (token: string) => Promise<DepositIntent>;
    getBooking: (token: string) => Promise<ManagedBooking>;
    getDays: (token: string, q: { from: string; days: number }) => Promise<DayOpenings[]>;
    getSlots: (token: string, q: { date: string }) => Promise<OpenSlot[]>;
    reschedule: (
        token: string,
        startsAt: string,
        idempotencyKey: string,
    ) => Promise<ManagedBooking>;
    cancel: (token: string, idempotencyKey: string) => Promise<ManageCancelResult>;
}

export function createManageBookingClient(baseUrl: string): ManageBookingClient {
    const at = (token: string): string => `${baseUrl}/manage/${encodeURIComponent(token)}`;
    const post = <T>(url: string, key: string, body: unknown): Promise<T> =>
        request<T>(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Idempotency-Key": key },
            body: JSON.stringify(body),
        });
    return {
        getBooking: (token) => request<ManagedBooking>(at(token)),
        message: (token, body, key) => post<{ id: string }>(`${at(token)}/message`, key, { body }),
        getDays: async (token, { from, days }) => {
            const q = new URLSearchParams({ from, days: String(days) });
            return (await request<{ days: DayOpenings[] }>(`${at(token)}/days?${q.toString()}`))
                .days;
        },
        getSlots: async (token, { date }) =>
            (
                await request<{ slots: OpenSlot[] }>(
                    `${at(token)}/slots?date=${encodeURIComponent(date)}`,
                )
            ).slots,
        reschedule: (token, startsAt, key) =>
            post<ManagedBooking>(`${at(token)}/reschedule`, key, { starts_at: startsAt }),
        cancel: (token, key) => post<ManageCancelResult>(`${at(token)}/cancel`, key, {}),
        payDeposit: (token) => request<DepositIntent>(`${at(token)}/deposit`, { method: "POST" }),
    };
}

type ManageMode = "view" | "move" | "cancel" | "moved" | "canceled" | "message";

/** The manage-booking page: what's booked, and moving or cancelling within the business's cut-offs. */
export function useManageBooking(client: ManageBookingClient, token: string) {
    const { status, data, setData } = usePublicResource(client.getBooking, token);
    const [messageBody, setMessageBody] = useState("");
    const [messageSent, setMessageSent] = useState(false);
    const messageKey = useRef<Attempt | null>(null);
    const [mode, setModeRaw] = useState<ManageMode>("view");
    const [from, setFrom] = useState<string | null>(null);
    const [date, setDate] = useState<string | null>(null);
    const [days, setDays] = useState<DayOpenings[] | null>(null);
    const [daysError, setDaysError] = useState(false);
    const [slots, setSlots] = useState<OpenSlot[] | null>(null);
    const [slotsError, setSlotsError] = useState(false);
    const [reload, setReload] = useState(0);
    const [pick, setPick] = useState("");
    const [refund, setRefund] = useState<number | null>(null);
    const [depositCard, setDepositCard] = useState<DepositIntent | null>(null);
    const [depositThanks, setDepositThanks] = useState(false);
    const key = useRef<Attempt | null>(null);
    const { busy, error, run } = useAsyncAction();
    const depositAction = useAsyncAction();

    const now = data ? parseTimestamp(data.now) : new Date();
    // Until the booking loads nothing is shown, so the visitor's own zone stands in.
    const zone = data?.timezone ?? deviceZone();
    const today = data ? data.now.slice(0, 10) : dateKey(now, zone);
    const start = data ? parseTimestamp(data.starts_at) : now;
    const hoursAway = Math.floor((start.getTime() - now.getTime()) / 3_600_000);
    const live = data !== null && (data.status === "confirmed" || data.status === "pending");
    const [left, setLeft] = useState(false);
    const waiting = data?.status === "waitlisted";
    const programDays = data?.program_days ?? null;
    const weekFrom = from ?? (data ? visitWeekFrom(start, today, zone) : today);
    const day = date ?? (data ? dateKey(start, zone) : today);
    const lastDay = horizonDay(today, data?.policy.horizon_days, zone);
    const canNext = lastDay === null || shiftKey(weekFrom, 7, zone) <= lastDay;

    useEffect(() => {
        if (mode !== "move") return;
        let on = true;
        setDays(null);
        setDaysError(false);
        client
            .getDays(token, { from: weekFrom, days: 7 })
            .then((d) => {
                if (on) setDays(d);
            })
            .catch(() => {
                if (on) setDaysError(true);
            });
        return () => {
            on = false;
        };
    }, [client, token, mode, weekFrom, reload]);

    useEffect(() => {
        if (mode !== "move") return;
        let on = true;
        setSlots(null);
        setSlotsError(false);
        setPick("");
        client
            .getSlots(token, { date: day })
            .then((x) => {
                if (on) setSlots(x);
            })
            .catch(() => {
                if (on) setSlotsError(true);
            });
        return () => {
            on = false;
        };
    }, [client, token, mode, day, reload]);

    const currency = data?.service.currency ?? BUSINESS_CURRENCY;
    const deposit = data ? formatMoney(data.deposit_cents, currency) : "";
    const hasDeposit =
        data !== null && data.deposit_status === "collected" && data.deposit_cents > 0;
    const depositDue = live && data.deposit_due;
    const policy = data?.policy;
    return {
        status,
        booking: data,
        messageBody,
        setMessageBody: (value: string) => {
            setMessageBody(value);
            setMessageSent(false);
            messageKey.current = null;
        },
        messageSent,
        sendMessage: () => {
            if (!messageBody.trim()) return;
            const attempt = attemptKey(messageKey, messageBody.trim());
            run(
                async () => {
                    await client.message(token, messageBody.trim(), attempt);
                    setMessageSent(true);
                    setMessageBody("");
                    messageKey.current = null;
                },
                { errorMessage: m.messageError },
            );
        },
        today,
        mode,
        setMode: (x: ManageMode) => {
            key.current = null;
            setModeRaw(x);
        },
        zoneNote: data ? zoneNote(zone) : null,
        when: data ? whenLabel(data.starts_at, today, zone) : "",
        whenTitle: data ? whenTitle(data.starts_at, today, zone) : "",
        timeRange: data ? formatTimeRange(start, parseTimestamp(data.ends_at), zone) : "",
        calendar: data
            ? [
                  {
                      uid: `${data.booking_id}.${data.slug}`,
                      title: s.calendarTitle(data.service.name, data.business_name),
                      starts_at: data.starts_at,
                      ends_at: data.ends_at,
                      location: data.business_name,
                  },
              ]
            : null,
        countdown: m.countdown(
            hoursAway < 48
                ? m.inHours(Math.max(0, hoursAway))
                : m.inDays(Math.round(hoursAway / 24)),
        ),
        live,
        waiting,
        waitlistLine: waiting ? m.waitlistLine(data.waitlist_position ?? 1) : null,
        labels:
            waiting || left
                ? {
                      title: m.waitlistLabel,
                      cancel: m.leaveWaitlist,
                      cancelTitle: m.leaveTitle,
                      cancelConfirm: m.leaveConfirm,
                      canceledTitle: m.leftTitle,
                  }
                : {
                      title: m.title,
                      cancel: programDays === null ? m.cancel : m.cancelProgram,
                      cancelTitle:
                          programDays === null ? m.cancelTitle : m.cancelProgramTitle(programDays),
                      cancelConfirm: m.cancelConfirm,
                      canceledTitle: m.canceledTitle,
                  },
        canCancel: (live || waiting) && data.can_cancel,
        canMove: live && data.can_move,
        blocked: live ? blockedReason(data.blocked, data.blocked_hours) : null,
        dateTile: {
            month: formatShortMonth(start, zone),
            day: formatDayNumber(start, zone),
            weekday: formatWeekday(start, zone),
        },
        windowMeter: (() => {
            const span = Math.max(
                72,
                (policy?.cancel_cutoff_hours ?? 24) * 2,
                (policy?.reschedule_cutoff_hours ?? 24) * 2,
            );
            const cut = 100 - ((policy?.cancel_cutoff_hours ?? 24) / span) * 100;
            const move = 100 - ((policy?.reschedule_cutoff_hours ?? 24) / span) * 100;
            return {
                first: Math.min(cut, move),
                second: Math.max(cut, move),
                now: Math.min(98, Math.max(2, 100 - (hoursAway / span) * 100)),
            };
        })(),
        cancelDeadline:
            data && policy
                ? whenLabel(
                      new Date(
                          start.getTime() - policy.cancel_cutoff_hours * 3_600_000,
                      ).toISOString(),
                      today,
                      zone,
                  )
                : "",
        moveDeadline:
            data && policy
                ? whenLabel(
                      new Date(
                          start.getTime() - policy.reschedule_cutoff_hours * 3_600_000,
                      ).toISOString(),
                      today,
                      zone,
                  )
                : "",
        policyLine: policy
            ? policy.self_service
                ? m.policyLine(policy.cancel_cutoff_hours, policy.reschedule_cutoff_hours)
                : m.policyOff
            : "",
        cancelOutcome: hasDeposit ? m.cancelRefund(deposit) : m.cancelNoDeposit,
        deposit,
        hasDeposit,
        depositDue,
        canPayDeposit: depositDue && data.accepts_card,
        depositLine: hasDeposit
            ? m.depositPaid(deposit)
            : depositDue
              ? data.accepts_card
                  ? m.depositDueBody(deposit)
                  : m.depositOffline(deposit, data.business_name)
              : m.cancelNoDeposit,
        depositThanks: depositThanks ? m.depositThanks(deposit) : null,
        depositCard,
        depositBusy: depositAction.busy,
        depositError: depositAction.error,
        payDeposit: (configured: boolean) => {
            if (!configured) {
                depositAction.setError(strings.publicPay.cardNotConfigured);
                return;
            }
            depositAction.run(
                async () => {
                    setDepositCard(await client.payDeposit(token));
                },
                {
                    errorMessage: (e) => {
                        if (failedStatus(e) === 409)
                            client
                                .getBooking(token)
                                .then(setData)
                                .catch(() => undefined);
                        return failureMessage(e, strings.publicPay.cardStartError);
                    },
                },
            );
        },
        cancelDepositCard: () => {
            setDepositCard(null);
        },
        depositPaid: () => {
            setDepositCard(null);
            setDepositThanks(true);
            if (data) setData({ ...data, deposit_status: "collected", deposit_due: false });
        },
        strip: toStrip(days, weekFrom, today, zone),
        canPrevWeek: weekFrom > today,
        prevWeek: () => {
            const d = shiftKey(weekFrom, -7, zone);
            setFrom(d < today ? today : d);
        },
        canNextWeek: canNext,
        nextWeek: () => {
            if (canNext) setFrom(shiftKey(weekFrom, 7, zone));
        },
        date: day,
        setDate,
        dateLabel: dayLabel(day, today, zone),
        slots,
        slotsError: slotsError || daysError,
        retrySlots: () => {
            setReload((n) => n + 1);
        },
        slotGroups: groupSlots(slots ?? [], zone),
        pick,
        setPick,
        pickTitle: pick ? whenTitle(pick, today, zone) : null,
        pickTime: pick ? formatTime(parseTimestamp(pick), zone) : null,
        confirmMove: () => {
            if (pick === "") return;
            run(
                async () => {
                    setData(
                        await sendAttempt(key, ["move", pick], (attempt) =>
                            client.reschedule(token, pick, attempt),
                        ),
                    );
                    setModeRaw("moved");
                },
                {
                    errorMessage: (e) => {
                        if (failedStatus(e) === 409) {
                            key.current = null;
                            setReload((n) => n + 1);
                        }
                        return bookingFailure(e, m.error);
                    },
                },
            );
        },
        confirmCancel: () => {
            const attempt = attemptKey(key, ["cancel", token]);
            run(
                async () => {
                    const r = await client.cancel(token, attempt);
                    setLeft(waiting);
                    setRefund(r.deposit === "refunded" ? r.refund_cents : null);
                    if (data)
                        setData({
                            ...data,
                            status: "canceled",
                            refund_status: r.deposit,
                            can_move: false,
                            can_cancel: false,
                        });
                    setModeRaw("canceled");
                },
                { errorMessage: m.error },
            );
        },
        refundLabel: refund !== null ? formatMoney(refund, currency) : null,
        refundMessage:
            data?.refund_status === "pending"
                ? m.refundPending
                : data?.refund_status === "failed"
                  ? m.refundFailed
                  : null,
        busy,
        error,
    };
}

export type ManageBookingFlow = ReturnType<typeof useManageBooking>;
