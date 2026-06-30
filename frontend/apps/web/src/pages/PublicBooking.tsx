import {
    type PublicBookingPage,
    type PublicBookingResult,
    PublicBookingError,
    type PublicService,
    type PublicSlot,
    type PublicStaff,
    createPublicBookingClient,
    dateKey,
    formatMoneyWithCurrency,
    formatTime,
    parseTimestamp,
    useAsyncAction,
} from "@clientbridge/app-core";
import { type FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

const booking = createPublicBookingClient(import.meta.env.VITE_API_URL ?? "http://localhost:8701");

const field =
    "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-accent";

export function PublicBooking() {
    const { slug = "" } = useParams<{ slug: string }>();

    const [page, setPage] = useState<PublicBookingPage | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [itemId, setItemId] = useState("");
    const [staffId, setStaffId] = useState("");
    const [date, setDate] = useState(() => dateKey(new Date()));

    const [slots, setSlots] = useState<PublicSlot[] | null>(null);
    const [slotsError, setSlotsError] = useState<string | null>(null);
    const [startsAt, setStartsAt] = useState("");

    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");

    const [result, setResult] = useState<PublicBookingResult | null>(null);
    const action = useAsyncAction();

    useEffect(() => {
        let live = true;
        setLoading(true);
        booking
            .getServices(slug)
            .then((p) => {
                if (live) setPage(p);
            })
            .catch((err: unknown) => {
                if (!live) return;
                if (err instanceof PublicBookingError && err.status === 404) setNotFound(true);
                else setLoadError("We couldn't load this booking page. Please try again later.");
            })
            .finally(() => {
                if (live) setLoading(false);
            });
        return () => {
            live = false;
        };
    }, [slug]);

    useEffect(() => {
        setStartsAt("");
        if (itemId === "" || staffId === "" || date === "") {
            setSlots(null);
            return;
        }
        let live = true;
        setSlots(null);
        setSlotsError(null);
        booking
            .getSlots(slug, { itemId, staffId, date })
            .then((res) => {
                if (live) setSlots(res.slots);
            })
            .catch(() => {
                if (live) setSlotsError("We couldn't load open times. Please try another day.");
            });
        return () => {
            live = false;
        };
    }, [slug, itemId, staffId, date]);

    if (loading) return <Frame>{<Centered>Loading…</Centered>}</Frame>;

    if (notFound)
        return (
            <Frame>
                <h1 className="font-display text-xl font-bold text-ink">Booking page not found</h1>
                <p className="mt-2 text-sm text-muted">
                    This link is invalid or the business isn't accepting online bookings right now.
                </p>
            </Frame>
        );

    if (loadError || !page)
        return (
            <Frame>
                <h1 className="font-display text-xl font-bold text-ink">Something went wrong</h1>
                <p className="mt-2 text-sm text-muted">{loadError ?? "Please try again later."}</p>
            </Frame>
        );

    if (result) return <BookedState page={page} result={result} />;

    const service = page.services.find((s) => s.id === itemId) ?? null;
    const canBook =
        startsAt !== "" &&
        name.trim().length > 0 &&
        (email.trim().length > 0 || phone.trim().length > 0);

    const submit = (e: FormEvent): void => {
        e.preventDefault();
        if (!canBook) {
            action.setError("Add your name and an email or phone, then pick a time.");
            return;
        }
        void action.run(
            async () => {
                setResult(
                    await booking.book(slug, {
                        itemId,
                        staffId,
                        startsAt,
                        client: { name: name.trim(), email: email.trim(), phone: phone.trim() },
                    }),
                );
            },
            {
                errorMessage:
                    "We couldn't book that time. It may have just been taken — try another.",
            },
        );
    };

    return (
        <Frame>
            <p className="text-sm text-muted">Book an appointment with</p>
            <h1 className="mt-1 font-display text-xl font-bold text-ink">{page.business_name}</h1>

            <form onSubmit={submit} className="mt-6 space-y-5">
                <Labeled label="Service">
                    <select
                        value={itemId}
                        onChange={(e) => {
                            setItemId(e.target.value);
                        }}
                        className={field}
                    >
                        <option value="">Select a service</option>
                        {page.services.map((s) => (
                            <option key={s.id} value={s.id}>
                                {serviceLabel(s)}
                            </option>
                        ))}
                    </select>
                </Labeled>

                {service !== null ? (
                    <>
                        <Labeled label="With">
                            <select
                                value={staffId}
                                onChange={(e) => {
                                    setStaffId(e.target.value);
                                }}
                                className={field}
                            >
                                <option value="">Select a team member</option>
                                {page.staff.map((st) => (
                                    <option key={st.id} value={st.id}>
                                        {staffLabel(st)}
                                    </option>
                                ))}
                            </select>
                        </Labeled>

                        <Labeled label="Date">
                            <input
                                type="date"
                                value={date}
                                min={dateKey(new Date())}
                                onChange={(e) => {
                                    setDate(e.target.value);
                                }}
                                className={field}
                            />
                        </Labeled>
                    </>
                ) : null}

                {staffId !== "" && itemId !== "" ? (
                    <Slots
                        slots={slots}
                        error={slotsError}
                        selected={startsAt}
                        onSelect={(v) => {
                            setStartsAt(v);
                            action.setError(null);
                        }}
                    />
                ) : null}

                {startsAt !== "" && service !== null ? (
                    <div className="space-y-3 border-t border-line pt-4">
                        <Labeled label="Your name">
                            <input
                                value={name}
                                onChange={(e) => {
                                    setName(e.target.value);
                                }}
                                placeholder="Full name"
                                className={field}
                            />
                        </Labeled>
                        <Labeled label="Email">
                            <input
                                value={email}
                                onChange={(e) => {
                                    setEmail(e.target.value);
                                }}
                                inputMode="email"
                                placeholder="you@example.com"
                                className={field}
                            />
                        </Labeled>
                        <Labeled label="Phone">
                            <input
                                value={phone}
                                onChange={(e) => {
                                    setPhone(e.target.value);
                                }}
                                inputMode="tel"
                                placeholder="(555) 555-5555"
                                className={field}
                            />
                        </Labeled>
                        <p className="text-xs text-muted">
                            Add an email or phone so the business can reach you.
                        </p>
                        {service.deposit_required ? (
                            <p className="rounded-md bg-accent-weak px-3 py-2 text-xs text-accent-strong">
                                A deposit of{" "}
                                {formatMoneyWithCurrency(
                                    service.deposit_amount_cents,
                                    service.currency,
                                )}{" "}
                                is required to confirm this booking.
                            </p>
                        ) : null}

                        <button
                            type="submit"
                            disabled={action.busy || !canBook}
                            className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                        >
                            {action.busy ? "Booking…" : "Confirm booking"}
                        </button>
                    </div>
                ) : null}

                {action.error !== null ? (
                    <p className="text-sm text-danger-fg">{action.error}</p>
                ) : null}
            </form>
        </Frame>
    );
}

function serviceLabel(s: PublicService): string {
    const price = formatMoneyWithCurrency(s.price_cents, s.currency);
    const mins = s.duration_min !== null ? ` · ${s.duration_min} min` : "";
    return `${s.name} — ${price}${mins}`;
}

function staffLabel(st: PublicStaff): string {
    return st.name ?? st.title ?? "Any available";
}

function Slots({
    slots,
    error,
    selected,
    onSelect,
}: {
    slots: PublicSlot[] | null;
    error: string | null;
    selected: string;
    onSelect: (startsAt: string) => void;
}) {
    return (
        <div>
            <p className="mb-2 text-sm font-medium text-ink-soft">Open times</p>
            {error !== null ? (
                <p className="text-sm text-danger-fg">{error}</p>
            ) : slots === null ? (
                <p className="text-sm text-muted">Loading times…</p>
            ) : slots.length === 0 ? (
                <p className="text-sm text-muted">No open times that day. Try another date.</p>
            ) : (
                <div className="grid grid-cols-3 gap-2">
                    {slots.map((slot) => {
                        const value = slot.starts_at;
                        const active = value === selected;
                        return (
                            <button
                                key={value}
                                type="button"
                                onClick={() => {
                                    onSelect(value);
                                }}
                                className={`rounded-md border px-2 py-2 text-sm font-medium transition ${
                                    active
                                        ? "border-accent bg-accent-weak text-accent-strong"
                                        : "border-line text-ink-soft hover:border-accent-line"
                                }`}
                            >
                                {formatTime(parseTimestamp(value))}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function BookedState({ page, result }: { page: PublicBookingPage; result: PublicBookingResult }) {
    // No connected account id is returned, which a Connect direct-charge Elements confirm needs, so
    // the deposit is collected via a follow-up link rather than inline.
    return (
        <Frame>
            <div className="py-4 text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ok-bg text-2xl text-ok-fg">
                    ✓
                </span>
                <h1 className="mt-4 font-display text-xl font-bold text-ink">You're booked</h1>
                <p className="mt-2 text-sm text-muted">
                    Your appointment with {page.business_name} is confirmed. They'll be in touch
                    with any details.
                </p>
                {result.deposit_client_secret !== null ? (
                    <p className="mt-4 rounded-md bg-accent-weak px-3 py-2 text-sm text-accent-strong">
                        A deposit is required to hold this booking — a secure payment link will
                        follow by email or text.
                    </p>
                ) : null}
            </div>
        </Frame>
    );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
            {label}
            {children}
        </label>
    );
}

function Frame({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
            <div className="w-full max-w-md rounded-xl border border-line bg-surface p-7 shadow-card">
                {children}
            </div>
        </div>
    );
}

function Centered({ children }: { children: React.ReactNode }) {
    return <p className="py-8 text-center text-sm text-muted">{children}</p>;
}
