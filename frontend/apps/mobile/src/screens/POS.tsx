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
    strings,
    useCatalogItems,
    useCheckoutQueue,
    useLinkedVisit,
    usePackageCover,
    useRegisterCatalog,
    useSale,
    useSalesViews,
    formatParts,
    BUSINESS_CURRENCY,
    useBusinessZone,
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
    Notice,
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
import { useBookAgain, useOpenLink } from "../lib/links";

const d = strings.pos.desk;
const c = theme.colors;

/** Sales on a phone: the register, the front desk board and, for owners and admins, history. */
export function POS({ linked }: { linked?: string | undefined }) {
    const viewer = useViewer();
    const role = viewer?.role ?? null;
    const sale = useSale(api, {
        viewerStaffId: viewer?.staffId ?? null,
        platform: "mobile",
        role,
    });
    const items = useCatalogItems();
    const views = useSalesViews(role);
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
                <Register
                    sale={sale}
                    linked={linked ?? null}
                    ticketOpen={ticketOpen}
                    setTicketOpen={setTicketOpen}
                />
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
    onCover,
    covering,
}: {
    v: CheckoutVisit;
    onTicket: boolean;
    onCheckOut: () => void;
    onCover: (() => void) | null;
    covering: boolean;
}) {
    const zone = useBusinessZone();
    const st = VISIT_STATE[v.state];
    return (
        <View style={[styles.visit, onTicket ? styles.visitOn : null]}>
            <View style={styles.time}>
                <Text style={styles.strong} numberOfLines={1}>
                    {formatTime(v.start, zone)}
                </Text>
                <Text style={styles.note} numberOfLines={1}>
                    {formatTime(v.end, zone)}
                </Text>
            </View>
            <View style={styles.grow}>
                <Text style={styles.name} numberOfLines={1}>
                    {v.clientName}
                </Text>
                <Text style={styles.note} numberOfLines={1}>
                    {formatParts([
                        v.itemName,
                        formatMoney(v.priceCents, BUSINESS_CURRENCY),
                        v.depositCents > 0
                            ? d.depositCredit(formatMoney(v.depositCents, BUSINESS_CURRENCY))
                            : null,
                    ])}
                </Text>
            </View>
            {onCover === null ? null : (
                <Button
                    style={{ alignSelf: "center" }}
                    size="sm"
                    variant="outline"
                    busy={covering}
                    onPress={onCover}
                >
                    {d.usePackage}
                </Button>
            )}
            {onTicket ? (
                <Text style={styles.accent}>{d.onTicket}</Text>
            ) : v.state === "upcoming" ? (
                <StatusPill style={{ alignSelf: "center" }} status={st.label} intent={st.intent} />
            ) : (
                <Button style={{ alignSelf: "center" }} size="sm" onPress={onCheckOut}>
                    {d.checkOut}
                </Button>
            )}
        </View>
    );
}

const PLAN_KINDS: { key: WalletKind; label: string; icon: "tag" | "box" | "repeat" }[] = [
    {
        key: "gift_card",
        get label() {
            return d.sellGiftCard;
        },
        icon: "tag",
    },
    {
        key: "package",
        get label() {
            return d.sellPackage;
        },
        icon: "box",
    },
    {
        key: "membership",
        get label() {
            return d.sellMembership;
        },
        icon: "repeat",
    },
];

function Register({
    sale,
    linked,
    ticketOpen,
    setTicketOpen,
}: {
    sale: SaleTicket;
    linked: string | null;
    ticketOpen: boolean;
    setTicketOpen: (open: boolean) => void;
}) {
    const queue = useCheckoutQueue();
    const cover = usePackageCover(api);
    useLinkedVisit(linked, queue, (visit) => {
        sale.addVisit(visit);
        setTicketOpen(true);
    });
    const catalog = useRegisterCatalog();
    const openLink = useOpenLink();
    const bookAgain = useBookAgain();
    const visitId = sale.visitId;
    const [selling, setSelling] = useState<WalletKind | null>(null);
    const onTicket = (id: string): number =>
        sale.lines.filter((l) => l.itemId === id).reduce((n, l) => n + l.quantity, 0);
    const waiting = queue.visits.filter((v) => v.state !== "paid");
    const noCatalog = catalog.load.state === "empty";
    return (
        <View style={styles.screen}>
            {noCatalog ? null : (
                <View style={styles.tools}>
                    <SearchField
                        value={catalog.q}
                        onChange={catalog.setQ}
                        placeholder={d.searchShort}
                    />
                    <Choice
                        layout="segmented"
                        label={d.addExtras}
                        options={catalog.filters}
                        value={catalog.filter}
                        onChange={catalog.setFilter}
                    />
                </View>
            )}
            <ScrollView contentContainerStyle={styles.body}>
                {queue.load.state === "error" ? (
                    <LoadFailed message={d.visitsError} body={d.catalogErrorBody} />
                ) : waiting.length > 0 ? (
                    <>
                        <Text style={styles.heading}>{d.todaysVisits}</Text>
                        {cover.error !== null ? <Notice tone="danger">{cover.error}</Notice> : null}
                        <View style={styles.visits}>
                            {waiting.map((v) => (
                                <VisitCard
                                    key={v.bookingId}
                                    v={v}
                                    onTicket={sale.hasVisit(v.bookingId)}
                                    onCheckOut={() => {
                                        sale.addVisit(v);
                                    }}
                                    covering={cover.busy === v.bookingId}
                                    onCover={
                                        v.packageId !== null &&
                                        (v.state === "ready" || v.state === "inProgress")
                                            ? () => {
                                                  cover.cover(v, () => {
                                                      const line = sale.lines.find(
                                                          (l) => l.bookingId === v.bookingId,
                                                      );
                                                      if (line !== undefined)
                                                          sale.removeLine(line.key);
                                                  });
                                              }
                                            : null
                                    }
                                />
                            ))}
                        </View>
                    </>
                ) : null}
                {catalog.load.state === "loading" ? (
                    <Skeleton variant="row" count={2} label={d.loadingCatalog} />
                ) : noCatalog ? (
                    <Empty
                        variant="card"
                        icon="box"
                        message={catalog.empty}
                        body={d.noItemsBody}
                        actions={
                            <Button
                                size="sm"
                                onPress={() => {
                                    openLink("catalog");
                                }}
                            >
                                {d.addCatalog}
                            </Button>
                        }
                    />
                ) : catalog.items.length === 0 ? (
                    <Empty message={catalog.empty} />
                ) : (
                    <View style={styles.grid}>
                        {catalog.items.map((item) => {
                            const out = saleTileOut(item);
                            return (
                                <View key={item.id} style={styles.cell}>
                                    <ItemTile
                                        currency={BUSINESS_CURRENCY}
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
                {noCatalog ? null : (
                    <View style={styles.plans}>
                        <Text style={styles.note}>{d.alsoSell}</Text>
                        <View style={styles.wrap}>
                            {PLAN_KINDS.map((k) => (
                                <Button
                                    key={k.key}
                                    size="sm"
                                    variant="quiet"
                                    icon={k.icon}
                                    onPress={() => {
                                        setSelling(k.key);
                                    }}
                                >
                                    {k.label}
                                </Button>
                            ))}
                        </View>
                    </View>
                )}
            </ScrollView>
            {sale.isEmpty ? null : (
                <View style={styles.bar}>
                    <View style={styles.grow}>
                        <Text style={styles.strong}>{d.items(sale.itemCount)}</Text>
                        <Text style={styles.note}>{sale.client?.name ?? d.walkIn}</Text>
                    </View>
                    <Button
                        style={{ alignSelf: "center" }}
                        size="lg"
                        onPress={() => {
                            setTicketOpen(true);
                        }}
                    >
                        {d.charge(formatMoney(sale.totals.dueCents, BUSINESS_CURRENCY))}
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
                    if (visitId === null) openLink("booking");
                    else bookAgain(visitId);
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
    heading: {
        color: c.muted,
        fontSize: 11,
        fontWeight: "600",
        letterSpacing: 0.6,
        textTransform: "uppercase",
    },
    name: { color: c.ink, fontSize: 15, fontWeight: "600" },
    strong: { color: c.ink, fontSize: 14, fontWeight: "600" },
    note: { color: c.muted, fontSize: 12 },
    accent: { color: c.accent, fontSize: 13, fontWeight: "600" },
    tools: {
        gap: 10,
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: c.border,
    },
    time: { width: 72 },
    visits: {
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
        overflow: "hidden",
    },
    visit: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: c.borderSoft,
    },
    visitOn: { backgroundColor: c.accentWeak },
    plans: { gap: 6, marginTop: 4 },
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
