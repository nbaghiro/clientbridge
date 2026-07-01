import {
    type PublicBookingPage,
    type PublicBookingResult,
    type PublicService,
    type PublicSlot,
    type PublicStaff,
    createPublicBookingClient,
    dateKey,
    formatMoneyWithCurrency,
    formatTime,
    parseTimestamp,
    usePublicBookingForm,
} from "@clientbridge/app-core";
import { type FormEvent, useState } from "react";
import { useParams } from "react-router-dom";

import { CardConfirm } from "../components/CardConfirm";

const booking = createPublicBookingClient(import.meta.env.VITE_API_URL ?? "http://localhost:8701");

const field =
    "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-accent";

export function PublicBooking() {
    const { slug = "" } = useParams<{ slug: string }>();
    const form = usePublicBookingForm(booking, slug);
    const page = form.page;
    const service = form.service;

    if (form.status === "loading") return <Frame>{<Centered>Loading…</Centered>}</Frame>;

    if (form.status === "not-found")
        return (
            <Frame>
                <h1 className="font-display text-xl font-bold text-ink">Booking page not found</h1>
                <p className="mt-2 text-sm text-muted">
                    This link is invalid or the business isn't accepting online bookings right now.
                </p>
            </Frame>
        );

    if (form.status === "error" || page === null)
        return (
            <Frame>
                <h1 className="font-display text-xl font-bold text-ink">Something went wrong</h1>
                <p className="mt-2 text-sm text-muted">Please try again later.</p>
            </Frame>
        );

    if (form.result !== null)
        return <BookedState page={page} result={form.result} service={service} />;

    const submit = (e: FormEvent): void => {
        e.preventDefault();
        form.submit();
    };

    return (
        <Frame>
            <p className="text-sm text-muted">Book an appointment with</p>
            <h1 className="mt-1 font-display text-xl font-bold text-ink">{page.business_name}</h1>

            <form onSubmit={submit} className="mt-6 space-y-5">
                <Labeled label="Service">
                    <select
                        value={form.itemId}
                        onChange={(e) => {
                            form.setItemId(e.target.value);
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
                                value={form.staffId}
                                onChange={(e) => {
                                    form.setStaffId(e.target.value);
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
                                value={form.date}
                                min={dateKey(new Date())}
                                onChange={(e) => {
                                    form.setDate(e.target.value);
                                }}
                                className={field}
                            />
                        </Labeled>
                    </>
                ) : null}

                {form.staffId !== "" && form.itemId !== "" ? (
                    <Slots
                        slots={form.slots}
                        error={form.slotsError}
                        selected={form.startsAt}
                        onSelect={(v) => {
                            form.setStartsAt(v);
                            form.setError(null);
                        }}
                    />
                ) : null}

                {form.startsAt !== "" && service !== null ? (
                    <div className="space-y-3 border-t border-line pt-4">
                        <Labeled label="Your name">
                            <input
                                value={form.name}
                                onChange={(e) => {
                                    form.setName(e.target.value);
                                }}
                                placeholder="Full name"
                                className={field}
                            />
                        </Labeled>
                        <Labeled label="Email">
                            <input
                                value={form.email}
                                onChange={(e) => {
                                    form.setEmail(e.target.value);
                                }}
                                inputMode="email"
                                placeholder="you@example.com"
                                className={field}
                            />
                        </Labeled>
                        <Labeled label="Phone">
                            <input
                                value={form.phone}
                                onChange={(e) => {
                                    form.setPhone(e.target.value);
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
                            disabled={form.busy || !form.canBook}
                            className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                        >
                            {form.busy ? "Booking…" : "Confirm booking"}
                        </button>
                    </div>
                ) : null}

                {form.error !== null ? (
                    <p className="text-sm text-danger-fg">{form.error}</p>
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

function BookedState({
    page,
    result,
    service,
}: {
    page: PublicBookingPage;
    result: PublicBookingResult;
    service: PublicService | null;
}) {
    const [paid, setPaid] = useState(false);

    if (!paid && result.deposit_client_secret !== null && result.stripe_account_id !== null) {
        const amount =
            service !== null
                ? formatMoneyWithCurrency(service.deposit_amount_cents, service.currency)
                : "the deposit";
        return (
            <Frame>
                <h1 className="font-display text-xl font-bold text-ink">Hold your spot</h1>
                <p className="mt-2 text-sm text-muted">
                    Your time with {page.business_name} is reserved. Pay the {amount} deposit to
                    confirm it.
                </p>
                <div className="mt-5">
                    <CardConfirm
                        clientSecret={result.deposit_client_secret}
                        stripeAccount={result.stripe_account_id}
                        amountLabel={amount}
                        onPaid={() => {
                            setPaid(true);
                        }}
                    />
                </div>
            </Frame>
        );
    }

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
                {result.deposit_client_secret !== null && result.stripe_account_id === null ? (
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
