import {
    type DiscountEditor,
    type ReceiptChannel,
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
    TextField,
} from "@clientbridge/ui";
import { type ReactNode, useState } from "react";

import { api } from "../lib/api";

const d = strings.pos.desk;

function Heading({ children }: { children: ReactNode }) {
    return (
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            {children}
        </h3>
    );
}

function ClientPicker({ sale }: { sale: SaleTicket }) {
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
                            leading={<Avatar name={c.name} size="sm" />}
                            title={c.name}
                            detail={formatPhone(c.phone) || (c.email ?? "")}
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
            <Avatar name={sale.client.name} />
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
                        {...(editor.kind === "amount" ? { prefix: "$" } : {})}
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
                        formatMoney(editor.previewCents),
                        formatMoney(baseCents - editor.previewCents),
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

function ApprovalBox({
    title,
    body,
    pin,
    setPin,
    onApprove,
    error,
}: {
    title: string;
    body: string;
    pin: string;
    setPin: (v: string) => void;
    onApprove: () => void;
    error: string | null;
}) {
    return (
        <div className="space-y-3 rounded-md bg-warn-bg px-4 py-3.5">
            <p className="flex items-center gap-2 text-sm font-semibold text-warn-fg">
                <Icon name="lock" size={16} />
                {title}
            </p>
            <p className="text-sm text-ink-soft">{body}</p>
            <div className="flex items-end gap-2">
                <div className="w-36">
                    <TextField
                        label={d.approvalPin}
                        type="password"
                        value={pin}
                        onChange={setPin}
                        error={error}
                        surface="surface"
                        maxLength={4}
                    />
                </div>
                <Button variant="outline" onPress={onApprove}>
                    {d.approve}
                </Button>
            </div>
            <p className="text-xs text-muted">{d.pinHint}</p>
        </div>
    );
}

const pct = (bps: number | null): string => String((bps ?? 0) / 100);

/** A line discount past the staff limit is approved here, before the sale is charged. */
function TicketApproval({ sale }: { sale: SaleTicket }) {
    const [pin, setPin] = useState("");
    const [error, setError] = useState<string | null>(null);
    if (!sale.overLimit) return null;
    return (
        <ApprovalBox
            title={d.approvalTitle}
            body={d.approvalBody(
                pct(sale.limitBps),
                formatMoney(Math.round((sale.totals.grossCents * (sale.limitBps ?? 0)) / 10000)),
            )}
            pin={pin}
            setPin={(v) => {
                setError(null);
                setPin(v.replace(/\D/g, "").slice(0, 4));
            }}
            onApprove={() => {
                if (pin.length !== 4) {
                    setError(d.pinInvalid);
                    return;
                }
                sale.approve(pin);
                setPin("");
            }}
            error={error}
        />
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
    const money = (c: number): string => (credit && c > 0 ? `−${formatMoney(c)}` : formatMoney(c));
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

/** Discounts B: scope, amount and reason with a before and after, and approval past the staff limit. */
function DiscountSheet({ sale, onClose }: { sale: SaleTicket; onClose: () => void }) {
    const sheet = useDiscountSheet(api, sale);
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
                    {sale.limitBps !== null ? (
                        <p className="mt-0.5 text-sm text-muted">
                            {d.limitNote(pct(sale.limitBps))}
                        </p>
                    ) : null}
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
                                        {formatMoney(l.grossCents)}
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
                {sheet.approval.needed ? (
                    <ApprovalBox
                        title={d.approvalTitle}
                        body={d.approvalBody(
                            pct(sale.limitBps),
                            formatMoney(
                                Math.round((p.after.grossCents * (sale.limitBps ?? 0)) / 10000),
                            ),
                        )}
                        pin={sheet.approval.pin}
                        setPin={sheet.approval.setPin}
                        onApprove={sheet.approval.approve}
                        error={sheet.approval.error}
                    />
                ) : sheet.approval.approved ? (
                    <Notice tone="success" banner>
                        {d.approvalOk}
                    </Notice>
                ) : null}
                {sheet.scope === "lines" && sheet.keys.length === 0 ? (
                    <p className="text-xs text-muted">{d.chooseLines}</p>
                ) : null}
                <div className="flex justify-end gap-2 border-t border-line pt-4">
                    <Button variant="quiet" onPress={onClose}>
                        {d.cancel}
                    </Button>
                    <Button
                        disabled={sheet.approval.needed}
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

export function TicketPanel({ sale, onCharge }: { sale: SaleTicket; onCharge: () => void }) {
    const [selected, setSelected] = useState<string | null>(null);
    const [discounting, setDiscounting] = useState(false);
    return (
        <aside
            className="sticky top-6 flex max-h-[calc(100vh-8rem)] w-[340px] shrink-0 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-card xl:w-[380px]"
            aria-label={d.ticket}
        >
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                <div className="flex items-baseline gap-2">
                    <h2 className="font-display text-base font-bold text-ink">{d.ticket}</h2>
                    <span className="text-xs tabular-nums text-muted">{sale.number}</span>
                </div>
                {sale.isEmpty ? null : (
                    <Button size="sm" variant="quiet" onPress={sale.clear}>
                        {d.clear}
                    </Button>
                )}
            </div>
            <div className="border-b border-line px-5 py-3.5">
                <ClientPicker sale={sale} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5">
                {sale.held !== null ? (
                    <div className="pt-3">
                        <Notice tone="success">{sale.held}</Notice>
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
                                    title={v.title}
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
                            <span className="text-xs text-muted">
                                {sale.limitBps !== null
                                    ? d.limitNote(pct(sale.limitBps))
                                    : d.taxFollows}
                            </span>
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
                        <TicketApproval sale={sale} />
                    </div>
                )}
            </div>
            <div className="space-y-3 border-t border-line bg-surface px-5 pb-5 pt-3.5">
                {sale.isEmpty ? null : <DocTotals lines={sale.totalLines} density="compact" />}
                {sale.error !== null && sale.phase === "cart" ? (
                    <Notice tone="danger">{sale.error}</Notice>
                ) : null}
                <Button
                    size="lg"
                    full
                    onPress={onCharge}
                    disabled={sale.isEmpty || !sale.ratesReady || sale.overLimit}
                >
                    {sale.isEmpty ? d.review : d.charge(formatMoney(sale.totals.dueCents))}
                </Button>
            </div>
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
                            cents: Math.round(Number(custom || "0") * 100),
                        });
                    else sale.setTip({ kind: "percent", pct: Number(k) });
                }}
            />
            {sale.tip.kind === "custom" ? (
                <TextField
                    label={d.tipAmount}
                    prefix="$"
                    type="number"
                    width="narrow"
                    value={custom}
                    onChange={(v) => {
                        setCustom(v);
                        const n = Number(v);
                        sale.setTip({
                            kind: "custom",
                            cents: Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0,
                        });
                    }}
                />
            ) : null}
        </div>
    );
}

/** Tips B: the tip and how it's shared between the people who served. */
function TipBlock({ sale }: { sale: SaleTicket }) {
    const tip = sale.totals.tipCents;
    return (
        <section className="space-y-3" aria-label={d.tipSection}>
            <Heading>{d.tipSection}</Heading>
            <TipChips sale={sale} />
            <p className="text-xs text-muted">{d.tipOn(formatMoney(sale.totals.subtotalCents))}</p>
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
                                    <Avatar name={sh.name} size="sm" color={sh.color} />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium text-ink">
                                            {sh.name}
                                        </span>
                                        <span className="block text-xs text-muted">
                                            {d.tipShareOf(Math.round((sh.cents / tip) * 100))}
                                        </span>
                                    </span>
                                    <span className="text-sm font-semibold tabular-nums text-ink">
                                        {formatMoney(sh.cents)}
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
                        prefix="$"
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
                                sale.setCashGiven((c / 100).toFixed(2));
                            }}
                        >
                            {i === 0 ? d.exactCash : formatMoney(c)}
                        </Button>
                    ))}
                </div>
            </div>
            <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted">{d.changeDue}</span>
                <span
                    className={`font-display text-xl font-bold tabular-nums ${sale.changeCents !== null && sale.changeCents < 0 ? "text-danger" : "text-ink"}`}
                >
                    {formatMoney(Math.max(0, sale.changeCents ?? 0))}
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
    const [channel, setChannel] = useState<ReceiptChannel>(
        sale.client?.phone != null ? "sms" : "email",
    );
    if (r.sent !== null) {
        return (
            <Notice tone="success" banner>
                {r.sent === "none"
                    ? d.receiptSkipped
                    : d.receiptSent(r.sent === "email" ? r.email : r.phone)}
            </Notice>
        );
    }
    return (
        <div className="space-y-3">
            <Choice
                layout="segmented"
                label={d.receiptTitle}
                options={[
                    { key: "sms", label: d.receiptText },
                    { key: "email", label: d.receiptEmail },
                    { key: "none", label: d.receiptNone },
                ]}
                value={channel}
                onChange={setChannel}
            />
            {channel === "none" ? (
                <Button
                    variant="outline"
                    onPress={() => {
                        r.send("none");
                    }}
                >
                    {d.receiptNone}
                </Button>
            ) : (
                <div className="flex items-end gap-2">
                    <div className="flex-1">
                        {channel === "email" ? (
                            <TextField
                                label={d.receiptEmailTo}
                                type="email"
                                value={r.email}
                                onChange={r.setEmail}
                            />
                        ) : (
                            <TextField
                                label={d.receiptPhoneTo}
                                type="tel"
                                value={r.phone}
                                onChange={r.setPhone}
                            />
                        )}
                    </div>
                    <Button
                        variant="outline"
                        busy={r.busy}
                        onPress={() => {
                            r.send(channel);
                        }}
                    >
                        {channel === "email" ? d.sendEmail : d.sendText}
                    </Button>
                </div>
            )}
            {r.error !== null ? <Notice tone="danger">{r.error}</Notice> : null}
        </div>
    );
}

const METHOD_LABEL: Record<SalePayMethod, string> = {
    tap: d.methodTap,
    saved: d.methodCard,
    card: d.methodCard,
    cash: d.methodCash,
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
    const method =
        sale.method === "saved" && sale.savedCardLabel !== null
            ? sale.savedCardLabel
            : METHOD_LABEL[sale.method];
    return (
        <div className="space-y-5">
            <div className="flex flex-col items-center pt-2 text-center">
                <Icon name="check" size={32} className="text-ink-soft" />
                <h2 className="mt-3 font-display text-xl font-bold text-ink">{d.paidTitle}</h2>
                <p className="mt-1 text-sm text-muted">
                    {d.paidBody(formatMoney(sale.paidCents), method)}
                </p>
                {sale.changeGiven !== null && sale.changeGiven > 0 ? (
                    <p className="mt-3 rounded-md bg-warn-bg px-3 py-1.5 text-sm font-semibold text-warn-fg">
                        {d.changeToGive(formatMoney(sale.changeGiven))}
                    </p>
                ) : null}
            </div>
            <div>
                <Heading>{d.receiptTitle}</Heading>
                <ReceiptChooser sale={sale} />
            </div>
            <div className="flex gap-2 border-t border-line pt-4">
                {sale.client !== null ? (
                    <Button variant="outline" grow icon="calendar" onPress={onBookNext}>
                        {d.bookNext}
                    </Button>
                ) : null}
                <Button grow onPress={onNew}>
                    {d.newSale}
                </Button>
            </div>
        </div>
    );
}

/** Checkout A: one sheet for the tip, how the client pays and the charge, then the receipt. */
export function PaySheet({
    sale,
    onClose,
    onBookNext,
}: {
    sale: SaleTicket;
    onClose: () => void;
    onBookNext: () => void;
}) {
    const close = sale.busy ? () => undefined : onClose;
    if (sale.phase === "paid") {
        return (
            <Modal open onClose={close} size="lg">
                <PaidSummary
                    sale={sale}
                    onNew={() => {
                        sale.newSale();
                        onClose();
                    }}
                    onBookNext={() => {
                        sale.newSale();
                        onBookNext();
                    }}
                />
            </Modal>
        );
    }
    if (sale.checkout.clientSecret !== null) {
        return (
            <Modal open onClose={close} size="lg">
                <ChargeSheet
                    checkout={sale.checkout}
                    methods={[]}
                    amountLabel={formatMoney(sale.paidCents)}
                    submitLabel={d.charge(formatMoney(sale.paidCents))}
                    busyLabel={d.charging}
                    onSubmit={() => undefined}
                    onCancel={sale.checkout.cancel}
                />
            </Modal>
        );
    }
    const due = sale.totals.dueCents;
    return (
        <Modal open onClose={close} size="lg">
            <div className="-mr-2 max-h-[calc(100vh-7rem)] space-y-5 overflow-y-auto pr-2">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h2 className="font-display text-lg font-bold text-ink">{d.payTitle}</h2>
                        <p className="mt-0.5 text-sm text-muted">
                            {d.payFor(sale.client?.name ?? d.walkIn)}
                        </p>
                    </div>
                    <div className="text-right">
                        <p className="font-display text-3xl font-bold tabular-nums text-ink">
                            {formatMoney(due)}
                        </p>
                        {sale.totals.depositCents > 0 ? (
                            <p className="text-xs text-muted">
                                {d.depositCredit(formatMoney(sale.totals.depositCents))}
                            </p>
                        ) : null}
                    </div>
                </div>
                <TipBlock sale={sale} />
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
                {sale.error !== null ? (
                    <Notice tone="danger" banner>
                        {sale.error}
                    </Notice>
                ) : null}
                <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
                    <Button variant="quiet" onPress={onClose} disabled={sale.busy}>
                        {d.backToTicket}
                    </Button>
                    <Button
                        size="lg"
                        onPress={() => {
                            sale.charge();
                        }}
                        busy={sale.busy}
                        disabled={sale.method === "tap"}
                    >
                        {sale.busy ? d.charging : d.charge(formatMoney(due))}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
