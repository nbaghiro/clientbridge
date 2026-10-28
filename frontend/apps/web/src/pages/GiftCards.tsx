import {
    ENTITLEMENT_ICON,
    type EntitlementActionKey,
    type EntitlementDeskRow,
    type EntitlementDetail,
    type EntitlementSegment,
    type EntitlementSummary,
    strings,
    useEntitlementDetail,
    useEntitlementDesk,
    useGiftCardRedeemForm,
    formatParts,
    BUSINESS_CURRENCY,
    currencyAffix,
    usePeoplePhotos,
} from "@clientbridge/app-core";
import {
    ActivityTimeline,
    Avatar,
    Button,
    DetailSection,
    Icon,
    KeyValueList,
    ListPage,
    Meter,
    Modal,
    Notice,
    StatusPill,
    TextField,
    confirm,
} from "@clientbridge/ui";
import { useState } from "react";

import { DeskBar, DeskPanel } from "../components/Desk";
import { SellEntitlement } from "../components/EntitlementSales";
import { api } from "../lib/api";
import { useOpenLink } from "../lib/links";

const w = strings.entitlements;
const g = strings.entitlements.giftCards;

const GRID =
    "grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.3fr)_8rem_minmax(0,1fr)] items-center gap-4";

export function GiftCards() {
    const photos = usePeoplePhotos();
    const desk = useEntitlementDesk();
    const openLink = useOpenLink();
    const [openId, setOpenId] = useState<string | null>(null);
    const [mode, setMode] = useState<"sell" | "redeem" | null>(null);
    const open = desk.rows.find((x) => x.row.id === openId) ?? null;
    const detail = useEntitlementDetail(api, open, (paymentId) => {
        openLink("refunds", paymentId);
    });
    const nothingYet = desk.load.state === "empty";

    return (
        <div className="@container space-y-6">
            <DeskBar
                summary={desk.summary}
                action={
                    nothingYet ? null : (
                        <>
                            <Button
                                size="sm"
                                variant="outline"
                                onPress={() => {
                                    setMode("redeem");
                                }}
                            >
                                {w.redeemGift}
                            </Button>
                            <Button
                                size="sm"
                                icon="plus"
                                onPress={() => {
                                    setMode("sell");
                                }}
                            >
                                {w.sellNew}
                            </Button>
                        </>
                    )
                }
            />
            <ListPage<EntitlementDeskRow, EntitlementSegment>
                segments={
                    nothingYet
                        ? undefined
                        : {
                              items: desk.segments,
                              active: desk.segment,
                              onSelect: desk.setSegment,
                              layout: "menu",
                          }
                }
                search={
                    nothingYet
                        ? undefined
                        : { value: desk.q, onChange: desk.setQ, placeholder: w.search }
                }
                head={
                    nothingYet ? undefined : (
                        <div className={GRID}>
                            <span>{w.colItem}</span>
                            <span>{w.colClient}</span>
                            <span>{w.colStatus}</span>
                            <span className="text-right">{w.colLeft}</span>
                        </div>
                    )
                }
                rows={desk.rows}
                rowKey={(x) => x.row.id}
                selectedKey={openId ?? undefined}
                onRowPress={(x) => {
                    setOpenId(x.row.id);
                }}
                state={
                    desk.load.state === "loading"
                        ? "loading"
                        : desk.load.state === "error"
                          ? "error"
                          : undefined
                }
                onRetry={desk.load.retry}
                empty={
                    nothingYet
                        ? {
                              message: w.emptyTitle,
                              body: w.empty,
                              icon: "box",
                              variant: "card",
                              actions: (
                                  <Button
                                      icon="plus"
                                      onPress={() => {
                                          setMode("sell");
                                      }}
                                  >
                                      {w.sellNew}
                                  </Button>
                              ),
                          }
                        : desk.emptyMessage
                }
                renderRow={(x) => (
                    <div className={GRID}>
                        <span className="flex min-w-0 items-center gap-3">
                            <KindTile summary={x} />
                            <span className="min-w-0">
                                <span
                                    className={`block truncate font-medium text-ink ${x.row.kind === "gift_card" ? "font-mono text-[13px] tracking-wide" : ""}`}
                                >
                                    {x.title}
                                </span>
                                <span className="block truncate text-xs text-muted">
                                    {formatParts([x.kindLabel, x.note])}
                                </span>
                            </span>
                        </span>
                        <span className="flex min-w-0 items-center gap-3">
                            {x.clientName !== "" ? (
                                <>
                                    <Avatar
                                        name={x.clientName}
                                        src={photos.client(x.row.client_id)}
                                        size="sm"
                                    />
                                    <span className="truncate text-ink">{x.clientName}</span>
                                </>
                            ) : (
                                <span className="text-muted">{w.walkIn}</span>
                            )}
                        </span>
                        <span>
                            <StatusPill status={x.statusLabel} intent={x.intent} />
                        </span>
                        <span className="truncate text-right font-medium tabular-nums text-ink">
                            {x.balanceLabel}
                        </span>
                    </div>
                )}
            />
            {detail !== null ? (
                <DeskPanel
                    title={detail.summary.title}
                    subtitle={formatParts([detail.summary.kindLabel, open?.clientName ?? ""])}
                    leading={<KindTile summary={detail.summary} />}
                    status={{ status: detail.summary.statusLabel, intent: detail.summary.intent }}
                    onClose={() => {
                        setOpenId(null);
                    }}
                    actions={<DetailActions detail={detail} />}
                >
                    <DetailBody detail={detail} />
                </DeskPanel>
            ) : null}
            <Modal
                variant="drawer"
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
        <Icon
            name={ENTITLEMENT_ICON[summary.row.kind]}
            size={22}
            className="mt-0.5 text-ink-soft"
        />
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
                {...currencyAffix(BUSINESS_CURRENCY)}
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
