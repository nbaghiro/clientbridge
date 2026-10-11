// Public clients use plain fetch, never the authed session; the slug or token is the credential.

import { useEffect, useRef, useState } from "react";

import { failedStatus, newIdempotencyKey, refusal } from "../api";
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
    parseDateKey,
    parseTimestamp,
    startOfWeek,
    wallTime,
} from "../datetime";
import { formatMoney, formatParts, BUSINESS_CURRENCY } from "../format";
import { isConnectionFailure, useAsyncAction } from "../hooks";
import { strings } from "../strings";
import type { DocTotalLine, ProgressStep } from "../ui";
import {
    type PublicBrand,
    type PublicDraftStorage,
    readPublicDraft,
    writePublicDraft,
    usePublicResource,
} from "./publicResource";

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
    rating: number | null;
    review_count: number;
}

interface OpenSlot {
    starts_at: string;
    ends_at: string;
    staff_id: string | null;
}

interface DayOpenings {
    date: string;
    count: number;
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
}

interface BookingInput {
    returningToken?: string | null;
    subjectId?: string | null;
    itemId: string;
    staffId: string;
    startsAt: string;
    client: { name: string; email: string | null; phone: string | null };
    petName: string;
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
        q: { itemId: string; staffId: string; from: string; days: number },
    ) => Promise<DayOpenings[]>;
    getSlots: (
        slug: string,
        q: { itemId: string; staffId: string; date: string },
    ) => Promise<OpenSlot[]>;
    book: (
        slug: string,
        input: BookingInput,
        idempotencyKey: string,
    ) => Promise<PublicBookingResult>;
}

export function createPublicBookingClient(baseUrl: string): PublicBookingClient {
    const at = (slug: string): string => `${baseUrl}/book/${encodeURIComponent(slug)}`;
    return {
        getServices: (slug) => request<PublicBookingPage>(`${at(slug)}/services`),
        getDays: async (slug, { itemId, staffId, from, days }) => {
            const q = new URLSearchParams({
                item_id: itemId,
                staff_id: staffId,
                from,
                days: String(days),
            });
            return (await request<{ days: DayOpenings[] }>(`${at(slug)}/days?${q.toString()}`))
                .days;
        },
        getSlots: async (slug, { itemId, staffId, date }) => {
            const q = new URLSearchParams({ item_id: itemId, staff_id: staffId, date });
            return (await request<{ slots: OpenSlot[] }>(`${at(slug)}/slots?${q.toString()}`))
                .slots;
        },
        book: (slug, input, idempotencyKey) =>
            request<PublicBookingResult>(at(slug), {
                method: "POST",
                headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
                body: JSON.stringify({
                    item_id: input.itemId,
                    staff_id: input.staffId,
                    starts_at: input.startsAt,
                    client: input.client,
                    pet_name: input.petName || null,
                    returning_token: input.returningToken ?? null,
                    subject_id: input.subjectId ?? null,
                    note: input.note || null,
                    addons: input.addons.map((x) => ({ item_id: x.itemId, quantity: x.quantity })),
                }),
            }),
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
    return formatZoneName(zone) === formatZoneName(deviceZone())
        ? null
        : s.timesIn(formatZoneName(zone));
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
                    ...(staffName && x.staff_id !== null ? { hint: staffName(x.staff_id) } : {}),
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
            disabled: key < today || (o?.count === 0 && !o.closed),
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

/** An .ics file for one visit, so "Add to calendar" works in Apple, Google and Outlook. */
export function icsFor(e: CalendarEntry): string {
    const esc = (t: string): string =>
        t.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r\n|\r|\n/g, "\\n");
    return [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Clientbridge//Booking//EN",
        "BEGIN:VEVENT",
        `UID:${e.uid}@clientbridge.ca`,
        `DTSTAMP:${icsStamp(new Date().toISOString())}`,
        `DTSTART:${icsStamp(e.starts_at)}`,
        `DTEND:${icsStamp(e.ends_at)}`,
        `SUMMARY:${esc(e.title)}`,
        `LOCATION:${esc(e.location)}`,
        "END:VEVENT",
        "END:VCALENDAR",
    ].join("\r\n");
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
    return failedStatus(error) === 409 ? s.slotTaken : fallback;
}

type BookingStep = "service" | "time" | "extras" | "details" | "pay" | "done";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    const [slots, setSlots] = useState<OpenSlot[] | null>(null);
    const [slotsError, setSlotsError] = useState(false);
    const [reload, setReload] = useState(0);
    const [startsAt, setStartsAt] = useState("");
    const [addons, setAddons] = useState<Record<string, number>>({});
    const [name, setName] = useState(draft.name ?? "");
    const [phone, setPhone] = useState(draft.phone ?? "");
    const [email, setEmail] = useState(draft.email ?? "");
    const [petName, setPetName] = useState(draft.petName ?? "");
    const [returningToken, setReturningToken] = useState<string | null>(null);
    const [subjectId, setSubjectId] = useState<string | null>(null);
    const [note, setNote] = useState(draft.note ?? "");
    const [touched, setTouched] = useState(false);
    const [result, setResult] = useState<PublicBookingResult | null>(null);
    const key = useRef<string | null>(null);
    const { busy, error, setError, run } = useAsyncAction();

    useEffect(() => {
        if (!initialApplied.current) return;
        writePublicDraft(
            storage,
            draftKey,
            result ? null : { itemId, staffId, startsAt, name, phone, email, petName, note },
        );
    }, [storage, draftKey, result, itemId, staffId, startsAt, name, phone, email, petName, note]);

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
    const day = date ?? days?.find((d) => d.count > 0)?.date ?? (days === null ? null : from);
    const service = page?.services.find((x) => x.id === itemId) ?? null;
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
        setStep("time");
    }, [page, status, selection.itemId, selection.staffId, selection.startsAt, today, zone]);

    useEffect(() => {
        if (itemId === "" || status !== "ready") return;
        let live = true;
        setDays(null);
        client
            .getDays(slug, { itemId, staffId, from, days: 7 })
            .then((d) => {
                if (live) setDays(d);
            })
            .catch(() => {
                if (live) setDays([]);
            });
        return () => {
            live = false;
        };
    }, [client, slug, itemId, staffId, from, status, reload]);

    useEffect(() => {
        setStartsAt("");
        if (itemId === "" || status !== "ready" || day === null) return;
        let live = true;
        setSlots(null);
        setSlotsError(false);
        client
            .getSlots(slug, { itemId, staffId, date: day })
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
    }, [client, slug, itemId, staffId, day, status, reload]);

    const offered = (page?.addons ?? []).filter(
        (x) => x.addon_for.length === 0 || (service !== null && x.addon_for.includes(service.id)),
    );
    const addonLines = offered
        .filter((x) => (addons[x.id] ?? 0) > 0)
        .map((x) => ({
            addon: x,
            quantity: addons[x.id] ?? 0,
            cents: x.price_cents * (addons[x.id] ?? 0),
        }));
    const addonsCents = addonLines.reduce((sum, l) => sum + l.cents, 0);
    const depositCents = service?.deposit_required === true ? service.deposit_amount_cents : 0;
    const serviceCents = service?.price_cents ?? 0;
    const currency = service?.currency ?? BUSINESS_CURRENCY;
    const slot = slots?.find((x) => x.starts_at === startsAt) ?? null;

    const errors = {
        name: name.trim() === "" ? s.nameRequired : null,
        contact: phone.trim() === "" && email.trim() === "" ? s.contactRequired : null,
        email: email.trim() !== "" && !EMAIL.test(email.trim()) ? s.emailInvalid : null,
        pet: petName.trim() === "" ? s.petRequired : null,
    };
    const detailsOk = Object.values(errors).every((x) => x === null);
    const order: BookingStep[] = [
        "service",
        "time",
        ...(offered.length > 0 ? (["extras"] as const) : []),
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
        key.current ??= newIdempotencyKey();
        const attempt = key.current;
        run(
            async () => {
                const r = await client.book(
                    slug,
                    {
                        itemId: service.id,
                        staffId,
                        startsAt: slot.starts_at,
                        client: {
                            name: name.trim(),
                            email: email.trim() || null,
                            phone: phone.trim() || null,
                        },
                        petName: petName.trim(),
                        returningToken,
                        subjectId,
                        note: note.trim(),
                        addons: addonLines.map((l) => ({
                            itemId: l.addon.id,
                            quantity: l.quantity,
                        })),
                    },
                    attempt,
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
    const firstOpen = days?.find((d) => d.count > 0 && day !== null && d.date > day) ?? null;
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
            setStep("time");
            key.current = null;
            const svc = page?.services.find((x) => x.id === id);
            if (svc && staffId !== ANY_STAFF && !svc.staff_ids.includes(staffId))
                setStaffId(ANY_STAFF);
        },
        staffOptions: [
            { id: ANY_STAFF, name: s.anyone, title: s.anyoneHint, color: null as string | null },
            ...staffFor.map((x) => ({
                id: x.id,
                name: x.name ?? "",
                title: x.title ?? "",
                color: x.color,
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
        slotsError,
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
            setStep("time");
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
            petName,
            setPetName: (value: string): void => {
                setPetName(value);
                setSubjectId(null);
                key.current = null;
            },
            note,
            setNote,
        },
        errors: touched ? errors : { name: null, contact: null, email: null, pet: null },
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
        when: slot ? whenLabel(slot.starts_at, today, zone) : null,
        whenTitle: slot ? whenTitle(slot.starts_at, today, zone) : null,
        timeRange: slot
            ? formatTimeRange(parseTimestamp(slot.starts_at), parseTimestamp(slot.ends_at), zone)
            : null,
        result,
        calendar:
            slot && service && page && result
                ? {
                      uid: `${result.booking_id}.${page.slug}`,
                      title: s.calendarTitle(service.name, page.business_name),
                      starts_at: slot.starts_at,
                      ends_at: slot.ends_at,
                      location: page.business_name,
                  }
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
    booking_id: string;
    business_name: string;
    brand: PublicBrand;
    slug: string;
    client_name: string;
    pet_name: string | null;
    service: PublicService;
    staff: PublicStaff;
    starts_at: string;
    ends_at: string;
    status: string;
    deposit_cents: number;
    deposit_status: string;
    refund_status?: string | null;
    addons: { name: string; quantity: number; unit_cents: number }[];
    reschedules_used: number;
    policy: PublicPolicy;
    now: string;
    timezone: string;
    can_move: boolean;
    can_cancel: boolean;
    blocked: string | null;
}

interface ManageCancelResult {
    deposit: "refunded" | "kept" | "none" | "pending" | "failed";
    refund_cents: number;
}

interface ManageBookingClient {
    message: (token: string, body: string, key: string) => Promise<{ id: string }>;
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
    };
}

type ManageMode = "view" | "move" | "cancel" | "moved" | "canceled" | "message";

/** The manage-booking page: what's booked, and moving or cancelling within the business's cut-offs. */
export function useManageBooking(client: ManageBookingClient, token: string) {
    const { status, data, setData } = usePublicResource(client.getBooking, token);
    const [messageBody, setMessageBody] = useState("");
    const [messageSent, setMessageSent] = useState(false);
    const messageKey = useRef<string | null>(null);
    const [mode, setModeRaw] = useState<ManageMode>("view");
    const [from, setFrom] = useState<string | null>(null);
    const [date, setDate] = useState<string | null>(null);
    const [days, setDays] = useState<DayOpenings[] | null>(null);
    const [slots, setSlots] = useState<OpenSlot[] | null>(null);
    const [reload, setReload] = useState(0);
    const [pick, setPick] = useState("");
    const [refund, setRefund] = useState<number | null>(null);
    const key = useRef<string | null>(null);
    const { busy, error, run } = useAsyncAction();

    const now = data ? parseTimestamp(data.now) : new Date();
    // Until the booking loads nothing is shown, so the visitor's own zone stands in.
    const zone = data?.timezone ?? deviceZone();
    const today = data ? data.now.slice(0, 10) : dateKey(now, zone);
    const start = data ? parseTimestamp(data.starts_at) : now;
    const hoursAway = Math.floor((start.getTime() - now.getTime()) / 3_600_000);
    const live = data !== null && (data.status === "confirmed" || data.status === "pending");
    const weekFrom = from ?? (data ? visitWeekFrom(start, today, zone) : today);
    const day = date ?? (data ? dateKey(start, zone) : today);
    const lastDay = horizonDay(today, data?.policy.horizon_days, zone);
    const canNext = lastDay === null || shiftKey(weekFrom, 7, zone) <= lastDay;

    useEffect(() => {
        if (mode !== "move") return;
        let on = true;
        client
            .getDays(token, { from: weekFrom, days: 7 })
            .then((d) => {
                if (on) setDays(d);
            })
            .catch(() => {
                if (on) setDays([]);
            });
        return () => {
            on = false;
        };
    }, [client, token, mode, weekFrom, reload]);

    useEffect(() => {
        if (mode !== "move") return;
        let on = true;
        setSlots(null);
        setPick("");
        client
            .getSlots(token, { date: day })
            .then((x) => {
                if (on) setSlots(x);
            })
            .catch(() => {
                if (on) setSlots([]);
            });
        return () => {
            on = false;
        };
    }, [client, token, mode, day, reload]);

    const currency = data?.service.currency ?? BUSINESS_CURRENCY;
    const deposit = data ? formatMoney(data.deposit_cents, currency) : "";
    const hasDeposit =
        data !== null && data.deposit_status === "collected" && data.deposit_cents > 0;
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
            messageKey.current ??= newIdempotencyKey();
            const attempt = messageKey.current;
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
            ? {
                  uid: `${data.booking_id}.${data.slug}`,
                  title: s.calendarTitle(data.service.name, data.business_name),
                  starts_at: data.starts_at,
                  ends_at: data.ends_at,
                  location: data.business_name,
              }
            : null,
        countdown: m.countdown(
            hoursAway < 48
                ? m.inHours(Math.max(0, hoursAway))
                : m.inDays(Math.round(hoursAway / 24)),
        ),
        live,
        canCancel: live && data.can_cancel,
        canMove: live && data.can_move,
        blocked: live ? data.blocked : null,
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
        slotGroups: groupSlots(slots ?? [], zone),
        pick,
        setPick,
        pickTitle: pick ? whenTitle(pick, today, zone) : null,
        pickTime: pick ? formatTime(parseTimestamp(pick), zone) : null,
        confirmMove: () => {
            if (pick === "") return;
            key.current ??= newIdempotencyKey();
            const attempt = key.current;
            run(
                async () => {
                    setData(await client.reschedule(token, pick, attempt));
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
            key.current ??= newIdempotencyKey();
            const attempt = key.current;
            run(
                async () => {
                    const r = await client.cancel(token, attempt);
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
