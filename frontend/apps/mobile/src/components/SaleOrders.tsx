import {
    type BoardColumn,
    type OrderOut,
    canManagePayments,
    discountLabel,
    formatMoney,
    formatTime,
    relativeDayTime,
    strings,
    useFrontDeskBoard,
    useSaleActions,
    useSaleDetail,
    useSalesHistory,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
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
    Stat,
    Tabs,
    confirm,
} from "@clientbridge/ui";

import { api } from "../lib/api";
import { useRole } from "../lib/auth";

const d = strings.pos.desk;
const c = theme.colors;

/** Orders B on a phone: one column at a time, held sales and pickups with their next step. */
export function SalesBoard({ onResume }: { onResume: (order: OrderOut) => void }) {
    const board = useFrontDeskBoard(api, onResume);
    const manager = canManagePayments(useRole());
    const [column, setColumn] = useState<BoardColumn>("open");
    const [open, setOpen] = useState<string | null>(null);
    if (board.load.state === "loading")
        return <Skeleton variant="row" count={4} label={d.loadingOrders} />;
    if (board.load.state === "error")
        return <LoadFailed variant="card" message={d.ordersError} onRetry={board.refresh} />;
    const current = board.columns.find((col) => col.key === column) ?? board.columns[0];
    return (
        <View style={styles.stack}>
            <Tabs
                variant="pill"
                label={d.ordersTitle}
                items={board.columns.map((col) => ({
                    key: col.key,
                    label: `${col.title} ${String(col.cards.length)}`,
                }))}
                active={column}
                onSelect={setColumn}
            />
            {board.done !== null ? <Notice tone="success">{board.done}</Notice> : null}
            {board.error !== null ? <Notice tone="danger">{board.error}</Notice> : null}
            {current === undefined ? null : (
                <>
                    <Text style={styles.note}>{current.hint}</Text>
                    {current.cards.length === 0 ? (
                        <Empty message={current.empty} />
                    ) : (
                        current.cards.map((card) => (
                            <View key={card.id} style={styles.card}>
                                <View style={styles.row}>
                                    <Text style={styles.name}>{card.clientName}</Text>
                                    <Text style={styles.money}>{card.total}</Text>
                                </View>
                                <Text style={styles.note}>
                                    {[card.number, card.since].filter(Boolean).join(" · ")}
                                </Text>
                                {card.lines.map((l, i) => (
                                    <Text key={String(i)} style={styles.soft}>
                                        {`• ${l}`}
                                    </Text>
                                ))}
                                {card.note !== null && card.note !== "" ? (
                                    <Notice tone="info">{card.note}</Notice>
                                ) : null}
                                <View style={styles.row}>
                                    {manager ? (
                                        <Button
                                            variant="link"
                                            size="sm"
                                            onPress={() => {
                                                setOpen(card.id);
                                            }}
                                        >
                                            {d.details}
                                        </Button>
                                    ) : (
                                        <View />
                                    )}
                                    <Button
                                        size="sm"
                                        variant={card.action.tone}
                                        busy={board.busyId === card.id}
                                        onPress={() => {
                                            board.advance(card.id);
                                        }}
                                    >
                                        {card.action.label}
                                    </Button>
                                </View>
                            </View>
                        ))
                    )}
                    {current.key === "prepare" ? (
                        <Text style={styles.note}>{d.pickupNotify}</Text>
                    ) : null}
                </>
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
        </View>
    );
}

/** The sales history on a phone: today's figures, filters and the sales by day. */
export function SalesHistory({ onResume }: { onResume: (order: OrderOut) => void }) {
    const history = useSalesHistory();
    const [open, setOpen] = useState<string | null>(null);
    const t = history.today;
    return (
        <View style={styles.stack}>
            {history.load.state === "ready" || history.load.state === "empty" ? (
                <View style={styles.stats}>
                    <Stat label={d.todaySales} cents={t.salesCents} hint={d.todayCount(t.count)} />
                    <Stat label={d.todayTips} cents={t.tipsCents} />
                </View>
            ) : null}
            <Choice
                label={d.history}
                options={history.filters}
                value={history.filter}
                onChange={history.setFilter}
            />
            <SearchField value={history.q} onChange={history.setQ} placeholder={d.historySearch} />
            {history.load.state === "loading" ? (
                <Skeleton variant="row" count={6} label={d.loadingSales} />
            ) : history.load.state === "error" ? (
                <LoadFailed variant="card" message={d.salesError} />
            ) : history.days.length === 0 ? (
                <Empty
                    variant="card"
                    icon="receipt"
                    message={history.q === "" ? d.historyEmptyTitle : history.empty}
                />
            ) : (
                history.days.map((day) => (
                    <View key={day.key} style={styles.stack}>
                        <View style={styles.row}>
                            <Text style={styles.name}>{day.label}</Text>
                            <Text style={styles.note}>
                                {d.dayTotal(day.count, formatMoney(day.totalCents))}
                            </Text>
                        </View>
                        {day.rows.map((r) => (
                            <ListRow
                                key={r.id}
                                title={r.clientName}
                                detail={`${formatTime(r.at)} · ${r.number} · ${r.summary}`}
                                meta={formatMoney(r.totalCents)}
                                onPress={() => {
                                    setOpen(r.id);
                                }}
                            />
                        ))}
                    </View>
                ))
            )}
            <SalePanel
                id={open}
                onClose={() => {
                    setOpen(null);
                }}
                onResume={(id) => {
                    setOpen(null);
                    api.get<OrderOut[]>("/v1/orders/held")
                        .then((held) => {
                            const order = held.find((o) => o.id === id);
                            if (order !== undefined) onResume(order);
                        })
                        .catch(() => undefined);
                }}
            />
        </View>
    );
}

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
    const { detail } = useSaleDetail(api, id, role);
    const actions = useSaleActions(api, confirm, onResume);
    if (id === null) return null;
    return (
        <DetailView
            open
            title={
                detail === null || detail.number === "" ? d.details : d.saleNumber(detail.number)
            }
            subtitle={
                detail === null ? undefined : `${detail.clientName} · ${relativeDayTime(detail.at)}`
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
            {detail === null ? (
                <Skeleton variant="row" count={4} label={d.loadingTicket} />
            ) : (
                <>
                    {actions.done !== null ? <Notice tone="success">{actions.done}</Notice> : null}
                    {actions.error !== null ? <Notice tone="danger">{actions.error}</Notice> : null}
                    <DetailSection title={d.lines}>
                        {detail.priced.lines.map((l) => (
                            <LineItem
                                key={l.key}
                                title={l.description}
                                {...(l.quantity > 1 ? { count: l.quantity } : {})}
                                tag={
                                    l.discount === null
                                        ? null
                                        : {
                                              label: [discountLabel(l.discount), l.discount.reason]
                                                  .filter(Boolean)
                                                  .join(" · "),
                                              intent: "success",
                                          }
                                }
                                cents={l.grossCents - l.lineDiscountCents}
                                originalCents={l.lineDiscountCents > 0 ? l.grossCents : null}
                            />
                        ))}
                        <DocTotals lines={detail.totalLines} density="compact" />
                    </DetailSection>
                    {detail.payments.length > 0 ? (
                        <DetailSection title={d.payments}>
                            {detail.payments.map((p) => (
                                <ListRow
                                    key={p.id}
                                    density="compact"
                                    icon={p.refund ? "refresh" : "card"}
                                    title={p.label}
                                    detail={p.detail}
                                    meta={formatMoney(p.cents)}
                                />
                            ))}
                        </DetailSection>
                    ) : null}
                    {detail.tipShares.length > 0 ? (
                        <DetailSection title={d.tipsTo}>
                            {detail.tipShares.map((s) => (
                                <ListRow
                                    key={s.staffId}
                                    density="compact"
                                    title={s.name}
                                    meta={formatMoney(s.cents)}
                                />
                            ))}
                        </DetailSection>
                    ) : null}
                    <DetailSection title={d.receiptSection}>
                        <Text style={styles.soft}>{detail.receipt ?? d.noReceipt}</Text>
                        <Text style={styles.note}>{d.rungBy(detail.rungBy)}</Text>
                    </DetailSection>
                </>
            )}
        </DetailView>
    );
}

const styles = StyleSheet.create({
    stack: { gap: 12 },
    row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    stats: { flexDirection: "row", gap: 12 },
    name: { color: c.ink, fontSize: 15, fontWeight: "600" },
    money: { color: c.ink, fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
    soft: { color: c.inkSoft, fontSize: 14 },
    note: { color: c.muted, fontSize: 12 },
    card: {
        gap: 6,
        padding: 14,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
    },
});
