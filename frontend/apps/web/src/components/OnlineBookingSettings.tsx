import {
    type OnlineBookingSettings as Settings,
    mediaUrl,
    strings,
    useAddonOffers,
    useBookingPolicy,
    useOnlineBookingSettings,
} from "@clientbridge/app-core";
import {
    Avatar,
    Badge,
    Button,
    Choice,
    CopyField,
    Empty,
    Icon,
    ItemImage,
    KeyValueList,
    LoadFailed,
    Notice,
    Panel,
    PayCode,
    Select,
    Skeleton,
    Stat,
    Toggle,
} from "@clientbridge/ui";
import { INTENT_COLORS, cssVar } from "@clientbridge/tokens";
import { useRef } from "react";

import { config } from "../config";
import { api } from "../lib/api";

const s = strings.onlineBooking;
const p = s.policy;
const a = s.addons;

function PageLoad({
    state,
    retry,
    retrying,
    error,
}: {
    state: string;
    retry: () => void;
    retrying: boolean;
    error: string;
}) {
    if (state === "loading") {
        return (
            <Panel flush>
                <div className="p-5">
                    <Skeleton variant="row" count={4} label={s.loading} />
                </div>
            </Panel>
        );
    }
    if (state === "error")
        return <LoadFailed variant="card" message={error} onRetry={retry} retrying={retrying} />;
    return null;
}

// Saves the QR code as an SVG file.
function downloadQr(container: HTMLElement | null, name: string): void {
    const svg = container?.querySelector("svg:not([aria-hidden])");
    if (!svg) return;
    const url = URL.createObjectURL(
        new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name}-booking-qr.svg`;
    link.click();
    URL.revokeObjectURL(url);
}

/** The booking page settings: share, what and who is bookable, the rules, embed, with a live preview. */
export function BookingPageSettings() {
    const st = useOnlineBookingSettings(api, config.bookUrl, {
        copy: (text) => {
            navigator.clipboard.writeText(text).catch(() => undefined);
        },
        open: (url) => {
            window.open(url, "_blank", "noopener");
        },
    });
    const qr = useRef<HTMLDivElement>(null);
    if (!st.ready) {
        return (
            <PageLoad
                state={st.load.state}
                retry={st.load.retry}
                retrying={st.load.retrying}
                error={s.loadError}
            />
        );
    }
    const policy = st.policy;
    return (
        <div>
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="min-w-0 space-y-6">
                    {st.bookableCount === 0 ? (
                        <Notice
                            tone="info"
                            banner
                        >{`${s.noneBookable}. ${s.noneBookableBody}`}</Notice>
                    ) : null}
                    <Panel
                        title={s.share}
                        subtitle={s.shareHint}
                        actions={
                            <Button
                                variant="outline"
                                size="sm"
                                icon="external"
                                onPress={st.openPage}
                            >
                                {s.open}
                            </Button>
                        }
                    >
                        <CopyField
                            label={s.link}
                            value={st.linkLabel}
                            copied={st.copied === "link"}
                            onCopy={() => {
                                st.copy("link", st.link);
                            }}
                            copyLabel={s.copy}
                            copiedLabel={s.copied}
                        />
                        <div
                            ref={qr}
                            className="flex items-center gap-4 rounded-md border border-line bg-bg p-3"
                        >
                            <PayCode value={st.link} size={72} label={s.qrLabel} />
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-ink">{s.frontDesk}</p>
                                <p className="text-xs text-muted">{s.frontDeskHint}</p>
                            </div>
                            <Button
                                size="sm"
                                variant="outline"
                                icon="upload"
                                onPress={() => {
                                    downloadQr(
                                        qr.current,
                                        st.businessName.toLowerCase().replace(/\W+/g, "-"),
                                    );
                                }}
                            >
                                {s.qrDownload}
                            </Button>
                        </div>
                    </Panel>
                    <Panel title={s.services} subtitle={s.servicesHint}>
                        <ul className="divide-y divide-line-soft">
                            {st.services.map((x) => (
                                <li key={x.id} className="flex items-center gap-3 py-2.5">
                                    <span
                                        aria-hidden
                                        className="h-8 w-1 shrink-0 rounded-full bg-accent"
                                        style={
                                            x.color !== null
                                                ? { backgroundColor: x.color }
                                                : undefined
                                        }
                                    />
                                    <div className="min-w-0 flex-1">
                                        <Toggle
                                            label={x.name}
                                            hint={x.meta}
                                            value={x.bookable}
                                            onChange={() => {
                                                st.toggleService(x.id);
                                            }}
                                        />
                                    </div>
                                    <span className="shrink-0 text-xs text-muted">{x.deposit}</span>
                                </li>
                            ))}
                        </ul>
                    </Panel>
                    <Panel title={s.team} subtitle={s.teamHint}>
                        <ul className="divide-y divide-line-soft">
                            {st.staff.map((x) => (
                                <li key={x.id} className="flex items-center gap-3 py-2.5">
                                    <Avatar name={x.name} size="sm" color={x.color} />
                                    <div className="min-w-0 flex-1">
                                        <Toggle
                                            label={x.name}
                                            hint={x.title}
                                            value={x.online}
                                            onChange={() => {
                                                st.toggleStaff(x.id);
                                            }}
                                        />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </Panel>
                    {policy !== null ? (
                        <Panel title={s.rules}>
                            <div className="grid gap-4 sm:grid-cols-3">
                                <Select
                                    label={s.leadTime}
                                    hint={s.leadTimeHint}
                                    value={String(policy.lead_hours)}
                                    options={st.leadOptions}
                                    onChange={(k) => {
                                        st.setPolicy("lead_hours", Number(k));
                                    }}
                                />
                                <Select
                                    label={s.advance}
                                    value={String(policy.horizon_days)}
                                    options={st.advanceOptions}
                                    onChange={(k) => {
                                        st.setPolicy("horizon_days", Number(k));
                                    }}
                                />
                                <Select
                                    label={s.step}
                                    value={String(policy.step_min ?? 0)}
                                    options={st.stepOptions}
                                    onChange={(k) => {
                                        st.setPolicy(
                                            "step_min",
                                            Number(k) === 0 ? null : Number(k),
                                        );
                                    }}
                                />
                            </div>
                            <div>
                                <p className="mb-1.5 text-sm font-medium text-ink-soft">
                                    {s.newClients}
                                </p>
                                <Choice
                                    layout="segmented"
                                    label={s.newClients}
                                    value={policy.approve_new_clients ? "approve" : "allow"}
                                    options={[
                                        { key: "allow", label: s.newClientsAllow },
                                        { key: "approve", label: s.newClientsApprove },
                                    ]}
                                    onChange={(k) => {
                                        st.setPolicy("approve_new_clients", k === "approve");
                                    }}
                                />
                            </div>
                        </Panel>
                    ) : null}
                    <Panel title={s.embed}>
                        <CopyField
                            label={s.embedCode}
                            value={st.embed}
                            variant="snippet"
                            hint={s.embedHint}
                            copied={st.copied === "embed"}
                            onCopy={() => {
                                st.copy("embed", st.embed);
                            }}
                            copyLabel={s.copy}
                            copiedLabel={s.copied}
                        />
                    </Panel>
                </div>
                <aside className="space-y-6 xl:sticky xl:top-8 xl:self-start">
                    <Panel title={s.preview} subtitle={s.previewHint}>
                        <Preview st={st} />
                    </Panel>
                    <Panel title={s.stats}>
                        <KeyValueList
                            rows={st.stats.map((x) => ({ label: x.label, value: x.value }))}
                        />
                    </Panel>
                </aside>
            </div>
            <SaveBar
                dirty={st.dirty}
                justSaved={st.justSaved}
                error={st.error}
                busy={st.busy}
                onSave={st.save}
                onDiscard={st.discard}
            />
        </div>
    );
}

function Preview({ st }: { st: Settings }) {
    return (
        <div className="overflow-hidden rounded-lg border border-line bg-bg">
            <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2">
                <Avatar
                    name={st.businessName}
                    size="sm"
                    src={
                        st.businessAvatarFileId
                            ? mediaUrl(config.apiUrl, st.businessAvatarFileId)
                            : null
                    }
                />
                <span className="truncate text-xs font-semibold text-ink">{st.businessName}</span>
            </div>
            <div className="space-y-1.5 p-3">
                {st.previewServices.length === 0 ? (
                    <p className="rounded-md bg-surface p-3 text-center text-xs text-muted">
                        {s.previewEmpty}
                    </p>
                ) : (
                    <>
                        {st.previewServices.map((x) => (
                            <div
                                key={x.id}
                                className="flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-2"
                            >
                                <span
                                    className="h-6 w-1 rounded-full bg-accent"
                                    style={
                                        x.color !== null ? { backgroundColor: x.color } : undefined
                                    }
                                />
                                <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
                                    {x.name}
                                </span>
                                <span className="text-xs text-muted">{x.priceLabel}</span>
                            </div>
                        ))}
                        {st.previewMore > 0 ? (
                            <p className="px-1 pt-0.5 text-xs text-muted">
                                {s.previewMore(st.previewMore)}
                            </p>
                        ) : null}
                    </>
                )}
            </div>
        </div>
    );
}

function SaveBar({
    dirty,
    justSaved,
    error,
    busy,
    onSave,
    onDiscard,
}: {
    dirty: boolean;
    justSaved: boolean;
    error: string | null;
    busy: boolean;
    onSave: () => void;
    onDiscard?: () => void;
}) {
    if (!dirty && !justSaved && error === null) return null;
    return (
        <div className="sticky bottom-0 z-10 mt-8 border-t border-line bg-surface/95 py-3 backdrop-blur">
            <div className="flex items-center justify-between gap-4">
                {error !== null ? (
                    <Notice tone="danger">{error}</Notice>
                ) : dirty ? (
                    <span className="flex items-center gap-2 text-sm text-ink-soft">
                        <span className="h-2 w-2 rounded-full bg-warn" />
                        {s.unsaved}
                    </span>
                ) : (
                    <span className="flex items-center gap-2 text-sm text-ok-fg">
                        <Icon name="check" size={15} />
                        {s.saved}
                    </span>
                )}
                {dirty ? (
                    <div className="flex gap-2">
                        {onDiscard ? (
                            <Button variant="quiet" onPress={onDiscard}>
                                {s.discard}
                            </Button>
                        ) : null}
                        <Button onPress={onSave} busy={busy}>
                            {busy ? s.saving : s.save}
                        </Button>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

/** Which products clients can add while booking, with which services, and how often they're added. */
export function AddonOffers() {
    const o = useAddonOffers(api);
    if (o.load.state === "loading" || o.load.state === "error") {
        return (
            <PageLoad
                state={o.load.state}
                retry={o.load.retry}
                retrying={o.load.retrying}
                error={s.loadError}
            />
        );
    }
    return (
        <div className="space-y-6">
            <p className="text-sm text-muted">{a.subtitle}</p>
            <div className="grid gap-4 sm:grid-cols-3">
                <Stat label={a.revenue} value={o.revenue} />
                <Stat label={a.offered} value={String(o.offered.length)} />
                <Stat label={a.notOffered} value={String(o.notOffered.length)} />
            </div>
            {o.error !== null ? <Notice tone="danger">{o.error}</Notice> : null}
            <Panel flush>
                {o.offers.length === 0 ? (
                    <Empty icon="bag" message={a.emptyTitle} body={a.emptyBody} />
                ) : null}
                <ul className="divide-y divide-line-soft">
                    {o.offers.map((x) => {
                        const open = o.openId === x.id;
                        return (
                            <li key={x.id} className="px-4 py-3.5">
                                <div className="flex items-center gap-3">
                                    <ItemImage
                                        src={
                                            x.imageFileId !== null
                                                ? mediaUrl(config.apiUrl, x.imageFileId)
                                                : null
                                        }
                                        name={x.name}
                                        color={x.color}
                                        size={44}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <p className="truncate text-sm font-semibold text-ink">
                                                {x.name}
                                            </p>
                                            <span className="text-sm text-muted">{x.price}</span>
                                        </div>
                                        <p className="truncate text-xs text-muted">
                                            {x.stockLabel !== null ? (
                                                <span
                                                    className={x.soldOut ? "text-warn" : undefined}
                                                >
                                                    {x.stockLabel}
                                                </span>
                                            ) : null}
                                            {x.addon
                                                ? `${x.stockLabel !== null ? " · " : ""}${x.attachLabel}`
                                                : ""}
                                        </p>
                                    </div>
                                    {x.addon ? (
                                        <Button
                                            size="sm"
                                            variant="link"
                                            onPress={() => {
                                                o.setOpenId(open ? null : x.id);
                                            }}
                                        >
                                            {x.scopeLabel}
                                        </Button>
                                    ) : (
                                        <Badge label={a.notOffered} intent="neutral" />
                                    )}
                                    <div className="w-36 shrink-0">
                                        <Toggle
                                            label={a.offer}
                                            value={x.addon}
                                            onChange={() => {
                                                o.toggle(x.id);
                                            }}
                                        />
                                    </div>
                                </div>
                                {open && x.addon ? (
                                    <div className="ml-14 mt-3 rounded-md border border-line bg-bg p-3">
                                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                                            {a.pickServices}
                                        </p>
                                        <Choice
                                            label={a.pickServices}
                                            options={[
                                                { key: "all", label: a.withEvery },
                                                ...o.services,
                                            ]}
                                            value={x.addonFor.length === 0 ? "all" : x.addonFor}
                                            onChange={(k) => {
                                                if (k === "all") o.everyService(x.id);
                                                else o.toggleService(x.id, k);
                                            }}
                                        />
                                    </div>
                                ) : null}
                            </li>
                        );
                    })}
                </ul>
            </Panel>
            <SaveBar
                dirty={o.dirty}
                justSaved={o.justSaved}
                error={null}
                busy={o.busy}
                onSave={o.save}
            />
        </div>
    );
}

/** The cancellation policy, the sentence clients read, and how three cases play out. */
export function BookingPolicySettings() {
    const pol = useBookingPolicy(api);
    const d = pol.policy;
    if (d === null) {
        return (
            <PageLoad
                state={pol.load.state}
                retry={pol.load.retry}
                retrying={pol.load.retrying}
                error={s.loadError}
            />
        );
    }
    return (
        <div>
            <p className="text-sm text-muted">{p.subtitle}</p>
            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
                <Panel>
                    <div className="space-y-5">
                        <Toggle
                            label={p.selfService}
                            hint={p.selfServiceHint}
                            value={d.self_service}
                            onChange={(v) => {
                                pol.set("self_service", v);
                            }}
                        />
                        <div
                            className={`grid gap-4 sm:grid-cols-3 ${d.self_service ? "" : "pointer-events-none opacity-50"}`}
                        >
                            <Select
                                label={p.cancelCutoff}
                                value={String(d.cancel_cutoff_hours)}
                                options={pol.cutoffOptions}
                                onChange={(k) => {
                                    pol.set("cancel_cutoff_hours", Number(k));
                                }}
                            />
                            <Select
                                label={p.moveCutoff}
                                value={String(d.reschedule_cutoff_hours)}
                                options={pol.cutoffOptions}
                                onChange={(k) => {
                                    pol.set("reschedule_cutoff_hours", Number(k));
                                }}
                            />
                            <Select
                                label={p.maxMoves}
                                value={String(d.max_reschedules)}
                                options={pol.maxMoveOptions}
                                onChange={(k) => {
                                    pol.set("max_reschedules", Number(k));
                                }}
                            />
                        </div>
                        <div>
                            <p className="mb-1.5 text-sm font-medium text-ink-soft">
                                {p.lateDeposit}
                            </p>
                            <Choice
                                layout="segmented"
                                label={p.lateDeposit}
                                value={d.late_cancel_deposit}
                                options={[
                                    { key: "keep", label: p.keep },
                                    { key: "refund", label: p.refund },
                                ]}
                                onChange={(k) => {
                                    pol.set("late_cancel_deposit", k);
                                }}
                            />
                        </div>
                        {pol.error !== null ? <Notice tone="danger">{pol.error}</Notice> : null}
                    </div>
                </Panel>
                <aside className="space-y-6">
                    <Panel title={p.clientSees}>
                        <blockquote className="flex gap-2.5 rounded-lg border border-line bg-bg px-4 py-3 text-sm leading-relaxed text-ink-soft">
                            <span className="mt-0.5 shrink-0 text-muted">
                                <Icon name="shield" size={15} />
                            </span>
                            <span>{pol.clientText}</span>
                        </blockquote>
                    </Panel>
                    <Panel title={p.examples}>
                        <ul className="space-y-2">
                            {pol.examples.map((x) => (
                                <li
                                    key={x.key}
                                    className="flex items-start gap-2.5 text-sm text-ink-soft"
                                >
                                    <span
                                        aria-hidden
                                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                                        style={{
                                            backgroundColor: cssVar(INTENT_COLORS[x.intent].line),
                                        }}
                                    />
                                    {x.text}
                                </li>
                            ))}
                        </ul>
                    </Panel>
                </aside>
            </div>
            <SaveBar
                dirty={pol.dirty}
                justSaved={pol.justSaved}
                error={null}
                busy={pol.busy}
                onSave={pol.save}
            />
        </div>
    );
}
