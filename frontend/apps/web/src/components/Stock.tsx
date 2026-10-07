import {
    type ItemRow,
    type Load,
    type StockRowView,
    formatMoney,
    mediaUrl,
    stockScale,
    strings,
    useInventory,
    useReceiveDelivery,
    useRestockForm,
    useStockMoves,
} from "@clientbridge/app-core";
import {
    ActivityTimeline,
    Badge,
    Button,
    Empty,
    IconButton,
    ItemImage,
    ListRow,
    LoadFailed,
    Meter,
    Modal,
    Notice,
    Panel,
    SearchField,
    Skeleton,
    Stat,
    TextField,
} from "@clientbridge/ui";
import { type ReactNode, useState } from "react";

import { api, apiBaseUrl } from "../lib/api";

const s = strings.catalog;

/** Loading draws placeholder rows, a failed load the shared retry card, anything else the content. */
export function Loaded({
    load,
    label,
    error,
    children,
}: {
    load: Load;
    label: string;
    error: string;
    children: ReactNode;
}) {
    if (load.state === "loading") {
        return (
            <div className="rounded-lg border border-line bg-surface">
                <Skeleton variant="row" count={5} label={label} />
            </div>
        );
    }
    if (load.state === "error") {
        return (
            <LoadFailed
                variant="card"
                message={error}
                onRetry={load.retry}
                retrying={load.retrying}
            />
        );
    }
    return <>{children}</>;
}

/** The line under the Setup tabs: what the view holds, and its main action. */
export function Toolbar({
    title,
    summary,
    actions,
}: {
    title?: string;
    summary?: string | undefined;
    actions?: ReactNode;
}) {
    return (
        <div className="flex min-h-10 flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
                {title !== undefined ? (
                    <h3 className="font-display text-lg font-bold text-ink">{title}</h3>
                ) : null}
                {summary !== undefined ? <p className="text-sm text-muted">{summary}</p> : null}
            </div>
            {actions}
        </div>
    );
}

function StockRow({ r, onRestock }: { r: StockRowView; onRestock: () => void }) {
    return (
        <div className="flex items-center gap-4 px-4 py-3">
            <ItemImage
                src={mediaUrl(apiBaseUrl, r.item.image_file_id)}
                name={r.item.name}
                color={r.item.color}
                size={40}
            />
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{r.item.name}</p>
                <p className="truncate text-xs text-muted">{r.detail}</p>
            </div>
            <div className="hidden w-48 lg:block">
                <Meter
                    value={Math.max(0, r.onHand)}
                    max={stockScale(r.onHand, r.lowAt)}
                    marker={r.lowAt}
                    intent={r.intent}
                    label={r.label}
                    labelPosition="beside"
                    size="sm"
                />
            </div>
            <div className="w-32 text-right">
                {r.low && r.suggested > 0 ? (
                    <p className="text-xs text-muted">{s.suggested(r.suggested)}</p>
                ) : null}
            </div>
            <Button size="sm" variant={r.low ? "primary" : "outline"} onPress={onRestock}>
                {s.restock}
            </Button>
        </div>
    );
}

function RestockModal({
    item,
    suggested,
    onClose,
    onDone,
}: {
    item: ItemRow;
    suggested: number;
    onClose: () => void;
    onDone: (n: number) => void;
}) {
    const form = useRestockForm(api, item, onDone);
    return (
        <Modal open onClose={onClose} size="sm">
            <div className="space-y-4">
                <div className="flex items-center gap-3">
                    <ItemImage
                        src={mediaUrl(apiBaseUrl, item.image_file_id)}
                        name={item.name}
                        color={item.color}
                        size={44}
                    />
                    <div className="min-w-0">
                        <h2 className="truncate font-display text-base font-bold text-ink">
                            {s.restockTitle(item.name)}
                        </h2>
                        <p className="text-xs text-muted">{s.restockAfter(form.after)}</p>
                    </div>
                </div>
                <div className="flex items-end gap-2">
                    <div className="w-36">
                        <TextField
                            label={s.restockQuantity}
                            type="number"
                            value={form.quantity}
                            onChange={form.setQuantity}
                            autoFocus
                        />
                    </div>
                    {suggested > 0 ? (
                        <Button
                            variant="outline"
                            onPress={() => {
                                form.setQuantity(String(suggested));
                            }}
                        >
                            {s.suggested(suggested)}
                        </Button>
                    ) : null}
                </div>
                <TextField
                    label={s.restockNote}
                    placeholder={s.restockNotePlaceholder}
                    optional
                    value={form.note}
                    onChange={form.setNote}
                />
                <p className="text-xs text-muted">{s.restockQuantityHint}</p>
                {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
                <div className="flex justify-end gap-2 border-t border-line pt-4">
                    <Button variant="quiet" onPress={onClose}>
                        {s.cancel}
                    </Button>
                    <Button onPress={form.submit} busy={form.busy}>
                        {form.busy ? s.restocking : s.restockSave}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

function RecentMoves({ limit }: { limit: number }) {
    const moves = useStockMoves(limit);
    return (
        <Panel title={s.recentMoves}>
            {moves.length === 0 ? (
                <p className="text-sm text-muted">{s.noMoves}</p>
            ) : (
                <ActivityTimeline entries={moves} />
            )}
        </Panel>
    );
}

/** Tracked products, most urgent first, with one-tap restock and a way into receiving a delivery. */
export function Inventory() {
    const inv = useInventory();
    const [restocking, setRestocking] = useState<StockRowView | null>(null);
    const [done, setDone] = useState<string | null>(null);
    const [receiving, setReceiving] = useState(false);

    if (receiving) {
        return (
            <ReceiveDelivery
                seed={inv.attention.map((r) => ({
                    itemId: r.item.id,
                    quantity: Math.max(1, r.suggested),
                }))}
                onBack={() => {
                    setReceiving(false);
                }}
            />
        );
    }

    const rows = (list: StockRowView[]) => (
        <div className="divide-y divide-line-soft">
            {list.map((r) => (
                <StockRow
                    key={r.item.id}
                    r={r}
                    onRestock={() => {
                        setDone(null);
                        setRestocking(r);
                    }}
                />
            ))}
        </div>
    );

    return (
        <div>
            <Toolbar
                summary={s.inventorySubtitle}
                actions={
                    <Button
                        variant="outline"
                        icon="box"
                        disabled={!inv.load.ready}
                        onPress={() => {
                            setReceiving(true);
                        }}
                    >
                        {s.receive}
                    </Button>
                }
            />
            <div className="mt-5">
                {inv.load.state === "empty" ? (
                    <Empty
                        variant="card"
                        icon="box"
                        message={s.emptyStockTitle}
                        body={s.emptyStockBody}
                    />
                ) : (
                    <Loaded load={inv.load} label={s.loadingStock} error={s.loadErrorStock}>
                        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                            <Stat label={s.statTracked} value={String(inv.stats.tracked)} />
                            <Stat
                                label={s.statLow}
                                value={String(inv.stats.low)}
                                tone={inv.stats.low > 0 ? "warning" : "ink"}
                            />
                            <Stat
                                label={s.statOut}
                                value={String(inv.stats.out)}
                                tone={inv.stats.out > 0 ? "danger" : "ink"}
                            />
                            <Stat
                                label={s.statValue}
                                cents={inv.stats.costCents}
                                hint={s.statRetail(formatMoney(inv.stats.retailCents))}
                            />
                        </div>
                        {done !== null ? (
                            <div className="mt-4">
                                <Notice tone="success" banner>
                                    {done}
                                </Notice>
                            </div>
                        ) : null}
                        <div className="mt-6 space-y-6">
                            <div className="min-w-0 space-y-6">
                                <Panel flush title={s.needsRestock} subtitle={s.needsRestockHint}>
                                    {inv.attention.length === 0 ? (
                                        <Empty message={s.allGood} />
                                    ) : (
                                        rows(inv.attention)
                                    )}
                                </Panel>
                                {inv.others.length > 0 ? (
                                    <Panel flush title={s.allTracked}>
                                        {rows(inv.others)}
                                    </Panel>
                                ) : null}
                            </div>
                            <aside>
                                <RecentMoves limit={7} />
                            </aside>
                        </div>
                    </Loaded>
                )}
            </div>
            {restocking !== null ? (
                <RestockModal
                    item={restocking.item}
                    suggested={restocking.suggested}
                    onClose={() => {
                        setRestocking(null);
                    }}
                    onDone={(n) => {
                        setDone(s.restockDone(n, restocking.item.name));
                        setRestocking(null);
                    }}
                />
            ) : null}
        </div>
    );
}

const GRID =
    "grid grid-cols-[minmax(8rem,1fr)_3.5rem_4.5rem_3.5rem_6rem_4.5rem_2rem] items-center gap-3";

function ReceiveDelivery({
    seed,
    onBack,
}: {
    seed: readonly { itemId: string; quantity: number }[];
    onBack: () => void;
}) {
    const d = useReceiveDelivery(api, seed);
    return (
        <div>
            <Button variant="link" icon="chevronLeft" onPress={onBack}>
                {s.backToInventory}
            </Button>
            <div className="mt-2">
                <Toolbar title={s.receiveTitle} summary={s.receiveSubtitle} />
            </div>
            <div className="mt-6">
                {d.load.state === "empty" ? (
                    <Empty
                        variant="card"
                        icon="box"
                        message={s.emptyDeliveryTitle}
                        body={s.emptyDeliveryBody}
                    />
                ) : (
                    <Loaded load={d.load} label={s.loadingProducts} error={s.loadErrorProducts}>
                        <div className="space-y-6">
                            <div className="min-w-0 space-y-5">
                                <Panel>
                                    <div className="grid grid-cols-2 gap-3">
                                        <TextField
                                            label={s.supplier}
                                            placeholder={s.supplierPlaceholder}
                                            optional
                                            value={d.supplier}
                                            onChange={d.setSupplier}
                                        />
                                        <TextField
                                            label={s.reference}
                                            placeholder={s.referencePlaceholder}
                                            optional
                                            value={d.reference}
                                            onChange={d.setReference}
                                        />
                                    </div>
                                </Panel>
                                <section className="rounded-lg border border-line bg-surface shadow-card">
                                    <div className="relative border-b border-line p-3">
                                        <SearchField
                                            value={d.q}
                                            onChange={d.setQ}
                                            placeholder={s.addSearch}
                                        />
                                        {d.q !== "" ? (
                                            <div className="absolute inset-x-3 top-full z-10 mt-1 overflow-hidden rounded-md border border-line bg-surface shadow-card">
                                                {d.candidates.length === 0 ? (
                                                    <p className="px-4 py-3 text-sm text-muted">
                                                        {s.noMatch}
                                                    </p>
                                                ) : null}
                                                {d.candidates.map((i) => (
                                                    <ListRow
                                                        key={i.id}
                                                        density="compact"
                                                        leading={
                                                            <ItemImage
                                                                src={mediaUrl(
                                                                    apiBaseUrl,
                                                                    i.image_file_id,
                                                                )}
                                                                name={i.name}
                                                                color={i.color}
                                                                size={28}
                                                            />
                                                        }
                                                        title={i.name}
                                                        detail={i.sku ?? ""}
                                                        meta={s.onHandShort(i.stock_on_hand ?? 0)}
                                                        onPress={() => {
                                                            d.add(i);
                                                        }}
                                                    />
                                                ))}
                                            </div>
                                        ) : null}
                                    </div>
                                    {d.lines.length === 0 ? (
                                        <Empty message={s.deliveryEmpty} />
                                    ) : (
                                        <div className="overflow-x-auto">
                                            <div className="min-w-[38rem]">
                                                <div
                                                    className={`${GRID} border-b border-line-soft px-4 py-2 text-xs font-semibold tracking-wide whitespace-nowrap text-muted uppercase`}
                                                >
                                                    <span>{s.colProduct}</span>
                                                    <span className="text-right">
                                                        {s.colOnHand}
                                                    </span>
                                                    <span>{s.colReceived}</span>
                                                    <span className="text-right">{s.colAfter}</span>
                                                    <span>{s.colUnitCost}</span>
                                                    <span className="text-right">
                                                        {s.colLineCost}
                                                    </span>
                                                    <span />
                                                </div>
                                                <ul className="divide-y divide-line-soft">
                                                    {d.lines.map((l) => (
                                                        <li
                                                            key={l.item.id}
                                                            className={`${GRID} px-4 py-2.5`}
                                                        >
                                                            <div className="flex min-w-0 items-center gap-3">
                                                                <ItemImage
                                                                    src={mediaUrl(
                                                                        apiBaseUrl,
                                                                        l.item.image_file_id,
                                                                    )}
                                                                    name={l.item.name}
                                                                    color={l.item.color}
                                                                    size={32}
                                                                />
                                                                <div className="min-w-0">
                                                                    <p className="truncate text-sm font-medium text-ink">
                                                                        {l.item.name}
                                                                    </p>
                                                                    <p className="truncate text-xs text-muted">
                                                                        {l.item.sku}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                            <span className="text-right text-sm text-muted tabular-nums">
                                                                {l.item.stock_on_hand ?? 0}
                                                            </span>
                                                            <TextField
                                                                name={s.receivedFor(l.item.name)}
                                                                type="number"
                                                                size="sm"
                                                                surface="surface"
                                                                value={l.quantity}
                                                                onChange={(v) => {
                                                                    d.setQuantity(l.item.id, v);
                                                                }}
                                                            />
                                                            <span className="flex flex-col items-end text-sm font-semibold text-ink tabular-nums">
                                                                {d.after(l)}
                                                                {d.stillLow(l) ? (
                                                                    <Badge
                                                                        label={s.lowAfter}
                                                                        intent="warning"
                                                                    />
                                                                ) : null}
                                                            </span>
                                                            <TextField
                                                                name={s.unitCostFor(l.item.name)}
                                                                type="number"
                                                                size="sm"
                                                                prefix="$"
                                                                surface="surface"
                                                                value={l.unitCost}
                                                                onChange={(v) => {
                                                                    d.setUnitCost(l.item.id, v);
                                                                }}
                                                            />
                                                            <span className="text-right text-sm text-ink-soft tabular-nums">
                                                                {formatMoney(d.lineCost(l))}
                                                            </span>
                                                            <IconButton
                                                                icon="x"
                                                                size="sm"
                                                                label={s.removeLine(l.item.name)}
                                                                onPress={() => {
                                                                    d.remove(l.item.id);
                                                                }}
                                                            />
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        </div>
                                    )}
                                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-bg/60 px-4 py-3">
                                        <div className="text-sm">
                                            <p className="font-semibold text-ink">
                                                {s.deliveryTotal(d.units, formatMoney(d.costCents))}
                                            </p>
                                            <p className="text-xs text-muted">{s.unitCostHint}</p>
                                        </div>
                                        <Button
                                            onPress={d.submit}
                                            busy={d.busy}
                                            disabled={d.lines.length === 0}
                                        >
                                            {d.busy ? s.restocking : s.receiveSave(d.lines.length)}
                                        </Button>
                                    </div>
                                </section>
                                {d.error !== null ? (
                                    <Notice tone="danger" banner>
                                        {d.error}
                                    </Notice>
                                ) : null}
                                {d.done !== null ? (
                                    <Notice tone="success" banner>
                                        {d.done}
                                    </Notice>
                                ) : null}
                            </div>
                            <aside>
                                <RecentMoves limit={5} />
                            </aside>
                        </div>
                    </Loaded>
                )}
            </div>
        </div>
    );
}
