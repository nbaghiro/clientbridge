import {
    BRAND_COLOURS,
    type BrandForm,
    bookingPageUrl,
    PROVINCES,
    logoTarget,
    mediaUrl,
    strings,
    taxSummary,
    useBookingPreview,
    useBrandForm,
    useFileUpload,
    useSetupChecklist,
} from "@clientbridge/app-core";
import {
    Badge,
    Button,
    Checklist,
    CopyField,
    Empty,
    Field,
    Icon,
    LoadFailed,
    Notice,
    Panel,
    Skeleton,
    SwatchPicker,
    TextField,
} from "@clientbridge/ui";
import { type ChangeEvent, useRef } from "react";

import { config } from "../config";
import { api, apiBaseUrl } from "../lib/api";
import { useOpenLink } from "../lib/links";

const o = strings.business.getSetUp;

function BrandMark({
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
    if (logo !== null) {
        return (
            <img
                src={logo}
                alt=""
                style={{ width: size, height: size }}
                className="rounded-lg bg-surface object-contain"
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
    return (
        <figure
            aria-label={o.preview}
            className="overflow-hidden rounded-xl border border-line bg-bg shadow-card"
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
                        {bookingPageUrl(config.bookUrl, brand.slug).replace(/^https?:\/\//, "")}
                    </span>
                </span>
                <span className="w-[42px]" />
            </div>
            <div
                aria-hidden
                className="h-20"
                style={{
                    background: `linear-gradient(135deg, ${brand.colour}, color-mix(in srgb, ${brand.colour} 55%, white))`,
                }}
            />
            <div className="bg-surface px-5 pb-4">
                <div className="-mt-7 flex items-end gap-3">
                    <span className="rounded-xl bg-surface p-1 shadow-card">
                        <BrandMark name={brand.name} colour={brand.colour} logo={logo} size={56} />
                    </span>
                </div>
                <p className="mt-2 truncate font-display text-xl font-bold text-ink">
                    {brand.name}
                </p>
                {brand.tagline !== "" ? (
                    <p className="truncate text-sm text-muted">{brand.tagline}</p>
                ) : null}
                {preview.rating !== null ? (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-soft">
                        <Icon name="star" size={13} />
                        {preview.rating}
                    </p>
                ) : null}
            </div>
            <div className="border-t border-line px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {o.previewServices}
                </p>
                {preview.services.length === 0 ? (
                    <p className="mt-2 text-sm text-muted">{o.previewNoServices}</p>
                ) : (
                    <ul className="mt-2 divide-y divide-line-soft">
                        {preview.services.map((svc) => (
                            <li key={svc.id} className="flex items-center gap-3 py-3">
                                <span
                                    aria-hidden
                                    className="h-10 w-1.5 shrink-0 rounded-full bg-accent"
                                    style={
                                        svc.color === null
                                            ? undefined
                                            : { backgroundColor: svc.color }
                                    }
                                />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-semibold text-ink">
                                        {svc.name}
                                    </p>
                                    <p className="text-xs text-muted">{svc.meta}</p>
                                </div>
                                <span
                                    className="rounded-md px-3 py-1 text-xs font-bold text-on-data"
                                    style={{ backgroundColor: brand.colour }}
                                >
                                    {o.previewBook}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
                <p className="mt-1 text-[11px] text-muted">
                    {o.previewTaxNote(taxSummary(brand.province, "federal_only"))}
                </p>
            </div>
        </figure>
    );
}

function BrandPanel({ brand }: { brand: BrandForm }) {
    const upload = useFileUpload(api, brand.setLogoFileId);
    const input = useRef<HTMLInputElement>(null);
    const logo = brand.logoFileId === "" ? null : mediaUrl(apiBaseUrl, brand.logoFileId);
    const onPick = (e: ChangeEvent<HTMLInputElement>): void => {
        const file = e.target.files?.[0];
        if (file === undefined || brand.businessId === null) return;
        upload.upload(file, logoTarget(brand.businessId), file.type || "image/png", file.size);
        e.target.value = "";
    };
    return (
        <Panel title={o.brandTitle} subtitle={o.brandBody}>
            <div className="space-y-4">
                <div className="flex items-center gap-3">
                    {logo !== null ? (
                        <BrandMark name={brand.name} colour={brand.colour} logo={logo} size={48} />
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
                        busy={upload.busy}
                        onPress={() => {
                            input.current?.click();
                        }}
                    >
                        {logo !== null ? strings.files.replaceLogo : strings.files.uploadLogo}
                    </Button>
                    <input
                        ref={input}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        onChange={onPick}
                        className="hidden"
                    />
                </div>
                {upload.error !== null ? <Notice tone="danger">{upload.error}</Notice> : null}
                <Field label={o.colour}>
                    <SwatchPicker
                        label={o.colour}
                        colours={BRAND_COLOURS}
                        value={brand.colour}
                        onChange={brand.setColour}
                    />
                </Field>
                <TextField
                    label={o.tagline}
                    value={brand.tagline}
                    onChange={brand.setTagline}
                    placeholder={o.taglinePlaceholder}
                    maxLength={60}
                    optional
                />
                <BookingPreview brand={brand} logo={logo} />
                {brand.error !== null ? <Notice tone="danger">{brand.error}</Notice> : null}
                <div className="flex items-center gap-3">
                    <Button onPress={brand.submit} busy={brand.busy}>
                        {brand.busy ? o.saving : o.save}
                    </Button>
                    {brand.saved ? <Notice tone="success">{o.saved}</Notice> : null}
                </div>
            </div>
        </Panel>
    );
}

/** The Setup home: what is left before bookings and payouts, the booking link, and the brand. */
export function GetSetUp() {
    const brand = useBrandForm(api);
    const province = PROVINCES.find((p) => p.code === brand.province)?.name ?? "";
    const list = useSetupChecklist(api, config.bookUrl, province);
    const open = useOpenLink();
    const brandRef = useRef<HTMLDivElement>(null);
    const pct = Math.round((list.done / list.total) * 100);

    if (list.load.state === "loading") {
        return (
            <div className="mt-6">
                <Panel flush>
                    <Skeleton variant="row" count={7} label={o.loading} />
                </Panel>
            </div>
        );
    }
    if (list.load.state === "error") {
        return (
            <div className="mt-6">
                <Panel flush>
                    <LoadFailed
                        message={o.loadError}
                        onRetry={list.load.retry}
                        retrying={list.load.retrying}
                    />
                </Panel>
            </div>
        );
    }
    return (
        <div>
            <div className="flex items-start justify-between gap-4">
                <p className="mt-1 text-sm text-muted">{o.body}</p>
                {list.hidden ? null : (
                    <Button
                        variant="quiet"
                        size="sm"
                        onPress={() => {
                            list.setHidden(true);
                        }}
                    >
                        {o.hide}
                    </Button>
                )}
            </div>
            {list.hideError !== null ? <Notice tone="danger">{list.hideError}</Notice> : null}
            {list.hidden ? (
                <div className="mt-6">
                    <Panel flush>
                        <Empty
                            icon="checkCircle"
                            message={o.hiddenTitle}
                            body={o.hiddenBody(list.total - list.done)}
                            actions={
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onPress={() => {
                                        list.setHidden(false);
                                    }}
                                >
                                    {o.showList}
                                </Button>
                            }
                        />
                    </Panel>
                </div>
            ) : (
                <div className="mt-5 flex items-center gap-3">
                    <div
                        className="h-2 flex-1 overflow-hidden rounded-full bg-surface2"
                        role="progressbar"
                        aria-valuenow={pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={o.progress(list.done, list.total)}
                    >
                        <div
                            className="h-full rounded-full bg-accent transition-all"
                            style={{ width: `${String(pct)}%` }}
                        />
                    </div>
                    <span className="text-sm font-medium text-ink-soft">
                        {o.progress(list.done, list.total)}
                    </span>
                </div>
            )}

            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
                {list.hidden ? null : (
                    <div className="self-start">
                        <Panel flush>
                            <div className="px-4">
                                <Checklist
                                    label={o.title}
                                    items={list.tasks.map((t) => ({
                                        key: t.key,
                                        label: t.label,
                                        hint: t.hint,
                                        done: t.done,
                                        attention: t.attention,
                                        action: {
                                            label: t.action,
                                            onPress: () => {
                                                if (t.key === "brand")
                                                    brandRef.current?.scrollIntoView({
                                                        behavior: "smooth",
                                                        block: "start",
                                                    });
                                                else open(t.target);
                                            },
                                        },
                                    }))}
                                />
                            </div>
                        </Panel>
                    </div>
                )}
                <div className="space-y-6">
                    <Panel
                        title={o.shareTitle}
                        subtitle={list.live ? o.shareBody : o.notLive}
                        actions={list.live ? <Badge label={o.live} intent="success" /> : null}
                    >
                        <CopyField
                            label={o.shareTitle}
                            value={list.bookingUrl}
                            copyLabel={o.copyLink}
                            copiedLabel={o.copied}
                        />
                    </Panel>
                    <div ref={brandRef} className="scroll-mt-6">
                        <BrandPanel brand={brand} />
                    </div>
                </div>
            </div>
        </div>
    );
}
