import {
    type DiscountEditor,
    type SaleDiscount,
    type SalePayMethod,
    type SaleTicket,
    discountLabel,
    filterClients,
    formatMoney,
    formatPhone,
    strings,
    useClients,
    useDiscountEditor,
    useDiscountSheet,
    BUSINESS_CURRENCY,
    currencyAffix,
    parseCents,
    formatAmountInput,
    formatCredit,
    usePeoplePhotos,
    formatMonthDay,
    useBusinessZone,
    useNextVisit,
    useVisitNote,
    itemMedia,
    replaceTask,
    sellableItems,
    useCatalogItems,
    useCheckoutQueue,
    useLinkedVisit,
    useSale,
    mediaUrl,
} from "@clientbridge/app-core";
import {
    Avatar,
    Button,
    ChargeSheet,
    Checkbox,
    Choice,
    DocTotals,
    Icon,
    IconButton,
    LineItem,
    ListRow,
    Modal,
    Notice,
    SearchField,
    SearchSelect,
    TextField,
    ItemImage,
} from "@clientbridge/ui";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { api, apiBaseUrl } from "../lib/api";
import { useViewer } from "../lib/auth";

const d = strings.pos.desk;

function Heading({ children }: { children: ReactNode }) {
    return (
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            {children}
        </h3>
    );
}

function ClientPicker({ sale }: { sale: SaleTicket }) {
    const photos = usePeoplePhotos();
    const clients = useClients();
    const [searching, setSearching] = useState(false);
    const [q, setQ] = useState("");
    if (searching) {
        const hits = filterClients(clients, q).slice(0, 6);
        return (
            <div className="space-y-2">
                <SearchField value={q} onChange={setQ} placeholder={d.clientSearch} autoFocus />
                <div className="overflow-hidden rounded-md border border-line">
                    <ListRow
                        density="compact"
                        icon="user"
                        title={d.walkIn}
                        onPress={() => {
                            sale.setClientId(null);
                            setSearching(false);
                        }}
                    />
                    {hits.map((c) => (
                        <ListRow
                            key={c.id}
                            density="compact"
                            leading={<Avatar name={c.name} src={photos.client(c.id)} size="sm" />}
                            title={c.name}
                            detail={formatPhone(c.phone)}
                            onPress={() => {
                                sale.setClientId(c.id);
                                setSearching(false);
                                setQ("");
                            }}
                        />
                    ))}
                </div>
            </div>
        );
    }
    if (sale.client === null) {
        return (
            <div className="overflow-hidden rounded-md border border-dashed border-line">
                <ListRow
                    density="compact"
                    icon="user"
                    title={d.walkIn}
                    detail={d.clientHint}
                    meta={d.chooseClient}
                    onPress={() => {
                        setSearching(true);
                    }}
                />
            </div>
        );
    }
    return (
        <div className="flex items-center gap-3">
            <Avatar name={sale.client.name} src={photos.client(sale.client.id)} />
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{sale.client.name}</p>
                <p className="truncate text-xs text-muted">{sale.client.detail}</p>
            </div>
            <Button
                size="sm"
                variant="quiet"
                onPress={() => {
                    setSearching(true);
                }}
            >
                {d.changeClient}
            </Button>
        </div>
    );
}

function DiscountFields({ editor, baseCents }: { editor: DiscountEditor; baseCents: number }) {
    const known = editor.reasons.includes(editor.reason);
    return (
        <div className="space-y-3">
            <div className="flex items-end gap-2">
                <Choice
                    layout="segmented"
                    label={d.discountValue}
                    options={[
                        { key: "percent", label: d.percent },
                        { key: "amount", label: d.amount },
                    ]}
                    value={editor.kind}
                    onChange={editor.setKind}
                />
                <div className="w-28">
                    <TextField
                        label={editor.kind === "amount" ? d.amountOff : d.percentOff}
                        type="number"
                        {...(editor.kind === "amount" ? currencyAffix(BUSINESS_CURRENCY) : {})}
                        value={editor.value}
                        onChange={editor.setValue}
                        surface="surface"
                    />
                </div>
            </div>
            <Choice
                label={d.discountReason}
                options={editor.reasons.map((r) => ({ key: r, label: r }))}
                value={known ? editor.reason : null}
                onChange={editor.setReason}
            />
            <TextField
                placeholder={d.discountReasonPlaceholder}
                name={d.otherReason}
                value={known ? "" : editor.reason}
                onChange={editor.setReason}
                surface="surface"
            />
            {editor.previewCents > 0 ? (
                <p className="text-sm text-ink-soft">
                    {d.discountPreview(
                        formatMoney(editor.previewCents, BUSINESS_CURRENCY),
                        formatMoney(baseCents - editor.previewCents, BUSINESS_CURRENCY),
                    )}
                </p>
            ) : null}
            {editor.error !== null ? <Notice tone="danger">{editor.error}</Notice> : null}
        </div>
    );
}

/** A percent or amount off with its reason, used by the invoice and estimate composer. */
export function DiscountForm({
    title,
    initial,
    baseCents,
    onApply,
    onCancel,
}: {
    title: string;
    initial: SaleDiscount | null;
    baseCents: number;
    onApply: (discount: SaleDiscount | null) => void;
    onCancel: () => void;
}) {
    const editor = useDiscountEditor(initial, baseCents);
    return (
        <section
            className="space-y-3 rounded-md border border-accent-line bg-surface p-3.5 shadow-card"
            aria-label={title}
        >
            <div className="flex items-center justify-between gap-2">
                <h3 className="truncate text-sm font-semibold text-ink">{title}</h3>
                <IconButton icon="x" label={d.cancel} size="sm" onPress={onCancel} />
            </div>
            <DiscountFields editor={editor} baseCents={baseCents} />
            <div className="flex items-center justify-between gap-2">
                {initial !== null ? (
                    <Button
                        variant="link"
                        size="sm"
                        onPress={() => {
                            onApply(null);
                        }}
                    >
                        {d.removeDiscount}
                    </Button>
                ) : (
                    <span />
                )}
                <Button
                    size="sm"
                    onPress={() => {
                        const next = editor.apply();
                        if (next !== null) onApply(next);
                    }}
                >
                    {d.applyDiscount}
                </Button>
            </div>
        </section>
    );
}

/** Discounts A: the editor opens under the line it changes. */
function LineDiscountEditor({
    sale,
    lineKey,
    onDone,
}: {
    sale: SaleTicket;
    lineKey: string;
    onDone: () => void;
}) {
    const line = sale.lines.find((l) => l.key === lineKey);
    const editor = useDiscountEditor(line?.discount ?? null, line?.grossCents ?? 0);
    if (line === undefined) return null;
    return (
        <section
            className="mb-3 space-y-3 rounded-md border border-accent-line bg-surface p-3.5 shadow-card"
            aria-label={d.discountLine(line.description)}
        >
            <div className="flex items-center justify-between gap-2">
                <h3 className="truncate text-sm font-semibold text-ink">
                    {d.discountLine(line.description)}
                </h3>
                <IconButton icon="x" label={d.cancel} size="sm" onPress={onDone} />
            </div>
            <DiscountFields editor={editor} baseCents={line.grossCents} />
            <div className="flex items-center justify-between gap-2">
                {line.discount !== null ? (
                    <Button
                        variant="link"
                        size="sm"
                        onPress={() => {
                            sale.setLineDiscount(line.key, null);
                            onDone();
                        }}
                    >
                        {d.removeDiscount}
                    </Button>
                ) : (
                    <span />
                )}
                <Button
                    size="sm"
                    onPress={() => {
                        const next = editor.apply();
                        if (next !== null) {
                            sale.setLineDiscount(line.key, next);
                            onDone();
                        }
                    }}
                >
                    {d.applyDiscount}
                </Button>
            </div>
        </section>
    );
}

function PreviewRow({
    label,
    before,
    after,
    strong = false,
    credit = false,
}: {
    label: string;
    before: number;
    after: number;
    strong?: boolean;
    credit?: boolean;
}) {
    const money = (c: number): string =>
        credit && c > 0 ? formatCredit(c, BUSINESS_CURRENCY) : formatMoney(c, BUSINESS_CURRENCY);
    return (
        <div
            className={`grid grid-cols-[1fr_auto_auto] items-baseline gap-6 py-1.5 text-sm ${strong ? "border-t border-line pt-2.5 font-semibold text-ink" : "text-ink-soft"}`}
        >
            <span className={strong ? "" : "text-muted"}>{label}</span>
            <span className="w-24 text-right tabular-nums text-muted line-through decoration-line">
                {before === after || (credit && before === 0) ? "" : money(before)}
            </span>
            <span className="w-24 text-right tabular-nums">{money(after)}</span>
        </div>
    );
}

/** Discounts B: scope, amount and reason with a before and after. */
function DiscountSheet({ sale, onClose }: { sale: SaleTicket; onClose: () => void }) {
    const sheet = useDiscountSheet(sale);
    const p = sheet.preview;
    const base =
        sheet.scope === "sale"
            ? sale.totals.subtotalCents + sale.totals.saleDiscountCents
            : sale.lines
                  .filter((l) => sheet.keys.includes(l.key))
                  .reduce((n, l) => n + l.grossCents, 0);
    return (
        <Modal open size="lg" onClose={onClose}>
            <div className="-mr-2 max-h-[calc(100vh-7rem)] space-y-5 overflow-y-auto pr-2">
                <div>
                    <h2 className="font-display text-lg font-bold text-ink">{d.discountTitle}</h2>
                </div>
                <div>
                    <Heading>{d.discountScope}</Heading>
                    <Choice
                        layout="tiles"
                        columns={2}
                        label={d.discountScope}
                        value={sheet.scope}
                        onChange={sheet.setScope}
                        options={[
                            {
                                key: "sale",
                                label: d.scopeSale,
                                hint: formatMoney(
                                    sale.totals.subtotalCents + sale.totals.saleDiscountCents,
                                    BUSINESS_CURRENCY,
                                ),
                            },
                            { key: "lines", label: d.scopeLines, hint: d.items(sale.itemCount) },
                        ]}
                    />
                    {sheet.scope === "lines" ? (
                        <div className="mt-2 divide-y divide-line-soft rounded-md border border-line px-3">
                            {sale.lines.map((l) => (
                                <div
                                    key={l.key}
                                    className="flex items-center justify-between gap-3 py-2"
                                >
                                    <Checkbox
                                        label={l.description}
                                        value={sheet.keys.includes(l.key)}
                                        onChange={() => {
                                            sheet.toggleKey(l.key);
                                        }}
                                    />
                                    <span className="text-sm tabular-nums text-ink-soft">
                                        {formatMoney(l.grossCents, BUSINESS_CURRENCY)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : null}
                </div>
                <DiscountFields editor={sheet.editor} baseCents={base} />
                <div className="rounded-md border border-line bg-bg px-4 py-2">
                    <div className="grid grid-cols-[1fr_auto_auto] gap-6 py-1 text-xs font-semibold uppercase tracking-wide text-muted">
                        <span />
                        <span className="w-24 text-right">{d.before}</span>
                        <span className="w-24 text-right">{d.after}</span>
                    </div>
                    <PreviewRow
                        label={d.youSave}
                        before={p.before.discountCents}
                        after={p.after.discountCents}
                        credit
                    />
                    <PreviewRow
                        label={d.subtotal}
                        before={p.before.subtotalCents}
                        after={p.after.subtotalCents}
                    />
                    <PreviewRow label={d.tax} before={p.before.taxCents} after={p.after.taxCents} />
                    <PreviewRow
                        label={d.dueNow}
                        before={p.before.dueCents}
                        after={p.after.dueCents}
                        strong
                    />
                    <p className="py-1 text-xs text-muted">{d.taxFollows}</p>
                </div>
                {sheet.scope === "lines" && sheet.keys.length === 0 ? (
                    <p className="text-xs text-muted">{d.chooseLines}</p>
                ) : null}
                <div className="flex justify-end gap-2 border-t border-line pt-4">
                    <Button variant="quiet" onPress={onClose}>
                        {d.cancel}
                    </Button>
                    <Button
                        onPress={() => {
                            if (sheet.apply()) onClose();
                        }}
                    >
                        {d.applyDiscount}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

/** The register's ticket beside the tiles, or (with `onClose`) a checkout drawer's whole height. */
/** The sale from ticket to receipt in one panel: the lines, then payment, then the receipt. */
export function TicketPanel({
    sale,
    adder,
    onClose,
    onBookNext,
}: {
    sale: SaleTicket;
    adder?: ReactNode;
    onClose?: () => void;
    onBookNext: () => void;
}) {
    const [selected, setSelected] = useState<string | null>(null);
    const [discounting, setDiscounting] = useState(false);
    const [paying, setPaying] = useState(false);
    useEffect(() => {
        if (sale.invoiced !== null || sale.isEmpty) setPaying(false);
    }, [sale.invoiced, sale.isEmpty]);
    const step =
        sale.phase === "paid"
            ? "paid"
            : sale.checkout.clientSecret !== null
              ? "card"
              : paying
                ? "pay"
                : "ticket";
    const due = formatMoney(sale.totals.dueCents, BUSINESS_CURRENCY);
    return (
        <aside
            className={
                onClose === undefined
                    ? "sticky top-6 flex max-h-[calc(100vh-8rem)] w-[340px] shrink-0 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-card xl:w-[380px]"
                    : "flex h-full flex-col overflow-hidden bg-surface"
            }
            aria-label={step === "pay" || step === "card" ? d.payTitle : d.ticket}
        >
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                <div className="flex items-center gap-2">
                    {step === "pay" ? (
                        <IconButton
                            size="sm"
                            icon="chevronLeft"
                            label={d.backToTicket}
                            onPress={() => {
                                setPaying(false);
                            }}
                        />
                    ) : null}
                    <h2 className="font-display text-base font-bold text-ink">
                        {step === "pay" || step === "card" ? d.payTitle : d.ticket}
                    </h2>
                    {step === "ticket" ? (
                        <span className="text-xs tabular-nums text-muted">{sale.number}</span>
                    ) : null}
                </div>
                <div className="flex items-center gap-1">
                    {sale.isEmpty || step !== "ticket" ? null : (
                        <Button size="sm" variant="quiet" onPress={sale.clear}>
                            {d.clear}
                        </Button>
                    )}
                    {onClose === undefined ? null : (
                        <IconButton
                            size="sm"
                            icon="x"
                            label={strings.common.close}
                            onPress={onClose}
                        />
                    )}
                </div>
            </div>
            {step === "ticket" ? (
                <div className="border-b border-line px-5 py-3.5">
                    <ClientPicker sale={sale} />
                    {adder}
                </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto px-5">
                {step === "pay" ? <PayStep sale={sale} /> : null}
                {step === "card" ? (
                    <div className="py-4">
                        <ChargeSheet
                            checkout={sale.checkout}
                            methods={[]}
                            amountLabel={due}
                            submitLabel={d.charge(due)}
                            busyLabel={d.charging}
                            onSubmit={() => undefined}
                            onCancel={sale.cancelCheckout}
                        />
                    </div>
                ) : null}
                {step === "paid" ? (
                    <div className="py-5">
                        <PaidSummary
                            sale={sale}
                            onNew={() => {
                                sale.newSale();
                                setPaying(false);
                            }}
                            onBookNext={() => {
                                sale.newSale();
                                setPaying(false);
                                onBookNext();
                            }}
                        />
                    </div>
                ) : null}
                {step === "ticket" ? (
                    <>
                        {sale.held !== null ? (
                            <div className="pt-3">
                                <Notice tone="success">{sale.held}</Notice>
                            </div>
                        ) : null}
                        {sale.invoiced !== null ? (
                            <div className="pt-3">
                                <Notice tone="success">{sale.invoiced}</Notice>
                            </div>
                        ) : null}
                        {sale.isEmpty ? (
                            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                                <Icon name="receipt" size={22} />
                                <p className="text-sm text-muted">{d.emptyTicket}</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-line-soft">
                                {sale.views.map((v) => (
                                    <div key={v.key}>
                                        <LineItem
                                            currency={BUSINESS_CURRENCY}
                                            title={v.title}
                                            leading={
                                                <ItemImage
                                                    src={mediaUrl(apiBaseUrl, v.imageFileId)}
                                                    name={v.title}
                                                    color={v.color}
                                                    size={36}
                                                />
                                            }
                                            meta={v.meta}
                                            tag={v.tag}
                                            cents={v.cents}
                                            originalCents={v.originalCents}
                                            selected={selected === v.key}
                                            quantity={
                                                v.quantity === null
                                                    ? undefined
                                                    : {
                                                          value: v.quantity,
                                                          onChange: (n) => {
                                                              sale.setQuantity(v.key, n);
                                                          },
                                                          label: d.quantity,
                                                      }
                                            }
                                            onPress={() => {
                                                setSelected(selected === v.key ? null : v.key);
                                            }}
                                            pressLabel={d.discountLine(v.title)}
                                            onRemove={() => {
                                                sale.removeLine(v.key);
                                            }}
                                            removeLabel={d.removeLine(v.title)}
                                        />
                                        {selected === v.key ? (
                                            <LineDiscountEditor
                                                key={v.key}
                                                sale={sale}
                                                lineKey={v.key}
                                                onDone={() => {
                                                    setSelected(null);
                                                }}
                                            />
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        )}
                        {sale.isEmpty ? null : (
                            <div className="space-y-3 pb-4 pt-1">
                                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-line px-3 py-2">
                                    <span className="text-xs text-muted">{d.taxFollows}</span>
                                    <div className="flex gap-2">
                                        <Button
                                            size="sm"
                                            variant="quiet"
                                            busy={sale.busy && sale.phase === "cart"}
                                            onPress={() => {
                                                sale.hold();
                                            }}
                                        >
                                            {d.holdSale}
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            icon="percent"
                                            onPress={() => {
                                                setDiscounting(true);
                                            }}
                                        >
                                            {sale.saleDiscount !== null
                                                ? d.discountedBy(discountLabel(sale.saleDiscount))
                                                : d.addDiscount}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                ) : null}
            </div>
            {step === "ticket" || step === "pay" ? (
                <div className="space-y-3 border-t border-line bg-surface px-5 pb-5 pt-3.5">
                    {sale.isEmpty ? null : (
                        <DocTotals
                            currency={BUSINESS_CURRENCY}
                            lines={sale.totalLines}
                            density="compact"
                        />
                    )}
                    {sale.error !== null && (step === "pay" || sale.phase === "cart") ? (
                        <Notice tone="danger">{sale.error}</Notice>
                    ) : null}
                    {step === "ticket" ? (
                        <Button
                            size="lg"
                            full
                            onPress={() => {
                                setPaying(true);
                            }}
                            disabled={sale.isEmpty || !sale.ratesReady}
                        >
                            {sale.isEmpty ? d.review : d.charge(due)}
                        </Button>
                    ) : (
                        <Button
                            size="lg"
                            full
                            onPress={() => {
                                sale.charge();
                            }}
                            busy={sale.busy}
                            disabled={sale.method === "tap"}
                        >
                            {sale.busy ? d.charging : d.charge(due)}
                        </Button>
                    )}
                </div>
            ) : null}
            {discounting ? (
                <DiscountSheet
                    sale={sale}
                    onClose={() => {
                        setDiscounting(false);
                    }}
                />
            ) : null}
        </aside>
    );
}

function TipChips({ sale }: { sale: SaleTicket }) {
    const [custom, setCustom] = useState("");
    return (
        <div className="space-y-2">
            <Choice
                label={d.tip}
                options={sale.tipOptions.map((o) => ({ key: o.key, label: o.label }))}
                value={sale.tipKey}
                onChange={(k) => {
                    if (k === "none") sale.setTip({ kind: "none" });
                    else if (k === "custom")
                        sale.setTip({
                            kind: "custom",
                            cents: parseCents(custom, BUSINESS_CURRENCY) ?? 0,
                        });
                    else sale.setTip({ kind: "percent", pct: Number(k) });
                }}
            />
            {sale.tip.kind === "custom" ? (
                <TextField
                    label={d.tipAmount}
                    {...currencyAffix(BUSINESS_CURRENCY)}
                    type="number"
                    width="narrow"
                    value={custom}
                    onChange={(v) => {
                        setCustom(v);
                        sale.setTip({
                            kind: "custom",
                            cents: parseCents(v, BUSINESS_CURRENCY) ?? 0,
                        });
                    }}
                />
            ) : null}
        </div>
    );
}

/** Tips B: the tip and how it's shared between the people who served. */
function TipBlock({ sale }: { sale: SaleTicket }) {
    const photos = usePeoplePhotos();
    const tip = sale.totals.tipCents;
    return (
        <section className="space-y-3" aria-label={d.tipSection}>
            <Heading>{d.tipSection}</Heading>
            <TipChips sale={sale} />
            <p className="text-xs text-muted">
                {d.tipOn(formatMoney(sale.totals.subtotalCents, BUSINESS_CURRENCY))}
            </p>
            {tip > 0 ? (
                <div className="space-y-2 rounded-md border border-line bg-bg p-3">
                    <Choice
                        layout="segmented"
                        label={d.tipSplitTitle}
                        options={[
                            { key: "byService", label: d.tipSplitEven },
                            { key: "one", label: d.tipToOne },
                        ]}
                        value={sale.tipMode}
                        onChange={sale.setTipMode}
                    />
                    {sale.tipMode === "one" ? (
                        <Choice
                            label={d.tipPickPerson}
                            options={sale.tipStaff}
                            value={sale.tipTo}
                            onChange={sale.setTipTo}
                        />
                    ) : null}
                    {sale.tipShares.length === 0 ? (
                        <p className="text-xs text-muted">{d.tipNobody}</p>
                    ) : (
                        <ul className="divide-y divide-line-soft rounded-md border border-line bg-surface">
                            {sale.tipShares.map((sh) => (
                                <li
                                    key={sh.staffId}
                                    className="flex items-center gap-2.5 px-3 py-2"
                                >
                                    <Avatar
                                        name={sh.name}
                                        src={photos.staff(sh.staffId)}
                                        size="sm"
                                        color={sh.color}
                                    />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium text-ink">
                                            {sh.name}
                                        </span>
                                        <span className="block text-xs text-muted">
                                            {d.tipShareOf(Math.round((sh.cents / tip) * 100))}
                                        </span>
                                    </span>
                                    <span className="text-sm font-semibold tabular-nums text-ink">
                                        {formatMoney(sh.cents, BUSINESS_CURRENCY)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            ) : null}
        </section>
    );
}

function CashBox({ sale }: { sale: SaleTicket }) {
    const due = sale.totals.dueCents;
    const quick = [
        due,
        Math.ceil(due / 2000) * 2000,
        Math.ceil(due / 5000) * 5000 + (due % 5000 === 0 ? 5000 : 0),
    ].filter((v, i, a) => a.indexOf(v) === i);
    return (
        <div className="space-y-3 rounded-md border border-line bg-bg p-4">
            <div className="flex items-end gap-3">
                <div className="w-40">
                    <TextField
                        label={d.cashGiven}
                        {...currencyAffix(BUSINESS_CURRENCY)}
                        type="number"
                        value={sale.cashGiven}
                        onChange={sale.setCashGiven}
                        surface="surface"
                    />
                </div>
                <div className="flex flex-wrap gap-2 pb-0.5">
                    {quick.map((c, i) => (
                        <Button
                            key={c}
                            size="sm"
                            variant="outline"
                            onPress={() => {
                                sale.setCashGiven(formatAmountInput(c, BUSINESS_CURRENCY));
                            }}
                        >
                            {i === 0 ? d.exactCash : formatMoney(c, BUSINESS_CURRENCY)}
                        </Button>
                    ))}
                </div>
            </div>
            <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted">{d.changeDue}</span>
                <span
                    className={`font-display text-xl font-bold tabular-nums ${sale.changeCents !== null && sale.changeCents < 0 ? "text-danger" : "text-ink"}`}
                >
                    {formatMoney(Math.max(0, sale.changeCents ?? 0), BUSINESS_CURRENCY)}
                </span>
            </div>
        </div>
    );
}

function MethodDetail({ sale }: { sale: SaleTicket }) {
    if (sale.method === "cash") return <CashBox sale={sale} />;
    const text =
        sale.method === "saved" && sale.savedCardLabel !== null
            ? d.savedCardCharge(sale.savedCardLabel)
            : sale.method === "card"
              ? d.secure
              : d.tapWeb;
    return (
        <p className="flex items-start gap-2 rounded-md bg-bg px-3 py-2.5 text-sm text-ink-soft">
            <Icon
                name={
                    sale.method === "card"
                        ? "lock"
                        : sale.method === "saved"
                          ? "card"
                          : "phoneDevice"
                }
                size={16}
            />
            {text}
        </p>
    );
}

function ReceiptChooser({ sale }: { sale: SaleTicket }) {
    const r = sale.receipt;
    const [choice, setChoice] = useState<"text" | "skip">(
        sale.client?.phone != null ? "text" : "skip",
    );
    if (r.sent !== null) {
        return (
            <Notice tone="success" banner>
                {r.sent === "skipped" ? d.receiptSkipped : d.receiptSent(r.phone)}
            </Notice>
        );
    }
    return (
        <div className="space-y-3">
            <Choice
                layout="segmented"
                label={d.receiptTitle}
                options={[
                    { key: "text", label: d.receiptText },
                    { key: "skip", label: d.receiptNone },
                ]}
                value={choice}
                onChange={setChoice}
            />
            {choice === "skip" ? (
                <Button
                    variant="outline"
                    onPress={() => {
                        r.skip();
                    }}
                >
                    {d.receiptNone}
                </Button>
            ) : (
                <div className="flex items-end gap-2">
                    <div className="flex-1">
                        <TextField
                            label={d.receiptPhoneTo}
                            type="tel"
                            value={r.phone}
                            onChange={r.setPhone}
                        />
                    </div>
                    <Button
                        variant="outline"
                        busy={r.busy}
                        onPress={() => {
                            r.send();
                        }}
                    >
                        {d.sendText}
                    </Button>
                </div>
            )}
            {r.error !== null ? <Notice tone="danger">{r.error}</Notice> : null}
        </div>
    );
}

function VisitNoteBlock({ clientId, bookingId }: { clientId: string; bookingId: string }) {
    const note = useVisitNote(api, clientId, bookingId);
    return (
        <div className="space-y-2">
            <Heading>{d.visitNote}</Heading>
            <TextField
                label={d.visitNote}
                multiline
                rows={3}
                value={note.body}
                onChange={note.setBody}
                placeholder={d.visitNotePlaceholder}
                surface="surface"
            />
            <p className="text-xs text-muted">{d.visitNotePhotos(note.sharedPhotos)}</p>
            {note.error !== null ? <Notice tone="danger">{note.error}</Notice> : null}
            {note.sent ? <Notice tone="success">{d.visitNoteSent}</Notice> : null}
            <Button
                variant="outline"
                icon="send"
                busy={note.busy}
                disabled={note.body.trim() === ""}
                onPress={note.submit}
            >
                {d.visitNoteSend}
            </Button>
        </div>
    );
}

function GiftCardEntry({ sale }: { sale: SaleTicket }) {
    const g = sale.giftCard;
    return (
        <div className="space-y-2">
            <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                    <TextField
                        label={d.giftCardCode}
                        value={g.code}
                        onChange={g.setCode}
                        surface="surface"
                    />
                </div>
                <Button
                    variant="outline"
                    busy={g.busy}
                    disabled={g.code.trim() === "" || sale.busy}
                    onPress={g.apply}
                >
                    {d.giftCardApply}
                </Button>
            </div>
            {g.error !== null ? <Notice tone="danger">{g.error}</Notice> : null}
        </div>
    );
}

const METHOD_LABEL: Record<SalePayMethod, string> = {
    get tap() {
        return d.methodTap;
    },
    get saved() {
        return d.methodCard;
    },
    get card() {
        return d.methodCard;
    },
    get cash() {
        return d.methodCash;
    },
};

function PaidSummary({
    sale,
    onNew,
    onBookNext,
}: {
    sale: SaleTicket;
    onNew: () => void;
    onBookNext: () => void;
}) {
    const nextStart = useNextVisit(sale.visitId)?.start ?? null;
    const zone = useBusinessZone();
    const method = sale.paidByGiftCard
        ? d.paidByGiftCard
        : sale.method === "saved" && sale.savedCardLabel !== null
          ? sale.savedCardLabel
          : METHOD_LABEL[sale.method];
    return (
        <div className="space-y-5">
            <div className="flex flex-col items-center pt-2 text-center">
                <Icon name="check" size={32} className="text-ink-soft" />
                <h2 className="mt-3 font-display text-xl font-bold text-ink">{d.paidTitle}</h2>
                <p className="mt-1 text-sm text-muted">
                    {d.paidBody(formatMoney(sale.paidCents, BUSINESS_CURRENCY), method)}
                </p>
                {sale.changeGiven !== null && sale.changeGiven > 0 ? (
                    <p className="mt-3 rounded-md bg-warn-bg px-3 py-1.5 text-sm font-semibold text-warn-fg">
                        {d.changeToGive(formatMoney(sale.changeGiven, BUSINESS_CURRENCY))}
                    </p>
                ) : null}
            </div>
            <div>
                <Heading>{d.receiptTitle}</Heading>
                <ReceiptChooser sale={sale} />
            </div>
            {sale.client !== null && sale.visitId !== null ? (
                <VisitNoteBlock clientId={sale.client.id} bookingId={sale.visitId} />
            ) : null}
            <div className="flex gap-2 border-t border-line pt-4">
                {sale.client !== null ? (
                    <Button variant="outline" grow icon="calendar" onPress={onBookNext}>
                        {nextStart === null
                            ? d.bookNext
                            : d.bookNextOn(formatMonthDay(nextStart, zone))}
                    </Button>
                ) : null}
                <Button grow onPress={onNew}>
                    {d.newSale}
                </Button>
            </div>
        </div>
    );
}

/** How the client pays: tip, gift card, then the method and its details. */
function PayStep({ sale }: { sale: SaleTicket }) {
    return (
        <div className="space-y-5 py-4">
            <p className="text-sm text-muted">{d.payFor(sale.client?.name ?? d.walkIn)}</p>
            <TipBlock sale={sale} />
            <GiftCardEntry sale={sale} />
            <div>
                <Heading>{d.howPaying}</Heading>
                <Choice
                    layout="tiles"
                    label={d.howPaying}
                    columns={2}
                    value={sale.method}
                    onChange={sale.setMethod}
                    options={sale.payOptions}
                />
            </div>
            <MethodDetail sale={sale} />
            {sale.canInvoice ? (
                <Button
                    variant="outline"
                    icon="send"
                    full
                    disabled={sale.busy}
                    onPress={sale.sendAsInvoice}
                >
                    {d.sendAsInvoice}
                </Button>
            ) : null}
        </div>
    );
}

/** Adds any sellable item to the ticket by name, where the register's tiles are out of reach. */
function ItemAdder({ sale }: { sale: SaleTicket }) {
    const all = useCatalogItems();
    const items = useMemo(() => sellableItems(all), [all]);
    return (
        <div className="pt-3">
            <SearchSelect
                name={d.addItems}
                placeholder={d.addItems}
                options={items.map((i) => ({
                    key: i.id,
                    label: i.name,
                    media: itemMedia(i),
                    detail: formatMoney(i.price_cents ?? 0, BUSINESS_CURRENCY),
                }))}
                value=""
                onChange={(id) => {
                    const item = items.find((i) => i.id === id);
                    if (item !== undefined) sale.addItem(item);
                }}
            />
        </div>
    );
}

/** Checkout over the current page: a visit's ticket (or a new sale), extra items, then payment. */
export function Checkout({
    bookingId,
    onClose,
}: {
    bookingId: string | null;
    onClose: () => void;
}) {
    const viewer = useViewer();
    const sale = useSale(api, {
        viewerStaffId: viewer?.staffId ?? null,
        platform: "web",
        role: viewer?.role ?? null,
    });
    useLinkedVisit(bookingId, useCheckoutQueue(), sale.addVisit);
    const visitId = sale.visitId;
    return (
        <Modal
            variant="drawer"
            size="lg"
            framed={false}
            onClose={sale.busy ? () => undefined : onClose}
        >
            <TicketPanel
                sale={sale}
                adder={<ItemAdder sale={sale} />}
                onClose={onClose}
                onBookNext={() => {
                    replaceTask(
                        visitId === null
                            ? { kind: "booking" }
                            : { kind: "booking", rebookId: visitId },
                    );
                }}
            />
        </Modal>
    );
}
