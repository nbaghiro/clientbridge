import {
    BRAND_COLOURS,
    BUSINESS_ADDRESS_FIELDS,
    BUSINESS_TEXT_FIELDS,
    PUBLIC_PROFILE_FIELDS,
    type BrandForm,
    bareUrl,
    bookingPageUrl,
    brandColourName,
    pageDomain,
    strings,
    timeZoneOptions,
    useBookingPreview,
    useBrandForm,
    useBusinessForm,
} from "@clientbridge/app-core";
import { readableInk } from "@clientbridge/tokens";
import {
    Button,
    Checkbox,
    Choice,
    FactList,
    Field,
    Icon,
    Loading,
    Notice,
    PageHeader,
    Panel,
    Select,
    SwatchPicker,
    TextField,
} from "@clientbridge/ui";
import { type CSSProperties, type ChangeEvent, useRef, useState } from "react";

import { config } from "../config";
import { api, apiBaseUrl } from "../lib/api";
import { useLeaveGuard } from "../lib/links";
import { isSvg, pngFromSvg } from "../lib/svgLogo";

const o = strings.business.getSetUp;
const l = strings.business.legalAddress;

export function Business() {
    const brand = useBrandForm(api);
    const form = useBusinessForm(api);
    useLeaveGuard(brand.dirty || brand.uploading || form.dirty);
    return (
        <div className="space-y-6">
            <PageHeader
                title={strings.navigation.setupSections.business}
                subtitle={strings.business.subtitle}
            />
            <ProfilePanel form={form} />
            <BrandPanel brand={brand} />
        </div>
    );
}

function ProfilePanel({ form }: { form: ReturnType<typeof useBusinessForm> }) {
    const fields = form.fields;
    const save = (): void => {
        form.submit();
    };

    if (fields === null)
        return (
            <Panel>
                <Loading inline />
            </Panel>
        );
    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                save();
            }}
        >
            <Panel
                title={strings.business.profileTitle}
                footer={
                    <>
                        {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
                        {form.saved ? <Notice tone="success">{strings.common.saved}</Notice> : null}
                        {form.dirty ? (
                            <Notice tone="info">{strings.business.unsaved}</Notice>
                        ) : null}
                        <Button submit busy={form.busy}>
                            {form.busy ? strings.common.saving : strings.business.saveDetails}
                        </Button>
                    </>
                }
            >
                <div className="grid gap-4 sm:grid-cols-2">
                    {BUSINESS_TEXT_FIELDS.map((f) => (
                        <TextField
                            key={f.key}
                            label={f.label}
                            value={fields[f.key]}
                            onChange={(v) => {
                                form.set(f.key, v);
                            }}
                            placeholder={f.placeholder}
                            maxLength={f.maxLength}
                            error={form.fieldErrors[f.key]}
                        />
                    ))}
                </div>
                <TextField
                    label={strings.business.onboarding.webAddress}
                    value={fields.slug}
                    onChange={(v) => {
                        form.set("slug", v);
                    }}
                    suffix={strings.business.onboarding.slugSuffix(pageDomain(config.pageUrl))}
                />
                {form.slugChanged ? (
                    <Notice tone="info">{strings.business.slugChanged}</Notice>
                ) : null}
                <Select
                    label={strings.business.timezoneLabel}
                    value={fields.timezone}
                    options={timeZoneOptions(fields.timezone)}
                    onChange={(v) => {
                        form.set("timezone", v);
                    }}
                />
                <SectionHead title={l.title} hint={l.hint} />
                <div className="grid gap-4 sm:grid-cols-2">
                    {BUSINESS_ADDRESS_FIELDS.map((f) => (
                        <TextField
                            key={f.key}
                            label={f.label}
                            type={f.type}
                            autoComplete={f.autoComplete}
                            value={fields[f.key]}
                            onChange={(v) => {
                                form.set(f.key, v);
                            }}
                            placeholder={f.placeholder}
                            error={form.fieldErrors[f.key]}
                        />
                    ))}
                    <Field
                        label={l.province}
                        hint={form.provinceLocked ? strings.taxes.provinceLocked : l.provinceHint}
                    >
                        <p className="py-2 text-sm text-ink">{form.province}</p>
                    </Field>
                </div>
            </Panel>
        </form>
    );
}

function SectionHead({ title, hint }: { title: string; hint: string }) {
    return (
        <div className="border-t border-line-soft pt-4">
            <h4 className="text-sm font-semibold text-ink">{title}</h4>
            <p className="mt-0.5 text-sm text-muted">{hint}</p>
        </div>
    );
}

function LogoMark({
    name,
    colour,
    logo,
    size,
}: {
    name: string;
    colour: string;
    logo: string | null;
    size: number;
}) {
    const [failed, setFailed] = useState<string | null>(null);
    if (logo !== null && logo !== failed) {
        return (
            <img
                src={logo}
                alt=""
                style={{ width: size, height: size }}
                className="rounded-lg bg-surface object-contain"
                onError={() => {
                    setFailed(logo);
                }}
            />
        );
    }
    return (
        <span
            aria-hidden
            style={{ backgroundColor: colour, width: size, height: size, fontSize: size * 0.36 }}
            className="flex shrink-0 items-center justify-center rounded-lg font-display font-bold text-on-data"
        >
            {(name || "B").charAt(0).toUpperCase()}
        </span>
    );
}

/** The client's booking page in a browser frame, drawn live from the brand being edited. */
function BookingPreview({ brand, logo }: { brand: BrandForm; logo: string | null }) {
    const preview = useBookingPreview(4);
    const b = strings.publicBooking;
    const ink = readableInk(brand.colour);
    return (
        <figure
            aria-label={o.preview}
            style={{ "--accent": brand.colour } as CSSProperties}
            className="overflow-hidden rounded-xl border border-line bg-bg"
        >
            <div className="flex items-center gap-3 border-b border-line bg-surface px-3 py-2">
                <span aria-hidden className="flex gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-line" />
                    <span className="h-2.5 w-2.5 rounded-full bg-line" />
                    <span className="h-2.5 w-2.5 rounded-full bg-line" />
                </span>
                <span className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md bg-bg px-3 py-1 text-muted">
                    <Icon name="lock" size={11} />
                    <span className="truncate font-mono text-[11px]">
                        {bareUrl(bookingPageUrl(config.bookUrl, brand.slug))}
                    </span>
                </span>
                <span className="w-[42px]" />
            </div>
            <header
                style={{ backgroundColor: brand.colour, color: ink }}
                className="flex items-center gap-3 px-4 py-3"
            >
                <span className="rounded-lg ring-2 ring-surface">
                    <LogoMark name={brand.name} colour={brand.colour} logo={logo} size={36} />
                </span>
                <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-base font-bold">{brand.name}</p>
                    {brand.tagline !== "" ? (
                        <p className="truncate text-xs opacity-80">{brand.tagline}</p>
                    ) : null}
                </div>
            </header>
            <div className="px-4 py-5">
                <p className="font-display text-lg font-bold text-ink">{b.chooseService}</p>
                <p className="mt-1 text-xs text-muted">{b.chooseServiceHint}</p>
                <div className="mt-4">
                    {preview.services.length === 0 ? (
                        <p className="text-sm text-muted">{o.previewNoServices}</p>
                    ) : (
                        <Choice
                            layout="tiles"
                            label={b.chooseService}
                            columns={2}
                            value={preview.selected}
                            onChange={preview.select}
                            options={preview.services}
                        />
                    )}
                </div>
                {preview.facts.length > 0 ? (
                    <div className="mt-4 rounded-lg border border-line bg-surface p-4">
                        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
                            {b.summary}
                        </p>
                        <FactList facts={preview.facts} label={b.summary} />
                    </div>
                ) : null}
            </div>
            <p className="pb-4 text-center text-[11px] text-muted">
                {strings.publicLanding.poweredBy}
            </p>
        </figure>
    );
}

/** Logo, cover, colour and the public business page, with a live preview of the booking page. */
function BrandPanel({ brand }: { brand: BrandForm }) {
    const input = useRef<HTMLInputElement>(null);
    const coverInput = useRef<HTMLInputElement>(null);

    const logo = brand.logo.src(apiBaseUrl);
    const cover = brand.cover.src(apiBaseUrl);
    const onPick = (e: ChangeEvent<HTMLInputElement>): void => {
        const file = e.target.files?.[0];
        if (file === undefined) return;
        brand.logo.upload(isSvg(file) ? pngFromSvg(file) : file);
        e.target.value = "";
    };
    return (
        <div
            id="brand"
            className="grid scroll-mt-6 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]"
        >
            <Panel
                title={o.brandTitle}
                subtitle={o.brandBody}
                footer={
                    <>
                        {brand.error !== null ? <Notice tone="danger">{brand.error}</Notice> : null}
                        {brand.saved ? <Notice tone="success">{o.saved}</Notice> : null}
                        {brand.dirty ? <Notice tone="info">{o.unsaved}</Notice> : null}
                        <Button onPress={brand.submit} busy={brand.busy} disabled={brand.uploading}>
                            {brand.busy ? o.saving : o.save}
                        </Button>
                    </>
                }
            >
                <div className="space-y-4">
                    <div className="flex items-center gap-3">
                        {logo !== null ? (
                            <LogoMark
                                name={brand.name}
                                colour={brand.colour}
                                logo={logo}
                                size={48}
                            />
                        ) : (
                            <span className="flex h-12 w-12 items-center justify-center rounded-lg border-2 border-dashed border-line text-muted">
                                <Icon name="image" size={20} />
                            </span>
                        )}
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-ink-soft">{o.logo}</p>
                            <p className="text-xs text-muted">{o.logoHint}</p>
                        </div>
                        <Button
                            size="sm"
                            variant="outline"
                            icon="upload"
                            busy={brand.logo.busy}
                            disabled={!brand.ready}
                            onPress={() => {
                                input.current?.click();
                            }}
                        >
                            {logo !== null ? strings.files.replaceLogo : strings.files.uploadLogo}
                        </Button>
                        {logo !== null ? (
                            <Button size="sm" variant="link" onPress={brand.logo.remove}>
                                {strings.files.removeLogo}
                            </Button>
                        ) : null}
                        <input
                            ref={input}
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/svg+xml"
                            onChange={onPick}
                            className="hidden"
                        />
                    </div>
                    {brand.logo.error !== null ? (
                        <Notice tone="danger">{brand.logo.error}</Notice>
                    ) : null}
                    <Field label={o.coverPhoto} hint={o.coverHint}>
                        <div
                            className="aspect-[3/1] overflow-hidden rounded-lg"
                            style={{ backgroundColor: brand.colour }}
                        >
                            {cover !== null ? (
                                <img src={cover} alt="" className="h-full w-full object-cover" />
                            ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            <Button
                                size="sm"
                                variant="outline"
                                busy={brand.cover.busy}
                                disabled={!brand.ready}
                                onPress={() => {
                                    coverInput.current?.click();
                                }}
                            >
                                {cover !== null ? o.replaceCover : o.uploadCover}
                            </Button>
                            {cover !== null ? (
                                <Button size="sm" variant="link" onPress={brand.cover.remove}>
                                    {o.removeCover}
                                </Button>
                            ) : null}
                        </div>
                        <input
                            ref={coverInput}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            hidden
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) brand.cover.upload(file);
                                event.target.value = "";
                            }}
                        />
                        {brand.cover.error !== null ? (
                            <Notice tone="danger">{brand.cover.error}</Notice>
                        ) : null}
                    </Field>
                    <Field label={o.colour}>
                        <SwatchPicker
                            label={o.colour}
                            colours={BRAND_COLOURS}
                            colourLabel={brandColourName}
                            value={brand.colour}
                            onChange={brand.setColour}
                        />
                    </Field>
                    <TextField
                        label={o.tagline}
                        value={brand.tagline}
                        onChange={brand.setTagline}
                        placeholder={o.taglinePlaceholder}
                        maxLength={brand.taglineMax}
                        error={brand.fieldErrors.tagline}
                        optional
                    />
                    <SectionHead title={o.profileTitle} hint={o.profileHint} />
                    <div className="grid gap-4 sm:grid-cols-2">
                        {PUBLIC_PROFILE_FIELDS.map((field) => (
                            <TextField
                                key={field.key}
                                multiline={field.multiline}
                                className={field.multiline ? "sm:col-span-2" : undefined}
                                label={field.label}
                                maxLength={field.maxLength}
                                error={brand.fieldErrors[field.key]}
                                value={brand.profile[field.key]}
                                onChange={(value) => {
                                    brand.setProfile(field.key, value);
                                }}
                            />
                        ))}
                    </div>
                    {brand.publicTeam.length > 0 ? (
                        <Field label={o.publicTeam} hint={o.publicTeamHint}>
                            <ul className="divide-y divide-line-soft rounded-md border border-line">
                                {brand.publicTeam.map((person) => (
                                    <li key={person.id} className="px-3 py-2.5">
                                        <Checkbox
                                            label={person.name}
                                            value={person.selected}
                                            onChange={(selected) => {
                                                brand.setPublicTeam(person.id, selected);
                                            }}
                                        />
                                    </li>
                                ))}
                            </ul>
                        </Field>
                    ) : null}
                </div>
            </Panel>
            <Panel title={o.preview} className="xl:sticky xl:top-6">
                <BookingPreview brand={brand} logo={logo} />
            </Panel>
        </div>
    );
}
