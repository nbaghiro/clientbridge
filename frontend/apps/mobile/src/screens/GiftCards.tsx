import {
    type EntitlementActionKey,
    type EntitlementDetail,
    type EntitlementSummary,
    formatMoney,
    strings,
    useEntitlementDetail,
    useEntitlementWallet,
    useGiftCardRedeemForm,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
    ActivityTimeline,
    Button,
    Choice,
    DetailSection,
    DetailView,
    Empty,
    KeyValueList,
    LoadFailed,
    Meter,
    Modal,
    Notice,
    Panel,
    Skeleton,
    StatusPill,
    TextField,
    confirm,
    ui,
} from "@clientbridge/ui";

import { SellEntitlement } from "../components/EntitlementSales";
import { api } from "../lib/api";
import { useOpenLink } from "../lib/links";

const c = theme.colors;
const w = strings.entitlements;
const g = strings.entitlements.giftCards;

export function GiftCards() {
    const wallet = useEntitlementWallet();
    const openLink = useOpenLink();
    const [openId, setOpenId] = useState<string | null>(null);
    const [mode, setMode] = useState<"sell" | "redeem" | null>(null);
    const [pending, setPending] = useState<EntitlementActionKey | null>(null);
    const open = wallet.summaries.find((x) => x.row.id === openId) ?? null;
    const detail = useEntitlementDetail(api, open, (paymentId) => {
        openLink("refunds", paymentId);
    });
    useEffect(() => {
        if (pending === null || detail === null) return;
        detail.run(pending);
        setPending(null);
    }, [pending, detail]);

    return (
        <ScrollView contentContainerStyle={styles.page}>
            <View style={styles.head}>
                <Text style={ui.note}>{w.subtitle}</Text>
                <View style={styles.row}>
                    <Button
                        grow
                        onPress={() => {
                            setMode("sell");
                        }}
                    >
                        {w.sellNew}
                    </Button>
                    <Button
                        variant="outline"
                        onPress={() => {
                            setMode("redeem");
                        }}
                    >
                        {g.redeem}
                    </Button>
                </View>
            </View>
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
                <Empty variant="card" icon="box" message={w.emptyTitle} body={w.empty} />
            ) : (
                <>
                    <Choice
                        label={w.clientPicker}
                        options={wallet.holders}
                        value={wallet.clientId}
                        onChange={wallet.setClientId}
                    />
                    {wallet.client !== null ? (
                        <Panel title={wallet.client.name} subtitle={wallet.contact}>
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
                        </Panel>
                    ) : null}
                    {wallet.summaries.length === 0 ? (
                        <Empty message={w.emptyClient(wallet.client?.name ?? "")} />
                    ) : (
                        wallet.summaries.map((sum) => (
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
                        ))
                    )}
                </>
            )}
            {detail !== null ? (
                <DetailView
                    open
                    title={detail.summary.title}
                    subtitle={`${detail.summary.kindLabel} · ${wallet.client?.name ?? ""}`}
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
                open={mode !== null}
                size="xl"
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
                ) : mode === "redeem" ? (
                    <RedeemGiftCard
                        onClose={() => {
                            setMode(null);
                        }}
                    />
                ) : null}
            </Modal>
        </ScrollView>
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
    const usable =
        summary.row.kind === "package" &&
        summary.status === "active" &&
        (summary.meter?.value ?? 0) > 0;
    return (
        <Panel
            title={summary.title}
            subtitle={summary.kindLabel}
            actions={<StatusPill status={summary.statusLabel} intent={summary.intent} asWritten />}
        >
            <View style={styles.cardBody}>
                {summary.meter !== null ? (
                    <WalletMeter summary={summary} />
                ) : (
                    <View>
                        <Text style={styles.balanceLabel}>{summary.balanceLabel}</Text>
                        <Text style={styles.figure}>{formatMoney(summary.valueCents)}</Text>
                    </View>
                )}
                {summary.note !== null ? (
                    <Text style={[ui.note, summary.status === "past_due" ? styles.alert : null]}>
                        {summary.note}
                    </Text>
                ) : null}
                <View style={styles.row}>
                    {usable ? (
                        <Button size="sm" onPress={onUse}>
                            {w.action.use}
                        </Button>
                    ) : null}
                    <Button size="sm" variant="quiet" onPress={onOpen}>
                        {w.history}
                    </Button>
                </View>
            </View>
        </Panel>
    );
}

function DetailBody({ detail }: { detail: EntitlementDetail }) {
    return (
        <>
            <WalletMeter summary={detail.summary} />
            <DetailSection>
                <KeyValueList rows={detail.facts} />
            </DetailSection>
            <Notice tone="info">{detail.ledgerNote}</Notice>
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
                    grow
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
        <View style={styles.page}>
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
            <View style={ui.actions}>
                <Button variant="quiet" onPress={onClose}>
                    {strings.common.cancel}
                </Button>
                <Button busy={form.busy} onPress={form.submit}>
                    {form.busy ? g.redeeming : g.redeem}
                </Button>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    page: { gap: 12, padding: 16, paddingBottom: 32 },
    head: { gap: 10 },
    row: { flexDirection: "row", gap: 8, alignItems: "center" },
    cardBody: { gap: 8 },
    balanceLabel: { color: c.ink, fontSize: 14, fontWeight: "600" },
    figure: { color: c.ink, fontSize: 24, fontWeight: "700", fontVariant: ["tabular-nums"] },
    alert: { color: c.danFg },
});
