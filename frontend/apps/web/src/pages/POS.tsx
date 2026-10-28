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
    openTask,
    usePackageCover,
    usePeoplePhotos,
    useRegisterCatalog,
    useSale,
    useSalesViews,
    formatParts,
    BUSINESS_CURRENCY,
    useBusinessZone,
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
    Notice,
    Panel,
    SearchField,
    Skeleton,
    StatusPill,
} from "@clientbridge/ui";
import { type ReactNode, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { SellEntitlement } from "../components/EntitlementSales";
import { SalesBoard, SalesHistory } from "../components/SaleOrders";
import { DeskBar } from "../components/Desk";
import { TicketPanel } from "../components/SaleTicket";
import { api, apiBaseUrl } from "../lib/api";
import { useViewer } from "../lib/auth";
import { useOpenLink } from "../lib/links";

const d = strings.pos.desk;

/** Sales: the register, the front desk board and (for owners and admins) the sales history. */
export function POS() {
    const viewer = useViewer();
    const role = viewer?.role ?? null;
    const sale = useSale(api, {
        viewerStaffId: viewer?.staffId ?? null,
        platform: "web",
        role,
    });
    const items = useCatalogItems();
    const views = useSalesViews(role);
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

    const switcher = (
        <Choice<SalesView>
            layout="segmented"
            label={d.title}
            options={views.map((v) => ({ key: v.key, label: v.label }))}
            value={view}
            onChange={show}
        />
    );

    return (
        <div className="space-y-6">
            {view === "register" ? null : <DeskBar switcher={switcher} />}
            {view === "register" ? (
                <Register sale={sale} switcher={switcher} />
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
    onCover,
    covering,
}: {
    v: CheckoutVisit;
    onTicket: boolean;
    onCheckOut: () => void;
    onCover: (() => void) | null;
    covering: boolean;
}) {
    const photos = usePeoplePhotos();
    const zone = useBusinessZone();
    const st = VISIT_STATE[v.state];
    return (
        <div className={`flex items-center gap-3 px-4 py-3 ${onTicket ? "bg-accent-weak/50" : ""}`}>
            <div className="w-24 shrink-0 whitespace-nowrap">
                <p className="text-sm font-semibold text-ink">{formatTime(v.start, zone)}</p>
                <p className="text-xs text-muted">{d.endsAt(formatTime(v.end, zone))}</p>
            </div>
            <span
                className="h-10 w-1 shrink-0 rounded-full bg-line"
                style={v.line.color === null ? undefined : { backgroundColor: v.line.color }}
            />
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{v.clientName}</p>
                <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted">
                    <Avatar
                        name={v.staffName}
                        src={photos.staff(v.staffId)}
                        size="sm"
                        color={v.staffColor}
                    />
                    <span className="truncate">
                        {formatParts([
                            v.itemName,
                            formatMoney(v.priceCents, BUSINESS_CURRENCY),
                            v.depositCents > 0
                                ? d.depositCredit(formatMoney(v.depositCents, BUSINESS_CURRENCY))
                                : null,
                        ])}
                    </span>
                </p>
            </div>
            <StatusPill status={st.label} intent={st.intent} />
            {onCover === null ? null : (
                <Button size="sm" variant="outline" busy={covering} onPress={onCover}>
                    {d.usePackage}
                </Button>
            )}
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

function Register({ sale, switcher }: { sale: SaleTicket; switcher: ReactNode }) {
    const queue = useCheckoutQueue();
    const cover = usePackageCover(api);
    const visitId = sale.visitId;
    const catalog = useRegisterCatalog();
    const openLink = useOpenLink();
    const [selling, setSelling] = useState<WalletKind | null>(null);
    const onTicket = (id: string): number =>
        sale.lines.filter((l) => l.itemId === id).reduce((n, l) => n + l.quantity, 0);
    const waiting = queue.visits.filter((v) => v.state !== "paid");
    const noCatalog = catalog.load.state === "empty";

    return (
        <div className="flex items-start gap-6">
            <section className="min-w-0 flex-1 space-y-5">
                <DeskBar
                    switcher={
                        <div className="flex flex-wrap items-center gap-3">
                            {switcher}
                            {noCatalog ? null : (
                                <Choice
                                    layout="segmented"
                                    label={d.addExtras}
                                    options={catalog.filters}
                                    value={catalog.filter}
                                    onChange={catalog.setFilter}
                                />
                            )}
                        </div>
                    }
                    action={
                        noCatalog ? null : (
                            <SearchField
                                className="w-full sm:w-48"
                                value={catalog.q}
                                onChange={catalog.setQ}
                                placeholder={d.searchShort}
                            />
                        )
                    }
                />
                {queue.load.state === "error" ? (
                    <LoadFailed message={d.visitsError} body={d.catalogErrorBody} />
                ) : waiting.length > 0 ? (
                    <section className="space-y-2">
                        {cover.error !== null ? <Notice tone="danger">{cover.error}</Notice> : null}
                        <Panel flush title={d.todaysVisits} subtitle={d.todaysVisitsHint}>
                            <div className="divide-y divide-line-soft">
                                {waiting.map((v) => (
                                    <VisitRow
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
                            </div>
                        </Panel>
                    </section>
                ) : null}
                {catalog.load.state === "loading" ? (
                    <Skeleton
                        variant="tile"
                        count={8}
                        label={d.loadingCatalog}
                        className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-4"
                    />
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
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-4">
                        {catalog.items.map((item) => {
                            const out = saleTileOut(item);
                            return (
                                <ItemTile
                                    currency={BUSINESS_CURRENCY}
                                    key={item.id}
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
                            );
                        })}
                    </div>
                )}
                {noCatalog ? null : (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1">
                        <span className="text-xs text-muted">{d.alsoSell}</span>
                        <div className="flex flex-wrap gap-1">
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
                        </div>
                    </div>
                )}
            </section>

            <TicketPanel
                sale={sale}
                onBookNext={() => {
                    openTask(
                        visitId === null
                            ? { kind: "booking" }
                            : { kind: "booking", rebookId: visitId },
                    );
                }}
            />
            {selling !== null ? (
                <Modal
                    variant="drawer"
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
