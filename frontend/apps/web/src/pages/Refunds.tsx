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
    usePaymentAccount,
} from "@clientbridge/app-core";
import {
    ActivityTimeline,
    Button,
    PaymentAccount,
    Choice,
    DetailSection,
    DocTotals,
    Empty,
    Field,
    Icon,
    KeyValueList,
    ListPage,
    ListRow,
    LoadFailed,
    Money,
    Notice,
    Panel,
    SearchField,
    Select,
    Skeleton,
    StatusPill,
    Tabs,
    TextField,
    Toggle,
    confirm,
} from "@clientbridge/ui";
import { useState } from "react";

import { api } from "../lib/api";
import { useLinkIntent } from "../lib/links";

const s = strings.refunds;
type Tab = "payments" | "notes" | "disputes";
const NOTE_GRID =
    "grid grid-cols-[7.5rem_minmax(0,1.3fr)_minmax(0,1.4fr)_6.5rem_minmax(0,1.4fr)_6rem] items-center gap-4";

export function Refunds() {
    const [tab, setTab] = useState<Tab>("payments");
    const desk = useRefundDesk();
    useLinkIntent({
        onOpen: (id) => {
            setTab("payments");
            desk.select(id);
        },
    });
    const disputes = useDisputes();
    const account = usePaymentAccount(api);

    if (account.props !== null) return <PaymentAccount {...account.props} />;

    return (
        <div className="space-y-6">
            <p className="text-sm text-muted">{s.subtitle}</p>
            <Tabs
                variant="pill"
                label={s.title}
                items={[
                    { key: "payments", label: s.tabs.payments },
                    { key: "notes", label: s.tabs.notes },
                    {
                        key: "disputes",
                        label: `${s.tabs.disputes} · ${disputes.summary}`,
                    },
                ]}
                active={tab}
                onSelect={setTab}
            />
            {tab === "payments" ? <PaymentsDesk desk={desk} /> : null}
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
        </div>
    );
}

function PaymentsDesk({ desk }: { desk: ReturnType<typeof useRefundDesk> }) {
    if (desk.load.state === "loading") return <Skeleton variant="row" count={6} label={s.title} />;
    if (desk.load.state === "error")
        return (
            <LoadFailed variant="card" onRetry={desk.load.retry} retrying={desk.load.retrying} />
        );
    if (desk.load.state === "empty")
        return <Empty variant="card" icon="card" message={s.emptyTitle} body={s.emptyBody} />;
    return (
        <div className="grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)]">
            <Panel title={s.paymentsTitle} flush>
                <div className="border-b border-line-soft p-3">
                    <SearchField
                        value={desk.q}
                        onChange={desk.setQ}
                        placeholder={s.searchPlaceholder}
                    />
                </div>
                {desk.rows.length === 0 ? <Empty message={s.noMatch} /> : null}
                <div className="max-h-[70vh] divide-y divide-line-soft overflow-y-auto">
                    {desk.rows.map((r) => (
                        <ListRow
                            key={r.payment.id}
                            selected={r.payment.id === desk.selectedId}
                            title={r.payment.client_name ?? r.subject}
                            detail={`${r.subject} · ${r.when}`}
                            meta={
                                <span className="flex flex-col items-end gap-1">
                                    <Money cents={r.payment.amount_cents} strong />
                                    {r.state !== "paid" ? (
                                        <StatusPill
                                            status={r.stateLabel}
                                            intent={r.intent}
                                            asWritten
                                        />
                                    ) : null}
                                </span>
                            }
                            onPress={() => {
                                desk.select(r.payment.id);
                            }}
                        />
                    ))}
                </div>
            </Panel>
            {desk.selected !== null ? (
                <Composer
                    key={`${desk.selected.payment.id}:${String(desk.selected.payment.refunded_cents)}`}
                    summary={desk.selected}
                    refunds={desk.refunds}
                />
            ) : (
                <Panel>
                    <Empty message={s.selectPayment} />
                </Panel>
            )}
        </div>
    );
}

function Composer({ summary, refunds }: { summary: RefundSummary; refunds: readonly RefundRow[] }) {
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

    return (
        <div className="space-y-5">
            <Panel>
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <h2 className="truncate font-display text-xl font-bold text-ink">
                            {p.client_name ?? summary.subject}
                        </h2>
                        <p className="mt-0.5 text-sm text-muted">
                            {[summary.subject, summary.method, summary.when].join(" · ")}
                        </p>
                    </div>
                    <StatusPill status={summary.stateLabel} intent={summary.intent} asWritten />
                </div>
                <div className="mt-4 rounded-md border border-line bg-bg px-4 py-3">
                    <KeyValueList
                        layout="stack"
                        columns={4}
                        rows={[
                            { label: s.paid, value: formatMoney(p.amount_cents) },
                            {
                                label: s.refundedSoFar,
                                value: formatMoney(p.refunded_cents),
                                intent: p.refunded_cents > 0 ? "warning" : undefined,
                            },
                            { label: s.leftToRefund, value: formatMoney(summary.leftCents) },
                            { label: s.stripeFee, value: formatMoney(p.fee_cents) },
                        ]}
                    />
                </div>
            </Panel>
            <Panel title={s.creditNote}>
                <RefundForm form={form} onSubmit={ask} />
            </Panel>
            <Panel>
                <DetailSection title={s.history}>
                    <ActivityTimeline entries={form.history} />
                </DetailSection>
            </Panel>
        </div>
    );
}

function RefundForm({
    form,
    onSubmit,
}: {
    form: ReturnType<typeof useRefundComposer>;
    onSubmit: () => void;
}) {
    if (form.issued !== null) {
        return (
            <div className="flex items-start gap-3 rounded-md bg-ok-bg px-4 py-3 text-sm text-ok-fg">
                <Icon name="checkCircle" size={20} />
                <p className="font-medium">{form.issued}</p>
            </div>
        );
    }
    if (form.preview.error !== null)
        return (
            <LoadFailed
                message={s.previewError}
                onRetry={() => {
                    form.preview.refresh().catch(() => undefined);
                }}
            />
        );
    if (form.blocked !== null) {
        return (
            <Notice tone="info" banner>
                {form.blocked}
            </Notice>
        );
    }
    return (
        <div className="space-y-4">
            {form.wholeOnly ? (
                <Notice tone="info" banner>
                    {s.wholeOnly}
                </Notice>
            ) : null}
            {form.byHand ? (
                <Notice tone="info" banner>
                    {s.byHandNote}
                </Notice>
            ) : null}
            <div className="grid gap-4 xl:grid-cols-2">
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
            </div>
            <Select
                label={s.reason}
                value={form.reason}
                options={form.reasons}
                onChange={form.setReason}
            />
            <div className="rounded-md border border-line bg-bg px-4 py-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                    {s.reverses}
                </p>
                {form.preview.isLoading && form.lines.length === 0 ? (
                    <Skeleton variant="line" count={3} label={s.previewLoading} />
                ) : (
                    <DocTotals lines={form.lines} density="compact" />
                )}
                {form.feeNote !== null ? (
                    <p className="mt-2 text-xs text-muted">{form.feeNote}</p>
                ) : null}
            </div>
            <Toggle label={s.notify} value={form.notify} onChange={form.setNotify} />
            {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
            <div className="flex justify-end">
                <Button
                    variant="danger"
                    busy={form.busy}
                    disabled={!form.valid || form.preview.isLoading}
                    onPress={onSubmit}
                >
                    {form.busy ? s.refunding : form.submitLabel}
                </Button>
            </div>
        </div>
    );
}

function CreditNotes({ refunds }: { refunds: readonly RefundRow[] }) {
    const notes = useCreditNotes(refunds);
    return (
        <ListPage
            summary={notes.summary}
            head={
                <div className={NOTE_GRID}>
                    <span>{s.colNote}</span>
                    <span>{s.colClient}</span>
                    <span>{s.colFor}</span>
                    <span>{s.colDate}</span>
                    <span>{s.colReason}</span>
                    <span className="text-right">{s.colAmount}</span>
                </div>
            }
            rows={notes.rows}
            rowKey={(r) => r.id}
            empty={s.noNotes}
            renderRow={(r) => (
                <div className={NOTE_GRID}>
                    <span className="font-mono text-[13px] font-medium text-ink">{r.number}</span>
                    <span className="truncate text-ink">{r.client}</span>
                    <span className="truncate text-ink-soft">{r.subject}</span>
                    <span className="text-ink-soft">{r.when}</span>
                    <span className="truncate text-ink-soft">{r.reason}</span>
                    <span className="text-right">
                        <Money cents={-r.cents} strong />
                    </span>
                </div>
            )}
        />
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
    const sel = desk.selected ?? desk.open[0] ?? desk.closed[0] ?? null;
    return (
        <div className="grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)]">
            <Panel flush>
                {[
                    { title: s.openGroup, rows: desk.open },
                    { title: s.closedGroup, rows: desk.closed },
                ].map((g) =>
                    g.rows.length === 0 ? null : (
                        <div key={g.title}>
                            <h3 className="border-b border-line-soft bg-bg px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                                {g.title}
                            </h3>
                            <div className="divide-y divide-line-soft">
                                {g.rows.map((d) => (
                                    <ListRow
                                        key={d.row.id}
                                        selected={d.row.id === sel?.row.id}
                                        title={d.row.client_name ?? d.subject}
                                        detail={`${d.reason} · ${d.subject}`}
                                        meta={
                                            <span className="flex flex-col items-end gap-1">
                                                <Money cents={d.row.amount_cents} strong />
                                                <StatusPill
                                                    status={d.statusLabel}
                                                    intent={d.intent}
                                                    asWritten
                                                />
                                            </span>
                                        }
                                        onPress={() => {
                                            desk.select(d.row.id);
                                        }}
                                    />
                                ))}
                            </div>
                        </div>
                    ),
                )}
            </Panel>
            {sel !== null ? (
                <Panel>
                    <div className="space-y-5">
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <h2 className="font-display text-xl font-bold text-ink">
                                    {s.disputeTitle(formatMoney(sel.row.amount_cents))}
                                </h2>
                                <p className="mt-0.5 text-sm text-muted">
                                    {`${sel.row.client_name ?? ""} · ${sel.subject}`}
                                </p>
                            </div>
                            <StatusPill status={sel.statusLabel} intent={sel.intent} asWritten />
                        </div>
                        <Notice
                            tone={
                                sel.row.dispute_status === "needs_response"
                                    ? "danger"
                                    : sel.row.dispute_status === "won"
                                      ? "success"
                                      : "info"
                            }
                            banner
                        >
                            {sel.deadline}
                        </Notice>
                        <div className="grid gap-5 xl:grid-cols-2">
                            <KeyValueList rows={sel.facts} />
                            <div className="rounded-md border border-line bg-bg px-4 py-3">
                                <DocTotals lines={sel.held} density="compact" />
                            </div>
                        </div>
                        {sel.open ? (
                            <Notice tone="info">{strings.paymentAccount.disputeHelp}</Notice>
                        ) : null}
                    </div>
                </Panel>
            ) : null}
        </div>
    );
}
