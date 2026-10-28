import {
    type DisputeDesk,
    formatMoney,
    strings,
    useCreditNotes,
    useDisputes,
    useRefundDesk,
    usePaymentAccount,
    formatParts,
    BUSINESS_CURRENCY,
    usePeoplePhotos,
} from "@clientbridge/app-core";
import {
    Avatar,
    Button,
    PaymentAccount,
    DocTotals,
    KeyValueList,
    ListPage,
    Money,
    Notice,
    SearchField,
    StatusPill,
    Tabs,
} from "@clientbridge/ui";
import { useState } from "react";

import { DeskBar, DeskPanel } from "../components/Desk";
import { RefundPanel } from "../components/RefundPanel";
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
