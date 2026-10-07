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
import {
    Avatar,
    Button,
    Choice,
    Empty,
    Icon,
    ItemTile,
    LoadFailed,
    Modal,
    Panel,
    SearchField,
    Skeleton,
    StatusPill,
    Tabs,
} from "@clientbridge/ui";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { SellEntitlement } from "../components/EntitlementSales";
import { SalesBoard, SalesHistory } from "../components/SaleOrders";
import { PaySheet, TicketPanel } from "../components/SaleTicket";
import { api, apiBaseUrl } from "../lib/api";
import { useViewer } from "../lib/auth";
import { useOpenLink } from "../lib/links";

const d = strings.pos.desk;

/** Sales: the register, the front desk board and (for owners and admins) the sales history. */
export function POS() {
    const viewer = useViewer();
    const role = viewer?.role ?? null;
    const sale = useSale(api, {
        role,
        viewerStaffId: viewer?.staffId ?? null,
        platform: "web",
    });
    const items = useCatalogItems();
    const views = salesViewsFor(role);
    const [params, setParams] = useSearchParams();
    const asked = params.get("view");
    const view: SalesView = views.some((v) => v.key === asked) ? (asked as SalesView) : "register";
    const show = (next: SalesView): void => {
        setParams(next === "register" ? {} : { view: next }, { replace: true });
    };
    const resume = (order: OrderOut): void => {
        sale.resume(order, items);
        show("register");
    };

    return (
        <div className="space-y-5">
            <Tabs items={views} active={view} onSelect={show} variant="pill" label={d.title} />
            {view === "register" ? (
                <Register sale={sale} />
            ) : view === "board" ? (
                <SalesBoard onResume={resume} />
            ) : (
                <SalesHistory onResume={resume} />
            )}
        </div>
    );
}

function VisitRow({
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
        <div className={`flex items-center gap-3 px-4 py-3 ${onTicket ? "bg-accent-weak/50" : ""}`}>
            <div className="w-24 shrink-0 whitespace-nowrap">
                <p className="text-sm font-semibold text-ink">{formatTime(v.start)}</p>
                <p className="text-xs text-muted">{d.endsAt(formatTime(v.end))}</p>
            </div>
            <span
                className="h-10 w-1 shrink-0 rounded-full bg-line"
                style={v.line.color === null ? undefined : { backgroundColor: v.line.color }}
            />
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{v.clientName}</p>
                <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted">
                    <Avatar name={v.staffName} size="sm" color={v.staffColor} />
                    <span className="truncate">
                        {v.itemName} · {formatMoney(v.priceCents)}
                        {v.depositCents > 0
                            ? ` · ${d.depositCredit(formatMoney(v.depositCents))}`
                            : ""}
                    </span>
                </p>
            </div>
            <StatusPill status={st.label} intent={st.intent} asWritten />
            <div className="w-24 shrink-0 text-right">
                {v.state === "paid" ? null : onTicket ? (
                    <span className="inline-flex items-center gap-1 text-sm font-medium text-accent">
                        <Icon name="check" size={15} />
                        {d.onTicket}
                    </span>
                ) : (
                    <Button
                        size="sm"
                        variant={v.state === "upcoming" ? "outline" : "primary"}
                        onPress={onCheckOut}
                    >
                        {d.checkOut}
                    </Button>
                )}
            </div>
        </div>
    );
}

const PLAN_KINDS: { key: WalletKind; label: string; icon: "tag" | "box" | "repeat" }[] = [
    { key: "gift_card", label: d.sellGiftCard, icon: "tag" },
    { key: "package", label: d.sellPackage, icon: "box" },
    { key: "membership", label: d.sellMembership, icon: "repeat" },
];

function Register({ sale }: { sale: SaleTicket }) {
    const queue = useCheckoutQueue();
    const catalog = useRegisterCatalog();
    const openLink = useOpenLink();
    const [paying, setPaying] = useState(false);
    const [selling, setSelling] = useState<WalletKind | null>(null);
    const onTicket = (id: string): number =>
        sale.lines.filter((l) => l.itemId === id).reduce((n, l) => n + l.quantity, 0);

    return (
        <div className="flex items-start gap-6">
            <section className="min-w-0 flex-1 space-y-8">
                <div className="flex items-start justify-between gap-4">
                    <h2 className="font-display text-xl font-bold text-ink">{d.newSaleTitle}</h2>
                    <Button variant="outline" icon="user" onPress={sale.newSale}>
                        {d.walkInSale}
                    </Button>
                </div>
                <Panel flush title={d.todaysVisits} subtitle={d.todaysVisitsHint}>
                    {queue.load.state === "loading" ? (
                        <Skeleton variant="row" count={4} label={d.loadingVisits} />
                    ) : queue.load.state === "error" ? (
                        <LoadFailed message={d.visitsError} body={d.catalogErrorBody} />
                    ) : queue.visits.every((v) => v.state === "paid") ? (
                        <Empty message={d.noVisits} />
                    ) : (
                        <div className="divide-y divide-line-soft">
                            {queue.visits.map((v) => (
                                <VisitRow
                                    key={v.bookingId}
                                    v={v}
                                    onTicket={sale.hasVisit(v.bookingId)}
                                    onCheckOut={() => {
                                        sale.addVisit(v);
                                    }}
                                />
                            ))}
                        </div>
                    )}
                </Panel>

                <div>
                    <div className="flex flex-wrap items-end justify-between gap-4">
                        <h2 className="font-display text-base font-bold text-ink">{d.addExtras}</h2>
                        <div className="w-64">
                            <SearchField
                                value={catalog.q}
                                onChange={catalog.setQ}
                                placeholder={d.searchShort}
                            />
                        </div>
                    </div>
                    <div className="mt-3">
                        <Choice
                            label={d.addExtras}
                            options={catalog.filters}
                            value={catalog.filter}
                            onChange={catalog.setFilter}
                        />
                    </div>
                    <div className="mt-3">
                        {catalog.load.state === "loading" ? (
                            <Skeleton variant="row" count={3} label={d.loadingCatalog} />
                        ) : catalog.items.length === 0 ? (
                            <Empty
                                variant="card"
                                icon="box"
                                message={catalog.empty}
                                {...(catalog.q === ""
                                    ? {
                                          body: d.noItemsBody,
                                          actions: (
                                              <Button
                                                  variant="outline"
                                                  size="sm"
                                                  onPress={() => {
                                                      openLink("catalog");
                                                  }}
                                              >
                                                  {d.addCatalog}
                                              </Button>
                                          ),
                                      }
                                    : {})}
                            />
                        ) : (
                            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                                {catalog.items.map((item) => {
                                    const out = saleTileOut(item);
                                    return (
                                        <ItemTile
                                            key={item.id}
                                            name={item.name}
                                            imageSrc={mediaUrl(apiBaseUrl, item.image_file_id)}
                                            color={item.color}
                                            cents={item.price_cents}
                                            meta={saleTileMeta(item)}
                                            count={onTicket(item.id)}
                                            tag={
                                                out
                                                    ? { label: d.outOfStock, intent: "danger" }
                                                    : null
                                            }
                                            onPress={() => {
                                                sale.addItem(item);
                                            }}
                                        />
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3">
                    <div>
                        <p className="text-sm font-semibold text-ink">{d.alsoSell}</p>
                        <p className="text-xs text-muted">{d.alsoSellHint}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {PLAN_KINDS.map((k) => (
                            <Button
                                key={k.key}
                                size="sm"
                                variant="outline"
                                icon={k.icon}
                                onPress={() => {
                                    setSelling(k.key);
                                }}
                            >
                                {k.label}
                            </Button>
                        ))}
                    </div>
                </div>
            </section>

            <TicketPanel
                sale={sale}
                onCharge={() => {
                    setPaying(true);
                }}
            />
            {paying ? (
                <PaySheet
                    sale={sale}
                    onClose={() => {
                        setPaying(false);
                    }}
                    onBookNext={() => {
                        setPaying(false);
                        openLink("booking");
                    }}
                />
            ) : null}
            {selling !== null ? (
                <Modal
                    open
                    size="lg"
                    onClose={() => {
                        setSelling(null);
                    }}
                >
                    <SellEntitlement
                        kind={selling}
                        clientId={sale.clientId}
                        onClose={() => {
                            setSelling(null);
                        }}
                    />
                </Modal>
            ) : null}
        </div>
    );
}
