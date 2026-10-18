import {
    type BoardCard,
    type OrderOut,
    canManagePayments,
    discountLabel,
    discountReason,
    formatMoney,
    formatTime,
    strings,
    useFrontDeskBoard,
    useSaleActions,
    useSaleDetail,
    useSalesHistory,
    formatParts,
    BUSINESS_CURRENCY,
    useBusinessZone,
    formatDayTime,
} from "@clientbridge/app-core";
import {
    Avatar,
    Badge,
    Button,
    Choice,
    DetailSection,
    DetailView,
    DocTotals,
    Empty,
    LineItem,
    ListRow,
    LoadFailed,
    Notice,
    SearchField,
    Skeleton,
    confirm,
} from "@clientbridge/ui";
import { useState } from "react";

import { api } from "../lib/api";
import { useRole } from "../lib/auth";
import { SummaryStrip } from "./Workspace";

const d = strings.pos.desk;

function BoardCardView({
    card,
    busy,
    onAction,
    onDetails,
}: {
    card: BoardCard;
    busy: boolean;
    onAction: () => void;
    onDetails: (() => void) | null;
}) {
    return (
        <article className="rounded-lg border border-line bg-surface p-3.5 shadow-card">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{card.clientName}</p>
                    <p className="mt-0.5 truncate text-xs text-muted">
                        {formatParts([card.number, card.since])}
                    </p>
                </div>
                <span className="text-sm font-semibold tabular-nums text-ink">{card.total}</span>
            </div>
            <ul className="mt-2.5 space-y-1 text-sm text-ink-soft">
                {card.lines.map((l, i) => (
                    <li key={String(i)} className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-line" />
                        <span className="truncate">{l}</span>
                    </li>
                ))}
            </ul>
            {card.note !== null && card.note !== "" ? (
                <p className="mt-2.5 rounded bg-warn-bg px-2.5 py-1.5 text-xs text-ink-soft">
                    {card.note}
                </p>
            ) : null}
            <div className="mt-3 flex items-center justify-between gap-2">
                {onDetails !== null ? (
                    <Button variant="link" size="sm" onPress={onDetails}>
                        {d.details}
                    </Button>
                ) : (
                    <span />
                )}
                <Button
                    size="sm"
                    variant={card.action.tone}
                    busy={busy}
                    {...(card.column === "prepare" ? { icon: "check" as const } : {})}
                    onPress={onAction}
                >
                    {card.action.label}
                </Button>
            </div>
        </article>
    );
}

/** Orders B: held sales beside the shared pickup queue. */
export function SalesBoard({ onResume }: { onResume: (order: OrderOut) => void }) {
    const board = useFrontDeskBoard(api, onResume);
    const manager = canManagePayments(useRole());
    const [open, setOpen] = useState<string | null>(null);
    if (board.load.state === "loading")
        return (
            <div className="p-5">
                <Skeleton variant="row" count={4} label={d.loadingOrders} />
            </div>
        );
    if (board.load.state === "error")
        return (
            <div className="p-5">
                <LoadFailed message={d.ordersError} onRetry={board.refresh} />
            </div>
        );
    return (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            {board.done !== null ? <Notice tone="success">{board.done}</Notice> : null}
            {board.error !== null ? <Notice tone="danger">{board.error}</Notice> : null}
            {board.isEmpty ? (
                <div className="pt-16">
                    <Empty icon="bag" message={d.ordersEmpty} body={d.ordersEmptyBody} />
                </div>
            ) : (
                <div className="grid gap-4 lg:grid-cols-3">
                    {board.columns.map((col) => (
                        <section
                            key={col.key}
                            className="rounded-lg bg-surface2 p-3"
                            aria-label={col.title}
                        >
                            <div className="mb-3 flex items-start justify-between gap-2 px-1">
                                <div>
                                    <h3 className="text-sm font-semibold text-ink">{col.title}</h3>
                                    <p className="text-xs text-muted">{col.hint}</p>
                                </div>
                                <Badge label={col.cards.length} variant="count" />
                            </div>
                            <div className="space-y-3">
                                {col.cards.length === 0 ? (
                                    <p className="px-1 py-6 text-center text-sm text-muted">
                                        {col.empty}
                                    </p>
                                ) : (
                                    col.cards.map((card) => (
                                        <BoardCardView
                                            key={card.id}
                                            card={card}
                                            busy={board.busyId === card.id}
                                            onAction={() => {
                                                board.advance(card.id);
                                            }}
                                            onDetails={
                                                manager
                                                    ? () => {
                                                          setOpen(card.id);
                                                      }
                                                    : null
                                            }
                                        />
                                    ))
                                )}
                            </div>
                            {col.key === "prepare" ? (
                                <p className="mt-3 px-1 text-xs text-muted">{d.pickupNotify}</p>
                            ) : null}
                        </section>
                    ))}
                </div>
            )}
            <SalePanel
                id={open}
                onClose={() => {
                    setOpen(null);
                }}
                onResume={(id) => {
                    const order = board.held.find((o) => o.id === id);
                    setOpen(null);
                    if (order !== undefined) onResume(order);
                }}
            />
        </div>
    );
}

/** The sales history: today's figures, filters and the sales by day, with A's sale panel. */
export function SalesHistory({ onResume }: { onResume: (order: OrderOut) => void }) {
    const zone = useBusinessZone();
    const history = useSalesHistory();
    const [open, setOpen] = useState<string | null>(null);
    const resume = (id: string): void => {
        setOpen(null);
        api.get<OrderOut[]>("/v1/orders/held")
            .then((held) => {
                const order = held.find((o) => o.id === id);
                if (order !== undefined) onResume(order);
            })
            .catch(() => undefined);
    };
    const t = history.today;
    const none = history.load.state !== "loading" && history.days.length === 0 && history.q === "";
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {history.load.state === "ready" && !none ? (
                <SummaryStrip
                    items={[
                        {
                            label: d.todaySales,
                            value: formatMoney(t.salesCents, BUSINESS_CURRENCY),
                        },
                        { label: d.todayTips, value: formatMoney(t.tipsCents, BUSINESS_CURRENCY) },
                        {
                            label: d.todayDiscounts,
                            value: formatMoney(t.discountsCents, BUSINESS_CURRENCY),
                        },
                        {
                            label: d.todayAverage,
                            value: formatMoney(t.averageCents, BUSINESS_CURRENCY),
                        },
                    ]}
                />
            ) : null}
            {none ? null : (
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-3">
                    <Choice
                        layout="segmented"
                        label={d.history}
                        options={history.filters}
                        value={history.filter}
                        onChange={history.setFilter}
                    />
                    <SearchField
                        className="w-full sm:w-80"
                        value={history.q}
                        onChange={history.setQ}
                        placeholder={d.historySearch}
                    />
                </div>
            )}
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
                {history.load.state === "loading" ? (
                    <Skeleton variant="row" count={6} label={d.loadingSales} />
                ) : history.load.state === "error" ? (
                    <LoadFailed message={d.salesError} />
                ) : history.days.length === 0 ? (
                    <div className="pt-16">
                        <Empty
                            icon="receipt"
                            message={history.q === "" ? d.historyEmptyTitle : history.empty}
                            {...(history.q === "" ? { body: history.empty } : {})}
                        />
                    </div>
                ) : (
                    history.days.map((day) => (
                        <section key={day.key}>
                            <div className="mb-2 flex items-baseline justify-between px-1">
                                <h3 className="text-sm font-semibold text-ink">{day.label}</h3>
                                <span className="text-xs text-muted">
                                    {d.dayTotal(
                                        day.count,
                                        formatMoney(day.totalCents, BUSINESS_CURRENCY),
                                    )}
                                </span>
                            </div>
                            <div className="divide-y divide-line-soft overflow-hidden rounded-lg border border-line bg-surface">
                                {day.rows.map((r) => (
                                    <ListRow
                                        key={r.id}
                                        selected={open === r.id}
                                        leading={
                                            <span className="w-20 shrink-0">
                                                <span className="block text-sm font-medium text-ink">
                                                    {formatTime(r.at, zone)}
                                                </span>
                                                <span className="block text-xs text-muted">
                                                    {r.number}
                                                </span>
                                            </span>
                                        }
                                        title={
                                            <span className="flex items-center gap-2">
                                                {r.clientName}
                                                {r.source === "online" ? (
                                                    <Badge label={d.sourceOnline} intent="accent" />
                                                ) : null}
                                                {r.status !== "paid" ? (
                                                    <Badge
                                                        label={r.statusLabel}
                                                        intent={r.intent}
                                                    />
                                                ) : null}
                                            </span>
                                        }
                                        label={strings.common.labelValue(r.number, r.clientName)}
                                        detail={r.summary}
                                        meta={
                                            <span className="flex items-center gap-6">
                                                <span className="hidden w-32 truncate text-sm text-muted lg:block">
                                                    {r.methodLabel}
                                                </span>
                                                <span className="w-20 text-right text-sm font-semibold tabular-nums text-ink">
                                                    {formatMoney(r.totalCents, BUSINESS_CURRENCY)}
                                                </span>
                                            </span>
                                        }
                                        onPress={() => {
                                            setOpen(r.id);
                                        }}
                                    />
                                ))}
                            </div>
                        </section>
                    ))
                )}
            </div>
            <SalePanel
                id={open}
                onClose={() => {
                    setOpen(null);
                }}
                onResume={resume}
            />
        </div>
    );
}

/** One sale in the side panel: lines, maths, payments, tip shares, receipt and its actions. */
function SalePanel({
    id,
    onClose,
    onResume,
}: {
    id: string | null;
    onClose: () => void;
    onResume: (id: string) => void;
}) {
    const role = useRole();
    const zone = useBusinessZone();
    const { load, detail } = useSaleDetail(id, role);
    const actions = useSaleActions(api, confirm, onResume);
    if (id === null) return null;
    return (
        <DetailView
            open
            title={
                detail?.number === "" || detail === null ? d.details : d.saleNumber(detail.number)
            }
            subtitle={
                detail === null
                    ? undefined
                    : formatParts([detail.clientName, formatDayTime(detail.at, zone)])
            }
            {...(detail === null
                ? {}
                : { status: { status: detail.statusLabel, intent: detail.intent } })}
            onClose={() => {
                actions.dismiss();
                onClose();
            }}
            actions={
                detail === null ? undefined : (
                    <>
                        {detail.actions.map((a) => (
                            <Button
                                key={a.key}
                                variant={a.tone}
                                busy={actions.busyKey === a.key}
                                {...(a.key === "receipt" ? { icon: "send" as const } : {})}
                                onPress={() => {
                                    actions.run(detail, a.key);
                                }}
                            >
                                {a.label}
                            </Button>
                        ))}
                    </>
                )
            }
        >
            {load.state === "loading" || detail === null ? (
                <Skeleton variant="row" count={4} label={d.loadingTicket} />
            ) : (
                <>
                    {actions.done !== null ? <Notice tone="success">{actions.done}</Notice> : null}
                    {actions.error !== null ? <Notice tone="danger">{actions.error}</Notice> : null}
                    <DetailSection title={d.lines}>
                        <div className="divide-y divide-line-soft">
                            {detail.priced.lines.map((l) => (
                                <LineItem
                                    key={l.key}
                                    title={l.description}
                                    currency={BUSINESS_CURRENCY}
                                    {...(l.quantity > 1 ? { count: l.quantity } : {})}
                                    tag={
                                        l.discount === null
                                            ? null
                                            : {
                                                  label: formatParts([
                                                      discountLabel(l.discount),
                                                      discountReason(l.discount.reason),
                                                  ]),
                                                  intent: "success",
                                              }
                                    }
                                    cents={l.grossCents - l.lineDiscountCents}
                                    originalCents={l.lineDiscountCents > 0 ? l.grossCents : null}
                                />
                            ))}
                        </div>
                        <div className="mt-3 rounded-md bg-bg px-4 py-3">
                            <DocTotals currency={BUSINESS_CURRENCY} lines={detail.totalLines} />
                        </div>
                    </DetailSection>
                    {detail.payments.length > 0 ? (
                        <DetailSection title={d.payments}>
                            <div className="divide-y divide-line-soft rounded-md border border-line">
                                {detail.payments.map((p) => (
                                    <ListRow
                                        key={p.id}
                                        density="compact"
                                        icon={p.refund ? "refresh" : "card"}
                                        title={p.label}
                                        detail={p.detail}
                                        meta={formatMoney(p.cents, BUSINESS_CURRENCY)}
                                    />
                                ))}
                            </div>
                        </DetailSection>
                    ) : null}
                    {detail.tipShares.length > 0 ? (
                        <DetailSection title={d.tipsTo}>
                            <div className="flex flex-wrap gap-2">
                                {detail.tipShares.map((s) => (
                                    <span
                                        key={s.staffId}
                                        className="inline-flex items-center gap-2 rounded-full border border-line py-1 pl-1 pr-3 text-sm"
                                    >
                                        <Avatar name={s.name} size="sm" color={s.color} />
                                        {s.name}
                                        <span className="font-semibold tabular-nums">
                                            {formatMoney(s.cents, BUSINESS_CURRENCY)}
                                        </span>
                                    </span>
                                ))}
                            </div>
                        </DetailSection>
                    ) : null}
                    <DetailSection title={d.receiptSection}>
                        <p className="text-sm text-ink">{detail.receipt ?? d.noReceipt}</p>
                        <p className="mt-0.5 text-xs text-muted">{d.rungBy(detail.rungBy)}</p>
                        {detail.note !== null && detail.note !== "" ? (
                            <p className="mt-2 text-sm text-ink-soft">{detail.note}</p>
                        ) : null}
                    </DetailSection>
                </>
            )}
        </DetailView>
    );
}
