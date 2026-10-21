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
    formatParts,
    BUSINESS_CURRENCY,
    currencyAffix,
    usePeoplePhotos,
} from "@clientbridge/app-core";
import {
    ActivityTimeline,
    Avatar,
    Button,
    PaymentAccount,
    Choice,
    DetailSection,
    DocTotals,
    Field,
    Icon,
    KeyValueList,
    ListPage,
    LoadFailed,
    Money,
    Notice,
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

import { DeskBar, DeskPanel } from "../components/Desk";
import { api } from "../lib/api";
import { useLinkIntent } from "../lib/links";

const s = strings.refunds;
type Tab = "payments" | "notes" | "disputes";
const NOTE_GRID =
    "grid grid-cols-[7.5rem_minmax(0,1.3fr)_minmax(0,1.4fr)_6.5rem_minmax(0,1.4fr)_6rem] items-center gap-4";

const PAY_GRID =
    "grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)_minmax(0,1fr)_7rem_8rem_6.5rem] items-center gap-4";
const DISPUTE_GRID =
    "grid grid-cols-[minmax(0,1.5fr)_minmax(0,1.4fr)_minmax(0,1.3fr)_8rem_6.5rem] items-center gap-4";

export function Refunds() {
    const [tab, setTab] = useState<Tab>("payments");
    const desk = useRefundDesk();
    const notes = useCreditNotes(desk.refunds);
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
            <DeskBar
                switcher={
                    <Tabs
                        variant="pill"
                        label={s.title}
                        items={[
                            { key: "payments", label: s.tabs.payments },
                            { key: "notes", label: s.tabs.notes },
                            {
                                key: "disputes",
                                label: formatParts([s.tabs.disputes, disputes.summary]),
                            },
                        ]}
                        active={tab}
                        onSelect={setTab}
                    />
                }
                summary={tab === "notes" ? notes.summary : undefined}
                action={
                    tab === "payments" && desk.load.state === "ready" ? (
                        <div className="w-72">
                            <SearchField
                                value={desk.q}
                                onChange={desk.setQ}
                                placeholder={s.searchPlaceholder}
                            />
                        </div>
                    ) : tab === "disputes" ? (
                        <Button
                            size="sm"
                            disabled={!account.ready}
                            icon="shield"
                            variant="outline"
                            onPress={() => {
                                account.open("payments");
                            }}
                        >
                            {strings.paymentAccount.manageDisputes}
                        </Button>
                    ) : null
                }
            />
            {tab === "payments" ? <PaymentsDesk desk={desk} /> : null}
            {tab === "notes" ? <CreditNotes notes={notes} /> : null}
            {tab === "disputes" ? <Disputes desk={disputes} /> : null}
        </div>
    );
}

function PaymentsDesk({ desk }: { desk: ReturnType<typeof useRefundDesk> }) {
    const photos = usePeoplePhotos();
    const empty = desk.load.state === "empty";
    return (
        <>
            <ListPage
                head={
                    empty ? undefined : (
                        <div className={PAY_GRID}>
                            <span>{s.colClient}</span>
                            <span>{s.colFor}</span>
                            <span>{s.colMethod}</span>
                            <span>{s.colDate}</span>
                            <span>{s.colStatus}</span>
                            <span className="text-right">{s.colAmount}</span>
                        </div>
                    )
                }
                rows={desk.rows}
                rowKey={(r) => r.payment.id}
                selectedKey={desk.selectedId ?? undefined}
                onRowPress={(r) => {
                    desk.select(r.payment.id);
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
                    empty
                        ? {
                              message: s.emptyTitle,
                              body: s.emptyBody,
                              icon: "card",
                              variant: "card",
                          }
                        : s.noMatch
                }
                renderRow={(r) => (
                    <div className={PAY_GRID}>
                        <span className="flex min-w-0 items-center gap-3">
                            <Avatar
                                name={r.payment.client_name ?? r.subject}
                                src={photos.client(r.payment.client_id)}
                                size="sm"
                            />
                            <span className="truncate font-medium text-ink">
                                {r.payment.client_name ?? r.subject}
                            </span>
                        </span>
                        <span className="truncate text-ink-soft">{r.subject}</span>
                        <span className="truncate text-ink-soft">{r.method}</span>
                        <span className="text-ink-soft">{r.when}</span>
                        <span>
                            <StatusPill status={r.stateLabel} intent={r.intent} />
                        </span>
                        <span className="text-right">
                            <Money
                                currency={BUSINESS_CURRENCY}
                                cents={r.payment.amount_cents}
                                strong
                            />
                        </span>
                    </div>
                )}
            />
            {desk.selected !== null ? (
                <RefundPanel
                    key={`${desk.selected.payment.id}:${String(desk.selected.payment.refunded_cents)}`}
                    summary={desk.selected}
                    refunds={desk.refunds}
                    onClose={() => {
                        desk.select(null);
                    }}
                />
            ) : null}
        </>
    );
}

function RefundPanel({
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

    return (
        <DeskPanel
            title={p.client_name ?? summary.subject}
            subtitle={formatParts([summary.subject, summary.method, summary.when])}
            status={{ status: summary.stateLabel, intent: summary.intent }}
            onClose={onClose}
        >
            <div className="space-y-6">
                <div className="rounded-md border border-line bg-bg px-4 py-3">
                    <KeyValueList
                        layout="stack"
                        columns={2}
                        rows={[
                            {
                                label: s.paid,
                                value: formatMoney(p.amount_cents, BUSINESS_CURRENCY),
                            },
                            {
                                label: s.refundedSoFar,
                                value: formatMoney(p.refunded_cents, BUSINESS_CURRENCY),
                                intent: p.refunded_cents > 0 ? "warning" : undefined,
                            },
                            {
                                label: s.leftToRefund,
                                value: formatMoney(summary.leftCents, BUSINESS_CURRENCY),
                            },
                            {
                                label: s.stripeFee,
                                value: formatMoney(p.fee_cents, BUSINESS_CURRENCY),
                            },
                        ]}
                    />
                </div>
                <DetailSection title={s.creditNote}>
                    <RefundForm form={form} onSubmit={ask} />
                </DetailSection>
                <DetailSection title={s.history}>
                    <ActivityTimeline entries={form.history} />
                </DetailSection>
            </div>
        </DeskPanel>
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
                        {...currencyAffix(BUSINESS_CURRENCY)}
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
                    <DocTotals currency={BUSINESS_CURRENCY} lines={form.lines} density="compact" />
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

function CreditNotes({ notes }: { notes: ReturnType<typeof useCreditNotes> }) {
    return (
        <ListPage
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
                        <Money currency={BUSINESS_CURRENCY} cents={-r.cents} strong />
                    </span>
                </div>
            )}
        />
    );
}

function Disputes({ desk }: { desk: DisputeDesk }) {
    const rows = [...desk.open, ...desk.closed];
    const sel = desk.selected;
    return (
        <>
            <ListPage
                head={
                    <div className={DISPUTE_GRID}>
                        <span>{s.colClient}</span>
                        <span>{s.colFor}</span>
                        <span>{s.colReason}</span>
                        <span>{s.colStatus}</span>
                        <span className="text-right">{s.colAmount}</span>
                    </div>
                }
                rows={rows}
                rowKey={(d) => d.row.id}
                selectedKey={sel?.row.id}
                onRowPress={(d) => {
                    desk.select(d.row.id);
                }}
                state={
                    desk.load.state === "loading"
                        ? "loading"
                        : desk.load.state === "error"
                          ? "error"
                          : undefined
                }
                onRetry={desk.load.retry}
                empty={{ message: s.noDisputes, icon: "shield", variant: "card" }}
                renderRow={(d) => (
                    <div className={DISPUTE_GRID}>
                        <span className="truncate font-medium text-ink">
                            {d.row.client_name ?? d.subject}
                        </span>
                        <span className="truncate text-ink-soft">{d.subject}</span>
                        <span className="truncate text-ink-soft">{d.reason}</span>
                        <span>
                            <StatusPill status={d.statusLabel} intent={d.intent} />
                        </span>
                        <span className="text-right">
                            <Money currency={BUSINESS_CURRENCY} cents={d.row.amount_cents} strong />
                        </span>
                    </div>
                )}
            />
            {sel !== null ? (
                <DeskPanel
                    title={s.disputeTitle(formatMoney(sel.row.amount_cents, BUSINESS_CURRENCY))}
                    subtitle={formatParts([sel.row.client_name ?? "", sel.subject])}
                    status={{ status: sel.statusLabel, intent: sel.intent }}
                    onClose={() => {
                        desk.select(null);
                    }}
                >
                    <div className="space-y-5">
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
                        <KeyValueList rows={sel.facts} />
                        <div className="rounded-md border border-line bg-bg px-4 py-3">
                            <DocTotals
                                currency={BUSINESS_CURRENCY}
                                lines={sel.held}
                                density="compact"
                            />
                        </div>
                        {sel.open ? (
                            <Notice tone="info">{strings.paymentAccount.disputeHelp}</Notice>
                        ) : null}
                    </div>
                </DeskPanel>
            ) : null}
        </>
    );
}
