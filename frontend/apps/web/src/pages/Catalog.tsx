import {
    type ItemRow,
    KIND_LABEL,
    type ProductFilter,
    formatMoney,
    itemMeta,
    itemPriceLabel,
    itemStatus,
    mediaUrl,
    sellsOnline,
    stockScale,
    strings,
    useCatalogView,
    useKindPicker,
    useProductsView,
} from "@clientbridge/app-core";
import {
    Badge,
    Button,
    Choice,
    Empty,
    Icon,
    ItemImage,
    ListPage,
    Meter,
    Modal,
    SearchField,
    StatusPill,
    Tabs,
} from "@clientbridge/ui";
import { useState } from "react";

import { ItemEditor } from "../components/ItemEditor";
import { Inventory, Loaded, Toolbar } from "../components/Stock";
import { apiBaseUrl } from "../lib/api";

const s = strings.catalog;

type View = "catalog" | "products" | "inventory";

const VIEWS: { key: View; label: string }[] = [
    { key: "catalog", label: s.views.catalog },
    { key: "products", label: s.views.products },
    { key: "inventory", label: s.views.inventory },
];

interface Open {
    item: ItemRow | null;
    kind: string;
}

export function Catalog() {
    const [view, setView] = useState<View>("catalog");
    return (
        <div className="space-y-5">
            <Tabs items={VIEWS} active={view} onSelect={setView} label={s.viewsLabel} />
            {view === "catalog" ? <CatalogList /> : null}
            {view === "products" ? <ProductTable /> : null}
            {view === "inventory" ? <Inventory /> : null}
        </div>
    );
}

const CATALOG_GRID =
    "grid grid-cols-[minmax(0,2.4fr)_minmax(0,0.9fr)_minmax(0,1fr)_8.5rem] items-center gap-4";

function CatalogRow({ item }: { item: ItemRow }) {
    const status = itemStatus(item);
    return (
        <div className={`${CATALOG_GRID} ${item.active === 1 ? "" : "opacity-60"}`}>
            <div className="flex min-w-0 items-center gap-3">
                <ItemImage
                    src={mediaUrl(apiBaseUrl, item.image_file_id)}
                    name={item.name}
                    color={item.color}
                />
                <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{item.name}</p>
                    <p className="truncate text-xs text-muted">{itemMeta(item)}</p>
                </div>
            </div>
            <span>
                <Badge label={KIND_LABEL[item.kind] ?? item.kind} intent="neutral" />
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted">
                {status !== null ? (
                    <StatusPill status={status.label} intent={status.intent} asWritten />
                ) : sellsOnline(item) ? (
                    <>
                        <Icon name="check" size={14} color="var(--success)" />
                        {item.kind === "product" ? s.inShop : s.online}
                    </>
                ) : (
                    s.notOnline
                )}
            </span>
            <span className="text-right text-sm font-semibold whitespace-nowrap text-ink tabular-nums">
                {itemPriceLabel(item)}
            </span>
        </div>
    );
}

function KindPicker({ onClose, onPick }: { onClose: () => void; onPick: (kind: string) => void }) {
    const picker = useKindPicker();
    return (
        <Modal open size="lg" onClose={onClose}>
            <div className="space-y-4">
                <div>
                    <h2 className="font-display text-lg font-bold text-ink">{s.whatAdding}</h2>
                    <p className="mt-0.5 text-sm text-muted">{s.whatAddingHint}</p>
                </div>
                <Choice
                    layout="tiles"
                    columns={2}
                    label={s.whatAdding}
                    options={picker.options}
                    value={picker.kind}
                    onChange={picker.setKind}
                />
                <div className="flex justify-end gap-2 border-t border-line pt-4">
                    <Button variant="quiet" onPress={onClose}>
                        {s.cancel}
                    </Button>
                    <Button
                        disabled={picker.kind === null}
                        onPress={() => {
                            if (picker.kind !== null) onPick(picker.kind);
                        }}
                    >
                        {s.next}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

function CatalogList() {
    const view = useCatalogView();
    const [choosing, setChoosing] = useState(false);
    const [open, setOpen] = useState<Open | null>(null);
    const add = (
        <Button
            icon="plus"
            onPress={() => {
                setChoosing(true);
            }}
        >
            {s.addItem}
        </Button>
    );

    return (
        <div>
            <Toolbar summary={view.summary} actions={add} />
            <div className="mt-4">
                {view.load.state === "empty" ? (
                    <Empty
                        variant="card"
                        icon="tag"
                        message={s.emptyCatalogTitle}
                        body={s.emptyCatalogBody}
                        actions={add}
                    />
                ) : (
                    <Loaded load={view.load} label={s.loadingCatalog} error={s.loadErrorCatalog}>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <Choice
                                layout="segmented"
                                label={s.title}
                                options={view.filters}
                                value={view.filter}
                                onChange={view.setFilter}
                            />
                            <div className="w-full max-w-xs">
                                <SearchField
                                    value={view.q}
                                    onChange={view.setQ}
                                    placeholder={s.searchPlaceholder}
                                />
                            </div>
                        </div>
                        <div className="mt-5 space-y-6">
                            {view.sections.length === 0 ? (
                                <div className="rounded-lg border border-line bg-surface">
                                    <Empty message={view.empty} />
                                </div>
                            ) : null}
                            {view.sections.map((sec) => (
                                <section key={sec.key}>
                                    <div className="flex items-baseline justify-between px-1 pb-2">
                                        <h3 className="font-display text-base font-bold text-ink">
                                            {sec.title}
                                        </h3>
                                        <span className="text-xs text-muted">
                                            {s.countIn(sec.items.length)}
                                        </span>
                                    </div>
                                    <ListPage
                                        head={
                                            <div className={CATALOG_GRID}>
                                                <span>{s.colItem}</span>
                                                <span>{s.colType}</span>
                                                <span>{s.colOnline}</span>
                                                <span className="text-right">{s.colPrice}</span>
                                            </div>
                                        }
                                        rows={sec.items}
                                        rowKey={(i) => i.id}
                                        onRowPress={(i) => {
                                            setOpen({ item: i, kind: i.kind });
                                        }}
                                        empty={view.empty}
                                        renderRow={(i) => <CatalogRow item={i} />}
                                    />
                                </section>
                            ))}
                        </div>
                    </Loaded>
                )}
            </div>
            {choosing ? (
                <KindPicker
                    onClose={() => {
                        setChoosing(false);
                    }}
                    onPick={(kind) => {
                        setChoosing(false);
                        setOpen({ item: null, kind });
                    }}
                />
            ) : null}
            {open !== null ? (
                <ItemEditor
                    key={open.item?.id ?? `new-${open.kind}`}
                    item={open.item}
                    kind={open.kind}
                    items={view.items}
                    onClose={() => {
                        setOpen(null);
                    }}
                />
            ) : null}
        </div>
    );
}

const PRODUCT_GRID =
    "grid grid-cols-[minmax(0,2.2fr)_4.5rem_4.5rem_3.5rem_minmax(0,1.4fr)_2.5rem] items-center gap-3 xl:grid-cols-[minmax(0,2.2fr)_5rem_5rem_4.5rem_minmax(0,1.3fr)_4.5rem_3rem] xl:gap-4";

function ProductTable() {
    const view = useProductsView();
    const [open, setOpen] = useState<{ item: ItemRow | null } | null>(null);
    const add = (
        <Button
            icon="plus"
            onPress={() => {
                setOpen({ item: null });
            }}
        >
            {s.addProduct}
        </Button>
    );

    return (
        <div>
            <Toolbar summary={view.summary} actions={add} />
            <div className="mt-4">
                {view.load.state === "empty" ? (
                    <Empty
                        variant="card"
                        icon="bag"
                        message={s.emptyProductsTitle}
                        body={s.emptyProductsBody}
                        actions={add}
                    />
                ) : (
                    <Loaded load={view.load} label={s.loadingProducts} error={s.loadErrorProducts}>
                        <ListPage<(typeof view.rows)[number], ProductFilter>
                            segments={{
                                items: view.filters,
                                active: view.filter,
                                onSelect: view.setFilter,
                            }}
                            search={{
                                value: view.q,
                                onChange: view.setQ,
                                placeholder: s.searchPlaceholder,
                            }}
                            banner={
                                <div className="flex items-center gap-3 text-sm">
                                    <span className="text-muted">{s.sortBy}</span>
                                    <Choice
                                        label={s.sortBy}
                                        options={view.sorts}
                                        value={view.sort}
                                        onChange={view.setSort}
                                    />
                                </div>
                            }
                            head={
                                <div className={PRODUCT_GRID}>
                                    <span>{s.colProduct}</span>
                                    <span className="text-right">{s.colPrice}</span>
                                    <span className="text-right">{s.colCost}</span>
                                    <span className="text-right">{s.colMargin}</span>
                                    <span>{s.colStock}</span>
                                    <span className="hidden text-right xl:block">{s.colSold}</span>
                                    <span className="text-center">{s.colShop}</span>
                                </div>
                            }
                            rows={view.rows}
                            rowKey={(r) => r.item.id}
                            onRowPress={(r) => {
                                setOpen({ item: r.item });
                            }}
                            empty={view.empty}
                            renderRow={(r) => (
                                <div
                                    className={`${PRODUCT_GRID} ${r.item.active === 1 ? "" : "opacity-60"}`}
                                >
                                    <div className="flex min-w-0 items-center gap-3">
                                        <ItemImage
                                            src={mediaUrl(apiBaseUrl, r.item.image_file_id)}
                                            name={r.item.name}
                                            color={r.item.color}
                                            size={36}
                                        />
                                        <div className="min-w-0">
                                            <p className="truncate font-medium text-ink">
                                                {r.item.name}
                                            </p>
                                            <p className="truncate text-xs text-muted tabular-nums">
                                                {r.item.sku}
                                            </p>
                                        </div>
                                    </div>
                                    <span className="text-right font-semibold text-ink tabular-nums">
                                        {formatMoney(r.item.price_cents)}
                                    </span>
                                    <span className="text-right text-ink-soft tabular-nums">
                                        {r.item.cost_cents === null
                                            ? ""
                                            : formatMoney(r.item.cost_cents)}
                                    </span>
                                    <span
                                        className={`text-right font-medium tabular-nums ${
                                            r.marginPct !== null && r.marginPct < 30
                                                ? "text-warn-fg"
                                                : "text-ink"
                                        }`}
                                    >
                                        {r.marginPct === null ? "" : s.marginPct(r.marginPct)}
                                    </span>
                                    <span className="min-w-0">
                                        {r.stock !== null && r.onHand !== null ? (
                                            <Meter
                                                value={Math.max(0, r.onHand)}
                                                max={stockScale(r.onHand, r.item.low_stock_at)}
                                                marker={r.item.low_stock_at}
                                                intent={r.stock.intent}
                                                label={r.stock.label}
                                                labelPosition="beside"
                                                size="sm"
                                            />
                                        ) : (
                                            <span className="text-xs text-muted">
                                                {s.untracked}
                                            </span>
                                        )}
                                    </span>
                                    <span className="hidden text-right text-ink-soft tabular-nums xl:block">
                                        {r.sold30}
                                    </span>
                                    <span className="flex justify-center">
                                        {r.item.sell_online === 1 ? (
                                            <Icon
                                                name="check"
                                                size={16}
                                                color="var(--success)"
                                                label={s.inShop}
                                            />
                                        ) : null}
                                    </span>
                                </div>
                            )}
                        />
                    </Loaded>
                )}
            </div>
            {open !== null ? (
                <ItemEditor
                    key={open.item?.id ?? "new"}
                    item={open.item}
                    kind="product"
                    items={[]}
                    onClose={() => {
                        setOpen(null);
                    }}
                />
            ) : null}
        </div>
    );
}
