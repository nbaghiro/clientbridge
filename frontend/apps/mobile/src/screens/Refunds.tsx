import {
    type DisputeDesk,
    type RefundRow,
    type RefundSummary,
    formatMoney,
    strings,
    useCreditNotes,
    useDisputes,
    useRefundComposer,
    useRefundDesk,
} from "@clientbridge/app-core";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
    ActivityTimeline,
    Button,
    Choice,
    DetailSection,
    DetailView,
    DocTotals,
    Empty,
    Field,
    KeyValueList,
    ListRow,
    LoadFailed,
    Money,
    Notice,
    SearchField,
    Skeleton,
    StatusPill,
    Tabs,
    TextField,
    Toggle,
    confirm,
    ui,
} from "@clientbridge/ui";

import { api } from "../lib/api";

const s = strings.refunds;
type Tab = "payments" | "notes" | "disputes";

export function Refunds({ openId }: { openId?: string | undefined }) {
    const [tab, setTab] = useState<Tab>("payments");
    const desk = useRefundDesk();
    const disputes = useDisputes();
    const { select } = desk;
    useEffect(() => {
        if (openId === undefined) return;
        setTab("payments");
        select(openId);
    }, [openId, select]);

    return (
        <View style={styles.screen}>
            <Tabs
                variant="pill"
                label={s.title}
                items={[
                    { key: "payments", label: s.tabs.payments },
                    { key: "notes", label: s.tabs.notes },
                    { key: "disputes", label: `${s.tabs.disputes} · ${disputes.summary}` },
                ]}
                active={tab}
                onSelect={setTab}
            />
            <ScrollView contentContainerStyle={styles.page}>
                {tab === "payments" ? <PaymentsList desk={desk} /> : null}
                {tab === "notes" ? <CreditNotes refunds={desk.refunds} /> : null}
                {tab === "disputes" ? <Disputes desk={disputes} /> : null}
            </ScrollView>
            {tab === "payments" && desk.selected !== null ? (
                <Composer
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
                    detail={`${r.subject} · ${r.when}`}
                    meta={
                        <View style={styles.meta}>
                            <Money cents={r.payment.amount_cents} strong />
                            {r.state !== "paid" ? (
                                <StatusPill status={r.stateLabel} intent={r.intent} asWritten />
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

function Composer({
    summary,
    refunds,
    onClose,
}: {
    summary: RefundSummary;
    refunds: readonly RefundRow[];
    onClose: () => void;
}) {
    const form = useRefundComposer(api, summary, refunds);
    const p = summary.payment;
    const ask = (): void => {
        confirm({
            title: form.confirmTitle,
            message: form.confirmBody,
            confirmLabel: form.submitLabel,
            destructive: true,
        })
            .then((ok) => {
                if (ok) form.submit();
            })
            .catch(() => undefined);
    };
    const canAct = form.issued === null && form.blocked === null && form.preview.error === null;
    return (
        <DetailView
            open
            title={p.client_name ?? summary.subject}
            subtitle={[summary.subject, summary.method, summary.when].join(" · ")}
            status={{ status: summary.stateLabel, intent: summary.intent }}
            onClose={onClose}
            actions={
                canAct ? (
                    <Button
                        grow
                        variant="danger"
                        busy={form.busy}
                        disabled={!form.valid || form.preview.isLoading}
                        onPress={ask}
                    >
                        {form.busy ? s.refunding : form.submitLabel}
                    </Button>
                ) : undefined
            }
        >
            <KeyValueList
                layout="stack"
                columns={2}
                rows={[
                    { label: s.paid, value: formatMoney(p.amount_cents) },
                    { label: s.refundedSoFar, value: formatMoney(p.refunded_cents) },
                    { label: s.leftToRefund, value: formatMoney(summary.leftCents) },
                    { label: s.stripeFee, value: formatMoney(p.fee_cents) },
                ]}
            />
            {form.issued !== null ? (
                <Notice tone="success" banner>
                    {form.issued}
                </Notice>
            ) : form.preview.error !== null ? (
                <LoadFailed
                    message={s.previewError}
                    onRetry={() => {
                        form.preview.refresh().catch(() => undefined);
                    }}
                />
            ) : form.blocked !== null ? (
                <Notice tone="info" banner>
                    {form.blocked}
                </Notice>
            ) : (
                <DetailSection title={s.creditNote}>
                    {form.wholeOnly ? <Notice tone="info">{s.wholeOnly}</Notice> : null}
                    {form.byHand ? <Notice tone="info">{s.byHandNote}</Notice> : null}
                    <Field label={s.howMuch}>
                        <Choice
                            layout="segmented"
                            label={s.howMuch}
                            options={form.modes}
                            value={form.mode}
                            onChange={form.setMode}
                        />
                    </Field>
                    {form.mode === "part" ? (
                        <TextField
                            label={s.amount}
                            type="number"
                            prefix="$"
                            value={form.amount}
                            onChange={form.setAmount}
                            placeholder={form.amountPlaceholder}
                        />
                    ) : null}
                    <Field label={s.reason}>
                        <Choice
                            options={form.reasons}
                            value={form.reason}
                            onChange={form.setReason}
                        />
                    </Field>
                    <Text style={styles.caption}>{s.reverses}</Text>
                    {form.preview.isLoading && form.lines.length === 0 ? (
                        <Skeleton variant="line" count={3} label={s.previewLoading} />
                    ) : (
                        <DocTotals lines={form.lines} density="compact" />
                    )}
                    {form.feeNote !== null ? <Text style={ui.note}>{form.feeNote}</Text> : null}
                    <Toggle label={s.notify} value={form.notify} onChange={form.setNotify} />
                    {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
                </DetailSection>
            )}
            <DetailSection title={s.history}>
                <ActivityTimeline entries={form.history} />
            </DetailSection>
        </DetailView>
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
                    detail={`${r.client} · ${r.subject} · ${r.reason}`}
                    meta={
                        <View style={styles.meta}>
                            <Money cents={-r.cents} strong />
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
                    detail={`${d.reason} · ${d.subject}`}
                    meta={
                        <View style={styles.meta}>
                            <Money cents={d.row.amount_cents} strong />
                            <StatusPill status={d.statusLabel} intent={d.intent} asWritten />
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
                    title={s.disputeTitle(formatMoney(sel.row.amount_cents))}
                    subtitle={`${sel.row.client_name ?? ""} · ${sel.subject}`}
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
                    <DocTotals lines={sel.held} density="compact" />
                    {sel.open ? <Notice tone="info">{s.evidenceInStripe}</Notice> : null}
                </DetailView>
            ) : null}
        </>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, gap: 8 },
    page: { gap: 10, padding: 16, paddingBottom: 32 },
    meta: { alignItems: "flex-end", gap: 4 },
    caption: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
});
