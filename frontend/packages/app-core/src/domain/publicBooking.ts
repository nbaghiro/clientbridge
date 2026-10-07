// Public clients use plain fetch, never the authed session; the slug or token is the credential.

import { useEffect, useRef, useState } from "react";

import { newIdempotencyKey } from "../api";
import { addDays, dateKey, formatTime, formatWeekday, parseTimestamp } from "../datetime";
import { formatMoney, formatMoneyWithCurrency } from "../format";
import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import type { DocTotalLine, ProgressStep } from "../ui";
import { type PublicBrand, usePublicResource } from "./publicResource";

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
    const mins = svc.duration_min !== null ? ` · ${s.minutes(svc.duration_min)}` : "";
    return `${money(svc.price_cents, svc.currency)}${mins}`;
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
    late_cancel_deposit: string;
    max_reschedules: number;
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
    itemId: string;
    staffId: string;
    startsAt: string;
    client: { name: string; email: string | null; phone: string | null };
    petName: string;
    note: string;
    addons: { itemId: string; quantity: number }[];
}

class PublicRequestError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = "PublicRequestError";
    }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, init);
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new PublicRequestError(res.status, text || res.statusText);
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
                    note: input.note || null,
                    addons: input.addons.map((x) => ({ item_id: x.itemId, quantity: x.quantity })),
                }),
            }),
    };
}

type PublicBusinessStatus = "loading" | "not-found" | "error" | "ready";

/** Profile, brand and services only, from the booking-page endpoint. */
export function usePublicBusiness(
    booking: PublicBookingClient,
    slug: string,
): { status: PublicBusinessStatus; page: PublicBookingPage | null } {
    const { status, data } = usePublicResource(booking.getServices, slug);
    return { status, page: data };
}

const ANY_STAFF = "any";

export function durationLabel(min: number): string {
    return min < 60 ? s.minutes(min) : s.hoursMinutes(Math.floor(min / 60), min % 60);
}

// Prices on a Canadian business's own page read as plain dollars; other currencies keep their code.
export function money(cents: number, currency = "CAD"): string {
    return currency === "CAD" ? formatMoney(cents) : formatMoneyWithCurrency(cents, currency);
}

const ymd = (key: string): Date => {
    const [y = 2026, mo = 1, d = 1] = key.split("-").map(Number);
    return new Date(y, mo - 1, d);
};

function dayLabel(key: string, today: string): string {
    if (key === today) return s.today;
    if (key === dateKey(addDays(ymd(today), 1))) return s.tomorrow;
    const d = ymd(key);
    return `${d.toLocaleDateString("en-CA", { weekday: "long" })}, ${d.toLocaleDateString("en-CA", { month: "long", day: "numeric" })}`;
}

export function whenLabel(startsAt: string, today: string): string {
    const d = parseTimestamp(startsAt);
    return s.at(dayLabel(dateKey(d), today), formatTime(d));
}

interface SlotGroup {
    label: string;
    slots: { key: string; label: string; hint?: string }[];
}

function groupSlots(slots: readonly OpenSlot[], staffName?: (id: string) => string): SlotGroup[] {
    const parts: { label: string; test: (h: number) => boolean }[] = [
        { label: s.morning, test: (h) => h < 12 },
        { label: s.afternoon, test: (h) => h >= 12 && h < 17 },
        { label: s.evening, test: (h) => h >= 17 },
    ];
    return parts
        .map((p) => ({
            label: p.label,
            slots: slots
                .filter((x) => p.test(parseTimestamp(x.starts_at).getHours()))
                .map((x) => ({
                    key: x.starts_at,
                    label: formatTime(parseTimestamp(x.starts_at)),
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

function toStrip(days: readonly DayOpenings[] | null, from: string, today: string): StripDay[] {
    return Array.from({ length: 7 }, (_, i) => {
        const date = addDays(ymd(from), i);
        const key = dateKey(date);
        const o = days?.find((d) => d.date === key);
        return {
            key,
            weekday: formatWeekday(date),
            day: String(date.getDate()),
            busy: o === undefined || o.count === 0 ? 0 : o.count < 4 ? 1 : o.count < 10 ? 2 : 3,
            closed: o?.closed === true,
            disabled: key < today || (o?.count === 0 && !o.closed),
            isToday: key === today,
        };
    });
}

export interface CalendarEntry {
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
    const esc = (t: string): string => t.replace(/[\\;,]/g, (c) => `\\${c}`);
    return [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Clientbridge//Booking//EN",
        "BEGIN:VEVENT",
        `UID:${icsStamp(e.starts_at)}-${String(e.title.length)}@clientbridge.ca`,
        `DTSTAMP:${icsStamp(new Date().toISOString())}`,
        `DTSTART:${icsStamp(e.starts_at)}`,
        `DTEND:${icsStamp(e.ends_at)}`,
        `SUMMARY:${esc(e.title)}`,
        `LOCATION:${esc(e.location)}`,
        "END:VEVENT",
        "END:VCALENDAR",
    ].join("\r\n");
}

type BookingStep = "service" | "time" | "details" | "pay" | "done";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const firstOf = (name: string | null): string => (name ?? "").split(" ")[0] ?? "";

/** The whole public booking flow: service, who and when, details with suggested extras, deposit. */
export function usePublicBookingFlow(client: PublicBookingClient, slug: string) {
    const { status, data: page } = usePublicResource(client.getServices, slug);
    const today = page?.now ? page.now.slice(0, 10) : dateKey(new Date());
    const [step, setStep] = useState<BookingStep>("service");
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
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [email, setEmail] = useState("");
    const [petName, setPetName] = useState("");
    const [note, setNote] = useState("");
    const [touched, setTouched] = useState(false);
    const [result, setResult] = useState<PublicBookingResult | null>(null);
    const key = useRef<string | null>(null);
    const { busy, error, setError, run } = useAsyncAction();

    const from = weekFrom ?? today;
    const day = date ?? days?.find((d) => d.count > 0)?.date ?? (days === null ? null : from);
    const service = page?.services.find((x) => x.id === itemId) ?? null;
    const staffFor =
        page?.staff.filter((x) => service === null || service.staff_ids.includes(x.id)) ?? [];
    const staffFirst = (id: string): string =>
        firstOf(page?.staff.find((x) => x.id === id)?.name ?? null);

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
    }, [client, slug, itemId, staffId, from, status]);

    useEffect(() => {
        setStartsAt("");
        if (itemId === "" || status !== "ready" || day === null) return;
        let live = true;
        setSlots(null);
        setSlotsError(false);
        client
            .getSlots(slug, { itemId, staffId, date: day })
            .then((x) => {
                if (live) setSlots(x);
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
    const currency = service?.currency ?? "CAD";
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
        "details",
        ...(depositCents > 0 ? (["pay"] as const) : []),
    ];
    const labels: Record<BookingStep, string> = {
        service: s.stepService,
        time: s.stepTime,
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
                        staffId: slot.staff_id ?? staffId,
                        startsAt: slot.starts_at,
                        client: {
                            name: name.trim(),
                            email: email.trim() || null,
                            phone: phone.trim() || null,
                        },
                        petName: petName.trim(),
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
            { errorMessage: s.bookError },
        );
    };

    const firstOpen = days?.find((d) => d.count > 0 && day !== null && d.date > day) ?? null;
    const closure = days?.find((d) => d.date === day && d.closed) ?? null;
    const slotStaff = slot?.staff_id
        ? (page?.staff.find((x) => x.id === slot.staff_id) ?? null)
        : null;

    const totalLines: DocTotalLine[] = addonLines.map((l) => ({
        key: l.addon.id,
        label: l.quantity > 1 ? `${String(l.quantity)} × ${l.addon.name}` : l.addon.name,
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
        strip: toStrip(days, from, today),
        canPrevWeek: from > today,
        prevWeek: () => {
            const d = dateKey(addDays(ymd(from), -7));
            setWeekFrom(d < today ? today : d);
            setDate(null);
        },
        nextWeek: () => {
            setWeekFrom(dateKey(addDays(ymd(from), 7)));
            setDate(null);
        },
        date: day,
        setDate,
        dateLabel: day === null ? "" : dayLabel(day, today),
        slots,
        slotsError,
        retrySlots: () => {
            setReload((n) => n + 1);
        },
        slotGroups: groupSlots(slots ?? [], staffId === ANY_STAFF ? staffFirst : undefined),
        firstOpen: firstOpen
            ? { key: firstOpen.date, label: dayLabel(firstOpen.date, today) }
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
        fields: {
            name,
            setName,
            phone,
            setPhone,
            email,
            setEmail,
            petName,
            setPetName,
            note,
            setNote,
        },
        errors: touched ? errors : { name: null, contact: null, email: null, pet: null },
        totals: {
            service: money(serviceCents, currency),
            addons: money(addonsCents, currency),
            deposit: money(depositCents, currency),
            depositCents,
            dueLater: money(serviceCents + addonsCents - depositCents, currency),
            total: money(serviceCents + addonsCents, currency),
        },
        totalLines,
        when: slot ? whenLabel(slot.starts_at, today) : null,
        timeRange: slot
            ? `${formatTime(parseTimestamp(slot.starts_at))} – ${formatTime(parseTimestamp(slot.ends_at))}`
            : null,
        result,
        calendar:
            slot && service && page
                ? {
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
    addons: { name: string; quantity: number; unit_cents: number }[];
    reschedules_used: number;
    policy: PublicPolicy;
    now: string;
    can_move: boolean;
    can_cancel: boolean;
    blocked: string | null;
}

interface ManageCancelResult {
    deposit: "refunded" | "kept" | "none";
    refund_cents: number;
}

interface ManageBookingClient {
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

type ManageMode = "view" | "move" | "cancel" | "moved" | "canceled";

/** The manage-booking page: what's booked, and moving or cancelling within the business's cut-offs. */
export function useManageBooking(client: ManageBookingClient, token: string) {
    const { status, data, setData } = usePublicResource(client.getBooking, token);
    const [mode, setModeRaw] = useState<ManageMode>("view");
    const [from, setFrom] = useState<string | null>(null);
    const [date, setDate] = useState<string | null>(null);
    const [days, setDays] = useState<DayOpenings[] | null>(null);
    const [slots, setSlots] = useState<OpenSlot[] | null>(null);
    const [pick, setPick] = useState("");
    const [refund, setRefund] = useState<number | null>(null);
    const key = useRef<string | null>(null);
    const { busy, error, run } = useAsyncAction();

    const now = data ? parseTimestamp(data.now) : new Date();
    const today = data ? data.now.slice(0, 10) : dateKey(now);
    const start = data ? parseTimestamp(data.starts_at) : now;
    const hoursAway = Math.floor((start.getTime() - now.getTime()) / 3_600_000);
    const live = data !== null && (data.status === "confirmed" || data.status === "pending");
    const weekFrom = from ?? today;
    const day = date ?? (data ? dateKey(start) : today);

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
    }, [client, token, mode, weekFrom]);

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
    }, [client, token, mode, day]);

    const deposit = data ? money(data.deposit_cents) : "";
    const hasDeposit =
        data !== null && data.deposit_status === "collected" && data.deposit_cents > 0;
    const policy = data?.policy;
    return {
        status,
        booking: data,
        today,
        mode,
        setMode: (x: ManageMode) => {
            key.current = null;
            setModeRaw(x);
        },
        when: data ? whenLabel(data.starts_at, today) : "",
        timeRange: data ? `${formatTime(start)} – ${formatTime(parseTimestamp(data.ends_at))}` : "",
        calendar: data
            ? {
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
        policyLine: policy
            ? policy.self_service
                ? m.policyLine(policy.cancel_cutoff_hours, policy.reschedule_cutoff_hours)
                : m.policyOff
            : "",
        cancelOutcome: hasDeposit ? m.cancelRefund(deposit) : m.cancelNoDeposit,
        deposit,
        hasDeposit,
        strip: toStrip(days, weekFrom, today),
        canPrevWeek: weekFrom > today,
        prevWeek: () => {
            const d = dateKey(addDays(ymd(weekFrom), -7));
            setFrom(d < today ? today : d);
        },
        nextWeek: () => {
            setFrom(dateKey(addDays(ymd(weekFrom), 7)));
        },
        date: day,
        setDate,
        dateLabel: dayLabel(day, today),
        slots,
        slotGroups: groupSlots(slots ?? []),
        pick,
        setPick,
        pickLabel: pick ? whenLabel(pick, today) : null,
        pickTime: pick ? formatTime(parseTimestamp(pick)) : null,
        confirmMove: () => {
            if (pick === "") return;
            key.current ??= newIdempotencyKey();
            const attempt = key.current;
            run(
                async () => {
                    setData(await client.reschedule(token, pick, attempt));
                    setModeRaw("moved");
                },
                { errorMessage: m.error },
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
                            can_move: false,
                            can_cancel: false,
                        });
                    setModeRaw("canceled");
                },
                { errorMessage: m.error },
            );
        },
        refundLabel: refund !== null ? money(refund) : null,
        busy,
        error,
    };
}

export type ManageBookingFlow = ReturnType<typeof useManageBooking>;
