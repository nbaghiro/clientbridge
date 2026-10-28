import {
    type DisputeDesk,
    type RefundRow,
    formatMoney,
    strings,
    useCreditNotes,
    useDisputes,
    useRefundDesk,
    usePaymentAccount,
    formatParts,
    BUSINESS_CURRENCY,
} from "@clientbridge/app-core";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
    Button,
    PaymentAccount,
    DetailView,
    DocTotals,
    Empty,
    KeyValueList,
    ListRow,
    LoadFailed,
    Money,
    Notice,
    SearchField,
    Skeleton,
    StatusPill,
    Tabs,
    ui,
} from "@clientbridge/ui";

import { RefundComposer } from "../components/RefundComposer";
import { api } from "../lib/api";

const s = strings.refunds;
type Tab = "payments" | "notes" | "disputes";

export function Refunds() {
    const [tab, setTab] = useState<Tab>("payments");
    const desk = useRefundDesk();
    const disputes = useDisputes();
    const account = usePaymentAccount(api);

    if (account.props !== null) return <PaymentAccount {...account.props} />;

    return (
        <View style={styles.screen}>
            <Tabs
                variant="pill"
                label={s.title}
                items={[
                    { key: "payments", label: s.tabs.payments },
                    { key: "notes", label: s.tabs.notes },
                    { key: "disputes", label: formatParts([s.tabs.disputes, disputes.summary]) },
                ]}
                active={tab}
                onSelect={setTab}
            />
            <ScrollView contentContainerStyle={styles.page}>
                {tab === "payments" ? <PaymentsList desk={desk} /> : null}
                {tab === "notes" ? <CreditNotes refunds={desk.refunds} /> : null}
                {tab === "disputes" ? (
                    <>
                        <Button
                            disabled={!account.ready}
                            icon="shield"
                            variant="outline"
                            onPress={() => {
                                account.open("payments");
                            }}
                        >
                            {strings.paymentAccount.manageDisputes}
                        </Button>
                        <Disputes desk={disputes} />
                    </>
                ) : null}
            </ScrollView>
            {tab === "payments" && desk.selected !== null ? (
                <RefundComposer
                    key={`${desk.selected.payment.id}:${String(desk.selected.payment.refunded_cents)}`}
                    summary={desk.selected}
                    refunds={desk.refunds}
                    onClose={() => {
                        desk.select(null);
                    }}
                />
            ) : null}
        </View>
    );
}

function PaymentsList({ desk }: { desk: ReturnType<typeof useRefundDesk> }) {
    if (desk.load.state === "loading") return <Skeleton variant="row" count={6} label={s.title} />;
    if (desk.load.state === "error")
        return (
            <LoadFailed variant="card" onRetry={desk.load.retry} retrying={desk.load.retrying} />
        );
    if (desk.load.state === "empty")
        return <Empty variant="card" icon="card" message={s.emptyTitle} body={s.emptyBody} />;
    return (
        <>
            <Text style={ui.note}>{s.subtitle}</Text>
            <SearchField value={desk.q} onChange={desk.setQ} placeholder={s.searchPlaceholder} />
            {desk.rows.length === 0 ? <Empty message={s.noMatch} /> : null}
            {desk.rows.map((r) => (
                <ListRow
                    key={r.payment.id}
                    title={r.payment.client_name ?? r.subject}
                    detail={formatParts([r.subject, r.when])}
                    meta={
                        <View style={styles.meta}>
                            <Money
                                currency={BUSINESS_CURRENCY}
                                cents={r.payment.amount_cents}
                                strong
                            />
                            {r.state !== "paid" ? (
                                <StatusPill status={r.stateLabel} intent={r.intent} />
                            ) : null}
                        </View>
                    }
                    onPress={() => {
                        desk.select(r.payment.id);
                    }}
                />
            ))}
        </>
    );
}

function CreditNotes({ refunds }: { refunds: readonly RefundRow[] }) {
    const notes = useCreditNotes(refunds);
    if (notes.rows.length === 0) return <Empty variant="card" message={s.noNotes} />;
    return (
        <>
            <Text style={ui.note}>{notes.summary}</Text>
            {notes.rows.map((r) => (
                <ListRow
                    key={r.id}
                    title={r.number}
                    detail={formatParts([r.client, r.subject, r.reason])}
                    meta={
                        <View style={styles.meta}>
                            <Money currency={BUSINESS_CURRENCY} cents={-r.cents} strong />
                            <Text style={ui.note}>{r.when}</Text>
                        </View>
                    }
                />
            ))}
        </>
    );
}

function Disputes({ desk }: { desk: DisputeDesk }) {
    if (desk.load.state === "loading") return <Skeleton variant="row" count={3} label={s.title} />;
    if (desk.load.state === "error")
        return (
            <LoadFailed variant="card" onRetry={desk.load.retry} retrying={desk.load.retrying} />
        );
    if (desk.load.state === "empty")
        return <Empty variant="card" icon="shield" message={s.noDisputes} />;
    const sel = desk.selected;
    return (
        <>
            {[...desk.open, ...desk.closed].map((d) => (
                <ListRow
                    key={d.row.id}
                    title={d.row.client_name ?? d.subject}
                    detail={formatParts([d.reason, d.subject])}
                    meta={
                        <View style={styles.meta}>
                            <Money currency={BUSINESS_CURRENCY} cents={d.row.amount_cents} strong />
                            <StatusPill status={d.statusLabel} intent={d.intent} />
                        </View>
                    }
                    onPress={() => {
                        desk.select(d.row.id);
                    }}
                />
            ))}
            {sel !== null ? (
                <DetailView
                    open
                    title={s.disputeTitle(formatMoney(sel.row.amount_cents, BUSINESS_CURRENCY))}
                    subtitle={formatParts([sel.row.client_name ?? "", sel.subject])}
                    status={{ status: sel.statusLabel, intent: sel.intent }}
                    onClose={() => {
                        desk.select(null);
                    }}
                >
                    <Notice
                        tone={sel.row.dispute_status === "needs_response" ? "danger" : "info"}
                        banner
                    >
                        {sel.deadline}
                    </Notice>
                    <KeyValueList rows={sel.facts} />
                    <DocTotals currency={BUSINESS_CURRENCY} lines={sel.held} density="compact" />
                    {sel.open ? (
                        <Notice tone="info">{strings.paymentAccount.disputeHelp}</Notice>
                    ) : null}
                </DetailView>
            ) : null}
        </>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, gap: 8 },
    page: { gap: 10, padding: 16, paddingBottom: 32 },
    meta: { alignItems: "flex-end", gap: 4 },
});
