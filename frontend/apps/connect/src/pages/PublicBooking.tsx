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
    serviceOptionLabel,
    strings,
    usePublicBookingForm,
} from "@clientbridge/app-core/public";
import { Button, CardForm, Choice, ItemImage, Notice, Select, TextField } from "@clientbridge/ui";
import { type SubmitEvent, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { PublicFrame } from "../components/PublicFrame";
import { PublicDone, PublicStatus } from "../components/PublicStatus";
import { useEmbedSuccess } from "../embed";
import { config } from "../config";

const booking = createPublicBookingClient(config.apiUrl);

export function PublicBooking() {
    const { slug = "" } = useParams<{ slug: string }>();
    const form = usePublicBookingForm(booking, slug);
    const page = form.page;
    const service = form.service;
    useEmbedSuccess(form.result !== null, "booking");

    if (form.status === "loading") return <PublicStatus kind="loading" />;

    if (form.status === "not-found")
        return (
            <PublicStatus
                kind="notFound"
                title={strings.publicBooking.notFoundTitle}
                body={strings.publicBooking.notFoundBody}
            />
        );

    if (form.status === "error" || page === null) return <PublicStatus kind="error" />;

    if (form.result !== null)
        return <BookedState page={page} result={form.result} service={service} />;

    const submit = (e: SubmitEvent): void => {
        e.preventDefault();
        form.submit();
    };

    return (
        <PublicFrame brand={page.brand}>
            <p className="text-sm text-muted">{strings.publicBooking.bookWith}</p>
            <h1 className="mt-1 font-display text-xl font-bold text-ink">{page.business_name}</h1>
            {page.addons.length > 0 ? (
                <Link
                    to={`/shop/${encodeURIComponent(slug)}`}
                    className="mt-1 inline-block text-sm font-medium text-accent hover:underline"
                >
                    {strings.publicBooking.shopLink}
                </Link>
            ) : null}

            <form onSubmit={submit} className="mt-6 space-y-5">
                <Select
                    label={strings.publicBooking.service}
                    value={form.itemId}
                    options={[
                        { key: "", label: strings.publicBooking.selectService },
                        ...page.services.map((s) => ({ key: s.id, label: serviceOptionLabel(s) })),
                    ]}
                    onChange={form.setItemId}
                />

                {service !== null ? (
                    <>
                        <div className="flex items-center gap-3 rounded-md border border-line p-3">
                            <ItemImage src={service.image_url} name={service.name} size={48} />
                            <p className="text-sm text-muted">
                                {service.description ?? service.name}
                            </p>
                        </div>
                        <Select
                            label={strings.publicBooking.with}
                            value={form.staffId}
                            options={[
                                { key: "", label: strings.publicBooking.selectStaff },
                                ...page.staff.map((st) => ({ key: st.id, label: staffLabel(st) })),
                            ]}
                            onChange={form.setStaffId}
                        />
                        <TextField
                            label={strings.publicBooking.date}
                            type="date"
                            value={form.date}
                            min={dateKey(new Date())}
                            onChange={form.setDate}
                        />
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

                {form.startsAt !== "" && service !== null && page.addons.length > 0 ? (
                    <div className="border-t border-line pt-4">
                        <p className="text-sm font-medium text-ink-soft">
                            {strings.publicBooking.addonsTitle}
                        </p>
                        <p className="mt-0.5 text-xs text-muted">
                            {strings.publicBooking.addonsNote}
                        </p>
                        <ul className="mt-3 space-y-2">
                            {page.addons.map((a) => (
                                <li key={a.id}>
                                    <label className="flex cursor-pointer items-center gap-3 rounded-md border border-line p-2 text-sm">
                                        <input
                                            type="checkbox"
                                            checked={a.id in form.addons}
                                            onChange={() => {
                                                form.toggleAddon(a.id);
                                            }}
                                        />
                                        <ItemImage src={a.image_url} name={a.name} size={36} />
                                        <span className="flex-1 text-ink">{a.name}</span>
                                        <span className="tabular-nums text-muted">
                                            {formatMoneyWithCurrency(a.price_cents, a.currency)}
                                        </span>
                                    </label>
                                </li>
                            ))}
                        </ul>
                        {form.addonsTotalCents > 0 ? (
                            <p className="mt-2 text-xs text-muted">
                                {strings.publicBooking.addonsTotal(
                                    formatMoneyWithCurrency(
                                        form.addonsTotalCents,
                                        service.currency,
                                    ),
                                )}
                            </p>
                        ) : null}
                    </div>
                ) : null}

                {form.startsAt !== "" && service !== null ? (
                    <div className="space-y-3 border-t border-line pt-4">
                        <TextField
                            label={strings.publicBooking.yourName}
                            value={form.name}
                            onChange={form.setName}
                            placeholder={strings.publicBooking.fullNamePlaceholder}
                            autoComplete="name"
                        />
                        <TextField
                            label={strings.publicBooking.email}
                            type="email"
                            value={form.email}
                            onChange={form.setEmail}
                            placeholder={strings.publicBooking.emailPlaceholder}
                            autoComplete="email"
                        />
                        <TextField
                            label={strings.publicBooking.phone}
                            type="tel"
                            value={form.phone}
                            onChange={form.setPhone}
                            placeholder={strings.publicBooking.phonePlaceholder}
                            autoComplete="tel"
                        />
                        <p className="text-xs text-muted">{strings.publicBooking.reachYouNote}</p>
                        {service.deposit_required ? (
                            <Notice tone="info" banner>
                                {strings.publicBooking.depositRequired(
                                    formatMoneyWithCurrency(
                                        service.deposit_amount_cents,
                                        service.currency,
                                    ),
                                )}
                            </Notice>
                        ) : null}

                        <Button submit size="lg" full busy={form.busy} disabled={!form.canBook}>
                            {form.busy
                                ? strings.publicBooking.booking
                                : strings.publicBooking.confirmBooking}
                        </Button>
                    </div>
                ) : null}

                {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
            </form>
        </PublicFrame>
    );
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
                <Notice tone="danger">{error}</Notice>
            ) : slots === null ? (
                <p className="text-sm text-muted">{strings.publicBooking.loadingTimes}</p>
            ) : slots.length === 0 ? (
                <p className="text-sm text-muted">{strings.publicBooking.noOpenTimes}</p>
            ) : (
                <Choice
                    label={strings.publicBooking.openTimes}
                    options={slots.map((slot) => ({
                        key: slot.starts_at,
                        label: formatTime(parseTimestamp(slot.starts_at)),
                    }))}
                    value={selected}
                    onChange={onSelect}
                />
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
            <PublicFrame brand={page.brand}>
                <h1 className="font-display text-xl font-bold text-ink">
                    {strings.publicBooking.holdSpotTitle}
                </h1>
                <p className="mt-2 text-sm text-muted">
                    {strings.publicBooking.holdSpotBody(page.business_name, amount)}
                </p>
                <div className="mt-5">
                    <CardForm
                        clientSecret={result.deposit_client_secret}
                        stripeAccount={result.stripe_account_id}
                        submitLabel={strings.checkout.pay(amount)}
                        busyLabel={strings.common.working}
                        onDone={() => {
                            setPaid(true);
                        }}
                    />
                </div>
            </PublicFrame>
        );
    }

    return (
        <PublicDone
            brand={page.brand}
            title={strings.publicBooking.bookedTitle}
            body={strings.publicBooking.bookedBody(page.business_name)}
        >
            {result.deposit_client_secret !== null && result.stripe_account_id === null ? (
                <Notice tone="info" banner>
                    {strings.publicBooking.depositLinkNote}
                </Notice>
            ) : undefined}
        </PublicDone>
    );
}
