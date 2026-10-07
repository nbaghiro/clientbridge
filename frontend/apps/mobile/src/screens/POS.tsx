import {
    type CheckoutVisit,
    type OrderOut,
    type SaleTicket,
    type SalesView,
    VISIT_STATE,
    type WalletKind,
    formatMoney,
    formatTime,
    mediaUrl,
    saleTileMeta,
    saleTileOut,
    salesViewsFor,
    strings,
    useCatalogItems,
    useCheckoutQueue,
    useRegisterCatalog,
    useSale,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
    Button,
    Choice,
    Empty,
    ItemTile,
    LoadFailed,
    Modal,
    SearchField,
    Skeleton,
    StatusPill,
    Tabs,
} from "@clientbridge/ui";

import { SellEntitlement } from "../components/EntitlementSales";
import { SalesBoard, SalesHistory } from "../components/SaleOrders";
import { TicketSheet } from "../components/SaleTicket";
import { api, apiBaseUrl } from "../lib/api";
import { useViewer } from "../lib/auth";
import { useOpenLink } from "../lib/links";

const d = strings.pos.desk;
const c = theme.colors;

/** Sales on a phone: the register, the front desk board and, for owners and admins, history. */
export function POS() {
    const viewer = useViewer();
    const role = viewer?.role ?? null;
    const sale = useSale(api, {
        role,
        viewerStaffId: viewer?.staffId ?? null,
        platform: "mobile",
    });
    const items = useCatalogItems();
    const views = salesViewsFor(role);
    const [view, setView] = useState<SalesView>("register");
    const [ticketOpen, setTicketOpen] = useState(false);
    const resume = (order: OrderOut): void => {
        sale.resume(order, items);
        setView("register");
        setTicketOpen(true);
    };
    return (
        <View style={styles.screen}>
            <Tabs items={views} active={view} onSelect={setView} variant="pill" label={d.title} />
            {view === "register" ? (
                <Register sale={sale} ticketOpen={ticketOpen} setTicketOpen={setTicketOpen} />
            ) : (
                <ScrollView contentContainerStyle={styles.body}>
                    {view === "board" ? (
                        <SalesBoard onResume={resume} />
                    ) : (
                        <SalesHistory onResume={resume} />
                    )}
                </ScrollView>
            )}
        </View>
    );
}

function VisitCard({
    v,
    onTicket,
    onCheckOut,
}: {
    v: CheckoutVisit;
    onTicket: boolean;
    onCheckOut: () => void;
}) {
    const st = VISIT_STATE[v.state];
    return (
        <View style={[styles.visit, onTicket ? styles.visitOn : null]}>
            <View style={styles.row}>
                <Text style={styles.soft}>
                    <Text style={styles.strong}>{formatTime(v.start)}</Text>{" "}
                    {d.endsAt(formatTime(v.end))}
                </Text>
                <StatusPill status={st.label} intent={st.intent} asWritten />
            </View>
            <Text style={styles.name}>{v.clientName}</Text>
            <Text style={styles.soft}>
                {`${v.staffName} · ${v.itemName} · ${formatMoney(v.priceCents)}`}
            </Text>
            {v.depositCents > 0 ? (
                <Text style={styles.ok}>{d.depositCredit(formatMoney(v.depositCents))}</Text>
            ) : null}
            {v.state === "paid" ? null : onTicket ? (
                <Text style={styles.accent}>{d.onTicket}</Text>
            ) : (
                <View style={styles.left}>
                    <Button size="sm" variant="outline" onPress={onCheckOut}>
                        {d.checkOut}
                    </Button>
                </View>
            )}
        </View>
    );
}

const PLAN_KINDS: { key: WalletKind; label: string }[] = [
    { key: "gift_card", label: d.sellGiftCard },
    { key: "package", label: d.sellPackage },
    { key: "membership", label: d.sellMembership },
];

function Register({
    sale,
    ticketOpen,
    setTicketOpen,
}: {
    sale: SaleTicket;
    ticketOpen: boolean;
    setTicketOpen: (open: boolean) => void;
}) {
    const queue = useCheckoutQueue();
    const catalog = useRegisterCatalog();
    const openLink = useOpenLink();
    const [selling, setSelling] = useState<WalletKind | null>(null);
    const onTicket = (id: string): number =>
        sale.lines.filter((l) => l.itemId === id).reduce((n, l) => n + l.quantity, 0);
    return (
        <View style={styles.screen}>
            <ScrollView contentContainerStyle={styles.body}>
                <View style={styles.row}>
                    <Text style={styles.title}>{d.newSaleTitle}</Text>
                    <Button size="sm" variant="outline" onPress={sale.newSale}>
                        {d.walkInSale}
                    </Button>
                </View>
                <Text style={styles.heading}>{d.todaysVisits.toUpperCase()}</Text>
                {queue.load.state === "loading" ? (
                    <Skeleton variant="row" count={3} label={d.loadingVisits} />
                ) : queue.load.state === "error" ? (
                    <LoadFailed message={d.visitsError} body={d.catalogErrorBody} />
                ) : queue.visits.every((v) => v.state === "paid") ? (
                    <Empty message={d.noVisits} />
                ) : (
                    queue.visits.map((v) => (
                        <VisitCard
                            key={v.bookingId}
                            v={v}
                            onTicket={sale.hasVisit(v.bookingId)}
                            onCheckOut={() => {
                                sale.addVisit(v);
                            }}
                        />
                    ))
                )}
                <Text style={styles.heading}>{d.addExtras.toUpperCase()}</Text>
                <SearchField
                    value={catalog.q}
                    onChange={catalog.setQ}
                    placeholder={d.searchShort}
                />
                <Choice
                    label={d.addExtras}
                    options={catalog.filters}
                    value={catalog.filter}
                    onChange={catalog.setFilter}
                />
                {catalog.load.state === "loading" ? (
                    <Skeleton variant="row" count={2} label={d.loadingCatalog} />
                ) : catalog.items.length === 0 ? (
                    <Empty message={catalog.empty} />
                ) : (
                    <View style={styles.grid}>
                        {catalog.items.map((item) => {
                            const out = saleTileOut(item);
                            return (
                                <View key={item.id} style={styles.cell}>
                                    <ItemTile
                                        name={item.name}
                                        imageSrc={mediaUrl(apiBaseUrl, item.image_file_id)}
                                        color={item.color}
                                        cents={item.price_cents}
                                        meta={saleTileMeta(item)}
                                        count={onTicket(item.id)}
                                        tag={out ? { label: d.outOfStock, intent: "danger" } : null}
                                        onPress={() => {
                                            sale.addItem(item);
                                        }}
                                    />
                                </View>
                            );
                        })}
                    </View>
                )}
                <Text style={styles.heading}>{d.alsoSell.toUpperCase()}</Text>
                <Text style={styles.note}>{d.alsoSellHint}</Text>
                <View style={styles.wrap}>
                    {PLAN_KINDS.map((k) => (
                        <Button
                            key={k.key}
                            size="sm"
                            variant="outline"
                            onPress={() => {
                                setSelling(k.key);
                            }}
                        >
                            {k.label}
                        </Button>
                    ))}
                </View>
            </ScrollView>
            {sale.isEmpty ? null : (
                <View style={styles.bar}>
                    <View style={styles.grow}>
                        <Text style={styles.strong}>{d.items(sale.itemCount)}</Text>
                        <Text style={styles.note}>{sale.client?.name ?? d.walkIn}</Text>
                    </View>
                    <Button
                        size="lg"
                        onPress={() => {
                            setTicketOpen(true);
                        }}
                    >
                        {d.charge(formatMoney(sale.totals.dueCents))}
                    </Button>
                </View>
            )}
            <TicketSheet
                sale={sale}
                open={ticketOpen}
                onClose={() => {
                    setTicketOpen(false);
                }}
                onBookNext={() => {
                    openLink("booking");
                }}
            />
            <Modal
                open={selling !== null}
                size="xl"
                onClose={() => {
                    setSelling(null);
                }}
            >
                {selling === null ? null : (
                    <SellEntitlement
                        kind={selling}
                        clientId={sale.clientId}
                        onClose={() => {
                            setSelling(null);
                        }}
                    />
                )}
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    body: { gap: 12, padding: 16, paddingBottom: 32 },
    row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    left: { flexDirection: "row" },
    grow: { flex: 1 },
    title: { color: c.ink, fontSize: 24, fontWeight: "700" },
    heading: { color: c.muted, fontSize: 11, fontWeight: "600", letterSpacing: 0.6, marginTop: 8 },
    name: { color: c.ink, fontSize: 16, fontWeight: "600" },
    strong: { color: c.ink, fontSize: 14, fontWeight: "600" },
    soft: { color: c.inkSoft, fontSize: 14 },
    note: { color: c.muted, fontSize: 12 },
    ok: { color: c.okFg, fontSize: 13, fontWeight: "600" },
    accent: { color: c.accent, fontSize: 14, fontWeight: "600" },
    visit: {
        gap: 4,
        padding: 14,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
    },
    visitOn: { borderColor: c.accent, backgroundColor: c.accentWeak },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    cell: { width: "48%" },
    bar: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderTopWidth: 1,
        borderTopColor: c.border,
        backgroundColor: c.surface,
    },
});
