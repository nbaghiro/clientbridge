import {
    type PublicBookingPage,
    type PublicBookingResult,
    type PublicBrand,
    type PublicService,
    type PublicSlot,
    type PublicStaff,
    createPublicBookingClient,
    dateKey,
    formatMoneyWithCurrency,
    formatTime,
    parseTimestamp,
    strings,
    usePublicBookingForm,
} from "@clientbridge/app-core/public";
import { type FormEvent, useState } from "react";
import { useParams } from "react-router-dom";

import { CardConfirm } from "../components/CardConfirm";
import { PublicCentered, PublicFrame } from "../components/PublicFrame";

const booking = createPublicBookingClient(import.meta.env.VITE_API_URL ?? "http://localhost:8701");

const field =
    "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-accent";

export function PublicBooking() {
    const { slug = "" } = useParams<{ slug: string }>();
    const form = usePublicBookingForm(booking, slug);
    const page = form.page;
    const service = form.service;

    if (form.status === "loading")
        return <Frame>{<PublicCentered>{strings.common.loading}</PublicCentered>}</Frame>;

    if (form.status === "not-found")
        return (
            <Frame>
                <h1 className="font-display text-xl font-bold text-ink">
                    {strings.publicBooking.notFoundTitle}
                </h1>
                <p className="mt-2 text-sm text-muted">{strings.publicBooking.notFoundBody}</p>
            </Frame>
        );

    if (form.status === "error" || page === null)
        return (
            <Frame>
                <h1 className="font-display text-xl font-bold text-ink">
                    {strings.common.somethingWrong}
                </h1>
                <p className="mt-2 text-sm text-muted">{strings.common.tryAgainLater}</p>
            </Frame>
        );

    if (form.result !== null)
        return <BookedState page={page} result={form.result} service={service} />;

    const submit = (e: FormEvent): void => {
        e.preventDefault();
        form.submit();
    };

    return (
        <Frame brand={page.brand}>
            <p className="text-sm text-muted">{strings.publicBooking.bookWith}</p>
            <h1 className="mt-1 font-display text-xl font-bold text-ink">{page.business_name}</h1>

            <form onSubmit={submit} className="mt-6 space-y-5">
                <Labeled label={strings.publicBooking.service}>
                    <select
                        value={form.itemId}
                        onChange={(e) => {
                            form.setItemId(e.target.value);
                        }}
                        className={field}
                    >
                        <option value="">{strings.publicBooking.selectService}</option>
                        {page.services.map((s) => (
                            <option key={s.id} value={s.id}>
                                {serviceLabel(s)}
                            </option>
                        ))}
                    </select>
                </Labeled>

                {service !== null ? (
                    <>
                        <Labeled label={strings.publicBooking.with}>
                            <select
                                value={form.staffId}
                                onChange={(e) => {
                                    form.setStaffId(e.target.value);
                                }}
                                className={field}
                            >
                                <option value="">{strings.publicBooking.selectStaff}</option>
                                {page.staff.map((st) => (
                                    <option key={st.id} value={st.id}>
                                        {staffLabel(st)}
                                    </option>
                                ))}
                            </select>
                        </Labeled>

                        <Labeled label={strings.publicBooking.date}>
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
                        <Labeled label={strings.publicBooking.yourName}>
                            <input
                                value={form.name}
                                onChange={(e) => {
                                    form.setName(e.target.value);
                                }}
                                placeholder={strings.publicBooking.fullNamePlaceholder}
                                className={field}
                            />
                        </Labeled>
                        <Labeled label={strings.publicBooking.email}>
                            <input
                                value={form.email}
                                onChange={(e) => {
                                    form.setEmail(e.target.value);
                                }}
                                inputMode="email"
                                placeholder={strings.publicBooking.emailPlaceholder}
                                className={field}
                            />
                        </Labeled>
                        <Labeled label={strings.publicBooking.phone}>
                            <input
                                value={form.phone}
                                onChange={(e) => {
                                    form.setPhone(e.target.value);
                                }}
                                inputMode="tel"
                                placeholder={strings.publicBooking.phonePlaceholder}
                                className={field}
                            />
                        </Labeled>
                        <p className="text-xs text-muted">{strings.publicBooking.reachYouNote}</p>
                        {service.deposit_required ? (
                            <p className="rounded-md bg-accent-weak px-3 py-2 text-xs text-accent-strong">
                                {strings.publicBooking.depositRequired(
                                    formatMoneyWithCurrency(
                                        service.deposit_amount_cents,
                                        service.currency,
                                    ),
                                )}
                            </p>
                        ) : null}

                        <button
                            type="submit"
                            disabled={form.busy || !form.canBook}
                            className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                        >
                            {form.busy
                                ? strings.publicBooking.booking
                                : strings.publicBooking.confirmBooking}
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
    const mins =
        s.duration_min !== null ? strings.publicBooking.durationSuffix(s.duration_min) : "";
    return `${s.name} — ${price}${mins}`;
}

function staffLabel(st: PublicStaff): string {
    return st.name ?? st.title ?? strings.publicBooking.anyAvailable;
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
            <p className="mb-2 text-sm font-medium text-ink-soft">
                {strings.publicBooking.openTimes}
            </p>
            {error !== null ? (
                <p className="text-sm text-danger-fg">{error}</p>
            ) : slots === null ? (
                <p className="text-sm text-muted">{strings.publicBooking.loadingTimes}</p>
            ) : slots.length === 0 ? (
                <p className="text-sm text-muted">{strings.publicBooking.noOpenTimes}</p>
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
                : strings.publicBooking.theDeposit;
        return (
            <Frame brand={page.brand}>
                <h1 className="font-display text-xl font-bold text-ink">
                    {strings.publicBooking.holdSpotTitle}
                </h1>
                <p className="mt-2 text-sm text-muted">
                    {strings.publicBooking.holdSpotBody(page.business_name, amount)}
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
        <Frame brand={page.brand}>
            <div className="py-4 text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ok-bg text-2xl text-ok-fg">
                    ✓
                </span>
                <h1 className="mt-4 font-display text-xl font-bold text-ink">
                    {strings.publicBooking.bookedTitle}
                </h1>
                <p className="mt-2 text-sm text-muted">
                    {strings.publicBooking.bookedBody(page.business_name)}
                </p>
                {result.deposit_client_secret !== null && result.stripe_account_id === null ? (
                    <p className="mt-4 rounded-md bg-accent-weak px-3 py-2 text-sm text-accent-strong">
                        {strings.publicBooking.depositLinkNote}
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

function Frame({
    brand = null,
    children,
}: {
    brand?: PublicBrand | null;
    children: React.ReactNode;
}) {
    return <PublicFrame brand={brand}>{children}</PublicFrame>;
}
