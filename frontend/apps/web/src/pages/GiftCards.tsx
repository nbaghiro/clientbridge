import {
    ENTITLEMENT_ICON,
    type EntitlementActionKey,
    type EntitlementDetail,
    type EntitlementSummary,
    formatMoney,
    strings,
    useEntitlementDetail,
    useEntitlementWallet,
    useGiftCardRedeemForm,
} from "@clientbridge/app-core";
import {
    ActivityTimeline,
    Avatar,
    Button,
    Choice,
    DetailSection,
    DetailView,
    Empty,
    Icon,
    KeyValueList,
    LoadFailed,
    Meter,
    Modal,
    Notice,
    Skeleton,
    StatusPill,
    TextField,
    confirm,
} from "@clientbridge/ui";
import { useEffect, useState } from "react";

import { SellEntitlement } from "../components/EntitlementSales";
import { api } from "../lib/api";
import { useOpenLink } from "../lib/links";

const w = strings.entitlements;
const g = strings.entitlements.giftCards;

const TILE: Record<EntitlementSummary["row"]["kind"], string> = {
    package: "bg-accent-weak text-accent",
    membership: "bg-ok-bg text-ok-fg",
    gift_card: "bg-warn-bg text-warn-fg",
};

export function GiftCards() {
    const wallet = useEntitlementWallet();
    const openLink = useOpenLink();
    const [openId, setOpenId] = useState<string | null>(null);
    const [mode, setMode] = useState<"sell" | "redeem" | null>(null);
    const open = wallet.summaries.find((x) => x.row.id === openId) ?? null;
    const detail = useEntitlementDetail(api, open, (paymentId) => {
        openLink("refunds", paymentId);
    });
    const c = wallet.client;
    const [pending, setPending] = useState<EntitlementActionKey | null>(null);
    useEffect(() => {
        if (pending === null || detail === null) return;
        detail.run(pending);
        setPending(null);
    }, [pending, detail]);

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h2 className="font-display text-xl font-bold text-ink">{w.walletTitle}</h2>
                    <p className="mt-0.5 text-sm text-muted">{w.subtitle}</p>
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        onPress={() => {
                            setMode("redeem");
                        }}
                    >
                        {w.redeemGift}
                    </Button>
                    <Button
                        onPress={() => {
                            setMode("sell");
                        }}
                    >
                        {w.sellNew}
                    </Button>
                </div>
            </div>
            {wallet.load.state === "loading" ? (
                <Skeleton variant="row" count={3} label={w.walletTitle} />
            ) : wallet.load.state === "error" ? (
                <LoadFailed
                    variant="card"
                    message={w.loadError}
                    onRetry={wallet.load.retry}
                    retrying={wallet.load.retrying}
                />
            ) : wallet.load.state === "empty" ? (
                <Empty
                    variant="card"
                    icon="box"
                    message={w.emptyTitle}
                    body={w.empty}
                    actions={
                        <Button
                            onPress={() => {
                                setMode("sell");
                            }}
                        >
                            {w.sellNew}
                        </Button>
                    }
                />
            ) : (
                <>
                    <Choice
                        label={w.clientPicker}
                        options={wallet.holders}
                        value={wallet.clientId}
                        onChange={wallet.setClientId}
                    />
                    {c !== null ? (
                        <section className="flex flex-wrap items-center gap-x-8 gap-y-4 rounded-lg border border-line bg-surface px-5 py-4 shadow-card">
                            <div className="flex min-w-0 items-center gap-3">
                                <Avatar name={c.name} size="lg" />
                                <div className="min-w-0">
                                    <h3 className="truncate font-display text-lg font-bold text-ink">
                                        {c.name}
                                    </h3>
                                    <p className="truncate text-sm text-muted">{wallet.contact}</p>
                                </div>
                            </div>
                            <div className="ml-auto">
                                <KeyValueList
                                    layout="stack"
                                    columns={3}
                                    rows={[
                                        {
                                            label: w.deferred,
                                            value: formatMoney(wallet.totals.deferredCents),
                                        },
                                        {
                                            label: w.giftLiability,
                                            value: formatMoney(wallet.totals.giftCents),
                                        },
                                        {
                                            label: w.walletMonthly,
                                            value: formatMoney(wallet.totals.monthlyCents),
                                        },
                                    ]}
                                />
                            </div>
                        </section>
                    ) : null}
                    {wallet.summaries.length === 0 ? (
                        <Empty variant="card" message={w.emptyClient(c?.name ?? "")} />
                    ) : (
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                            {wallet.summaries.map((sum) => (
                                <WalletCard
                                    key={sum.row.id}
                                    summary={sum}
                                    onOpen={() => {
                                        setOpenId(sum.row.id);
                                    }}
                                    onUse={() => {
                                        setOpenId(sum.row.id);
                                        setPending("use");
                                    }}
                                />
                            ))}
                        </div>
                    )}
                </>
            )}
            {detail !== null ? (
                <DetailView
                    open
                    title={detail.summary.title}
                    subtitle={`${detail.summary.kindLabel} · ${c?.name ?? ""}`}
                    leading={<KindTile summary={detail.summary} />}
                    status={{ status: detail.summary.statusLabel, intent: detail.summary.intent }}
                    onClose={() => {
                        setOpenId(null);
                    }}
                    actions={<DetailActions detail={detail} />}
                >
                    <DetailBody detail={detail} />
                </DetailView>
            ) : null}
            <Modal
                open={mode === "sell"}
                size="lg"
                framed={false}
                onClose={() => {
                    setMode(null);
                }}
            >
                {mode === "sell" ? (
                    <SellEntitlement
                        clientId={null}
                        onClose={() => {
                            setMode(null);
                        }}
                    />
                ) : null}
            </Modal>
            <Modal
                open={mode === "redeem"}
                onClose={() => {
                    setMode(null);
                }}
            >
                {mode === "redeem" ? (
                    <RedeemGiftCard
                        onClose={() => {
                            setMode(null);
                        }}
                    />
                ) : null}
            </Modal>
        </div>
    );
}

function KindTile({ summary }: { summary: EntitlementSummary }) {
    return (
        <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${TILE[summary.row.kind]}`}
        >
            <Icon name={ENTITLEMENT_ICON[summary.row.kind]} size={19} />
        </span>
    );
}

function WalletMeter({ summary }: { summary: EntitlementSummary }) {
    if (summary.meter === null) return null;
    return (
        <Meter
            value={summary.meter.value}
            max={summary.meter.max}
            units={summary.meter.units}
            label={summary.balanceLabel}
            detail={summary.meter.detail}
            intent={summary.intent === "success" ? "accent" : summary.intent}
        />
    );
}

function WalletCard({
    summary,
    onOpen,
    onUse,
}: {
    summary: EntitlementSummary;
    onOpen: () => void;
    onUse: () => void;
}) {
    const alert = summary.status === "past_due";
    const usable =
        summary.row.kind === "package" &&
        summary.status === "active" &&
        (summary.meter?.value ?? 0) > 0;
    return (
        <article
            className={`flex flex-col rounded-lg border bg-surface p-4 shadow-card ${alert ? "border-danger/40" : "border-line"}`}
        >
            <div className="flex items-start gap-3">
                <KindTile summary={summary} />
                <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-muted">{summary.kindLabel}</p>
                    <h3
                        className={`truncate font-semibold text-ink ${summary.row.kind === "gift_card" ? "font-mono text-[15px] tracking-wide" : "text-base"}`}
                    >
                        {summary.title}
                    </h3>
                </div>
                <StatusPill status={summary.statusLabel} intent={summary.intent} asWritten />
            </div>
            <div className="mt-4 flex-1">
                {summary.meter !== null ? (
                    <WalletMeter summary={summary} />
                ) : (
                    <div>
                        <p className="text-sm font-semibold text-ink">{summary.balanceLabel}</p>
                        <p className="mt-0.5 font-display text-2xl font-bold tabular-nums text-ink">
                            {formatMoney(summary.valueCents)}
                        </p>
                    </div>
                )}
                {summary.note !== null ? (
                    <p className={`mt-2 text-xs ${alert ? "text-danger" : "text-muted"}`}>
                        {summary.note}
                    </p>
                ) : null}
            </div>
            <div className="mt-4 flex items-center gap-2 border-t border-line-soft pt-3">
                {usable ? (
                    <Button size="sm" onPress={onUse}>
                        {w.action.use}
                    </Button>
                ) : null}
                <Button size="sm" variant="quiet" onPress={onOpen}>
                    {w.history}
                </Button>
            </div>
        </article>
    );
}

function DetailBody({ detail }: { detail: EntitlementDetail }) {
    return (
        <>
            {detail.summary.meter !== null ? (
                <div className="rounded-md border border-line bg-bg px-4 py-3.5">
                    <WalletMeter summary={detail.summary} />
                </div>
            ) : null}
            <DetailSection>
                <KeyValueList rows={detail.facts} />
            </DetailSection>
            <p className="rounded-md bg-accent-weak px-3 py-2.5 text-xs leading-relaxed text-accent-strong">
                {detail.ledgerNote}
            </p>
            {detail.notYet !== null ? <Notice tone="info">{detail.notYet}</Notice> : null}
            {detail.timeline.length > 0 ? (
                <DetailSection title={w.history}>
                    <ActivityTimeline entries={detail.timeline} />
                </DetailSection>
            ) : null}
            {detail.error !== null ? <Notice tone="danger">{detail.error}</Notice> : null}
        </>
    );
}

function DetailActions({ detail }: { detail: EntitlementDetail }) {
    const press = (a: EntitlementActionKey): void => {
        if (a !== "cancel") {
            detail.run(a);
            return;
        }
        confirm({
            title: w.cancelTitle,
            message: w.cancelBody,
            confirmLabel: w.action.cancel,
            destructive: true,
        })
            .then((ok) => {
                if (ok) detail.run(a);
            })
            .catch(() => undefined);
    };
    return (
        <>
            {detail.actions.map((a, i) => (
                <Button
                    key={a}
                    variant={a === "cancel" ? "danger" : i === 0 ? "primary" : "outline"}
                    busy={detail.busy && i === 0}
                    onPress={() => {
                        press(a);
                    }}
                >
                    {detail.busy && i === 0 ? w.actionBusy : w.action[a]}
                </Button>
            ))}
        </>
    );
}

function RedeemGiftCard({ onClose }: { onClose: () => void }) {
    const form = useGiftCardRedeemForm(api, onClose);
    return (
        <div className="space-y-4">
            <h2 className="font-display text-lg font-bold text-ink">{g.redeemTitle}</h2>
            <TextField
                label={g.code}
                value={form.code}
                onChange={form.setCode}
                placeholder={g.codePlaceholder}
            />
            <TextField
                label={g.balance}
                type="number"
                prefix="$"
                value={form.amount}
                onChange={form.setAmount}
                placeholder={g.redeemAmountPlaceholder}
            />
            {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
            <div className="flex justify-end gap-2">
                <Button variant="quiet" onPress={onClose}>
                    {strings.common.cancel}
                </Button>
                <Button busy={form.busy} onPress={form.submit}>
                    {form.busy ? g.redeeming : g.redeem}
                </Button>
            </div>
        </div>
    );
}
