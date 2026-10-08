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
    useConnectionToken,
    useDiscountEditor,
    useDiscountSheet,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { type ReactNode, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
    Avatar,
    Button,
    ChargeSheet,
    Checkbox,
    Choice,
    DocTotals,
    LineItem,
    ListRow,
    Modal,
    Notice,
    SearchField,
    TextField,
} from "@clientbridge/ui";

import { api } from "../lib/api";
import { TerminalProvider, useTerminalCheckout } from "./Terminal";

const d = strings.pos.desk;
const c = theme.colors;

function Heading({ children }: { children: string }) {
    return <Text style={styles.heading}>{children.toUpperCase()}</Text>;
}

function DiscountFields({ editor, baseCents }: { editor: DiscountEditor; baseCents: number }) {
    const known = editor.reasons.includes(editor.reason);
    return (
        <View style={styles.stack}>
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
            <TextField
                label={editor.kind === "amount" ? d.amountOff : d.percentOff}
                type="number"
                {...(editor.kind === "amount" ? { prefix: "$" } : {})}
                value={editor.value}
                onChange={editor.setValue}
            />
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
            />
            {editor.previewCents > 0 ? (
                <Text style={styles.soft}>
                    {d.discountPreview(
                        formatMoney(editor.previewCents),
                        formatMoney(baseCents - editor.previewCents),
                    )}
                </Text>
            ) : null}
            {editor.error !== null ? <Notice tone="danger">{editor.error}</Notice> : null}
        </View>
    );
}

/** A percent or amount off with its reason: a ticket line, or an invoice or estimate line. */
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
        <View style={styles.card}>
            <Text style={styles.cardTitle}>{title}</Text>
            <DiscountFields editor={editor} baseCents={baseCents} />
            <View style={styles.row}>
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
                    <Button variant="quiet" size="sm" onPress={onCancel}>
                        {d.cancel}
                    </Button>
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
            </View>
        </View>
    );
}

function ClientPicker({ sale }: { sale: SaleTicket }) {
    const clients = useClients();
    const [searching, setSearching] = useState(false);
    const [q, setQ] = useState("");
    if (searching) {
        return (
            <View style={styles.stack}>
                <SearchField value={q} onChange={setQ} placeholder={d.clientSearch} />
                <ListRow
                    density="compact"
                    icon="user"
                    title={d.walkIn}
                    onPress={() => {
                        sale.setClientId(null);
                        setSearching(false);
                    }}
                />
                {filterClients(clients, q)
                    .slice(0, 6)
                    .map((cl) => (
                        <ListRow
                            key={cl.id}
                            density="compact"
                            leading={<Avatar name={cl.name} size="sm" />}
                            title={cl.name}
                            detail={formatPhone(cl.phone) || (cl.email ?? "")}
                            onPress={() => {
                                sale.setClientId(cl.id);
                                setSearching(false);
                                setQ("");
                            }}
                        />
                    ))}
            </View>
        );
    }
    return (
        <ListRow
            density="compact"
            {...(sale.client === null
                ? { icon: "user" as const }
                : { leading: <Avatar name={sale.client.name} size="sm" /> })}
            title={sale.client?.name ?? d.walkIn}
            detail={sale.client?.detail ?? d.clientHint}
            meta={sale.client === null ? d.chooseClient : d.changeClient}
            onPress={() => {
                setSearching(true);
            }}
        />
    );
}

const pct = (bps: number | null): string => String((bps ?? 0) / 100);

function Approval({
    body,
    pin,
    setPin,
    onApprove,
    error,
}: {
    body: string;
    pin: string;
    setPin: (v: string) => void;
    onApprove: () => void;
    error: string | null;
}) {
    return (
        <View style={styles.warn}>
            <Text style={styles.warnTitle}>{d.approvalTitle}</Text>
            <Text style={styles.soft}>{body}</Text>
            <TextField
                label={d.approvalPin}
                type="password"
                value={pin}
                onChange={setPin}
                error={error}
                maxLength={4}
            />
            <Button variant="outline" onPress={onApprove}>
                {d.approve}
            </Button>
            <Text style={styles.note}>{d.pinHint}</Text>
        </View>
    );
}

function TicketApproval({ sale }: { sale: SaleTicket }) {
    const [pin, setPin] = useState("");
    const [error, setError] = useState<string | null>(null);
    if (!sale.overLimit) return null;
    return (
        <Approval
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

/** Discounts B on a phone: scope, amount and reason, a before and after, and the approver's PIN. */
function DiscountSheetBody({ sale, onDone }: { sale: SaleTicket; onDone: () => void }) {
    const sheet = useDiscountSheet(api, sale);
    const p = sheet.preview;
    const base =
        sheet.scope === "sale"
            ? sale.totals.subtotalCents + sale.totals.saleDiscountCents
            : sale.lines
                  .filter((l) => sheet.keys.includes(l.key))
                  .reduce((n, l) => n + l.grossCents, 0);
    return (
        <View style={styles.stack}>
            <Text style={styles.title}>{d.discountTitle}</Text>
            {sale.limitBps !== null ? (
                <Text style={styles.note}>{d.limitNote(pct(sale.limitBps))}</Text>
            ) : null}
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
            {sheet.scope === "lines"
                ? sale.lines.map((l) => (
                      <Checkbox
                          key={l.key}
                          label={`${l.description} · ${formatMoney(l.grossCents)}`}
                          value={sheet.keys.includes(l.key)}
                          onChange={() => {
                              sheet.toggleKey(l.key);
                          }}
                      />
                  ))
                : null}
            <DiscountFields editor={sheet.editor} baseCents={base} />
            <DocTotals
                density="compact"
                lines={[
                    { key: "off", label: d.youSave, cents: p.after.discountCents, kind: "credit" },
                    {
                        key: "sub",
                        label: d.subtotal,
                        cents: p.after.subtotalCents,
                        kind: "subtotal",
                    },
                    { key: "tax", label: d.tax, cents: p.after.taxCents, kind: "tax" },
                    { key: "due", label: d.dueNow, cents: p.after.dueCents, kind: "balance" },
                ]}
            />
            <Text style={styles.note}>{d.taxFollows}</Text>
            {sheet.approval.needed ? (
                <Approval
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
                <Notice tone="success">{d.approvalOk}</Notice>
            ) : null}
            <Button
                size="lg"
                full
                disabled={sheet.approval.needed}
                onPress={() => {
                    if (sheet.apply()) onDone();
                }}
            >
                {d.applyDiscount}
            </Button>
            <Button variant="quiet" full onPress={onDone}>
                {d.cancel}
            </Button>
        </View>
    );
}

function TipBlock({ sale }: { sale: SaleTicket }) {
    const [custom, setCustom] = useState("");
    const tip = sale.totals.tipCents;
    return (
        <View style={styles.stack}>
            <Heading>{d.tipSection}</Heading>
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
            <Text style={styles.note}>{d.tipOn(formatMoney(sale.totals.subtotalCents))}</Text>
            {tip > 0 ? (
                <View style={styles.stack}>
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
                        <Text style={styles.note}>{d.tipNobody}</Text>
                    ) : (
                        sale.tipShares.map((sh) => (
                            <ListRow
                                key={sh.staffId}
                                density="compact"
                                leading={<Avatar name={sh.name} size="sm" color={sh.color} />}
                                title={sh.name}
                                detail={d.tipShareOf(Math.round((sh.cents / tip) * 100))}
                                meta={formatMoney(sh.cents)}
                            />
                        ))
                    )}
                </View>
            ) : null}
        </View>
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
        <View style={styles.box}>
            <TextField
                label={d.cashGiven}
                prefix="$"
                type="number"
                value={sale.cashGiven}
                onChange={sale.setCashGiven}
            />
            <View style={styles.wrap}>
                {quick.map((cents, i) => (
                    <Button
                        key={cents}
                        size="sm"
                        variant="outline"
                        onPress={() => {
                            sale.setCashGiven((cents / 100).toFixed(2));
                        }}
                    >
                        {i === 0 ? d.exactCash : formatMoney(cents)}
                    </Button>
                ))}
            </View>
            <View style={styles.row}>
                <Text style={styles.soft}>{d.changeDue}</Text>
                <Text style={styles.big}>{formatMoney(Math.max(0, sale.changeCents ?? 0))}</Text>
            </View>
        </View>
    );
}

function ReceiptChooser({ sale }: { sale: SaleTicket }) {
    const r = sale.receipt;
    const [channel, setChannel] = useState<ReceiptChannel>(
        sale.client?.phone != null ? "sms" : "email",
    );
    if (r.sent !== null)
        return (
            <Notice tone="success">
                {r.sent === "none"
                    ? d.receiptSkipped
                    : d.receiptSent(r.sent === "email" ? r.email : r.phone)}
            </Notice>
        );
    return (
        <View style={styles.stack}>
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
            {channel === "email" ? (
                <TextField
                    label={d.receiptEmailTo}
                    type="email"
                    value={r.email}
                    onChange={r.setEmail}
                />
            ) : channel === "sms" ? (
                <TextField
                    label={d.receiptPhoneTo}
                    type="tel"
                    value={r.phone}
                    onChange={r.setPhone}
                />
            ) : null}
            <Button
                variant="outline"
                busy={r.busy}
                onPress={() => {
                    r.send(channel);
                }}
            >
                {channel === "email" ? d.sendEmail : channel === "sms" ? d.sendText : d.receiptNone}
            </Button>
            {r.error !== null ? <Notice tone="danger">{r.error}</Notice> : null}
        </View>
    );
}

const METHOD_LABEL: Record<SalePayMethod, string> = {
    tap: d.methodTap,
    saved: d.methodCard,
    card: d.methodCard,
    cash: d.methodCash,
};

/** Tap to Pay: connects the phone's reader, then collects the sale's PaymentIntent. */
function Reader({ sale }: { sale: SaleTicket }) {
    const terminal = useTerminalCheckout();
    const secret = sale.terminal?.clientSecret ?? null;
    const { ready, charge, phase } = terminal;
    useEffect(() => {
        if (ready && secret !== null && phase === "ready") charge(secret);
    }, [ready, secret, phase, charge]);
    useEffect(() => {
        if (phase === "done") sale.markPaid();
    }, [phase, sale]);
    return (
        <View style={styles.stack}>
            <Text style={styles.title}>
                {phase === "error"
                    ? strings.terminal.failed
                    : phase === "connecting"
                      ? strings.terminal.connecting
                      : d.tapReady}
            </Text>
            <Text style={styles.soft}>
                {phase === "connecting"
                    ? strings.terminal.setup
                    : phase === "collecting"
                      ? d.tapWaiting
                      : d.tapHold}
            </Text>
            {terminal.error !== null ? <Notice tone="danger">{terminal.error}</Notice> : null}
            {phase === "error" && terminal.retry !== null ? (
                <Button variant="outline" onPress={terminal.retry}>
                    {strings.terminal.retry}
                </Button>
            ) : null}
        </View>
    );
}

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
        <View style={styles.stack}>
            <Text style={styles.title}>{d.paidTitle}</Text>
            <Text style={styles.soft}>{d.paidBody(formatMoney(sale.paidCents), method)}</Text>
            {sale.changeGiven !== null && sale.changeGiven > 0 ? (
                <Notice tone="info">{d.changeToGive(formatMoney(sale.changeGiven))}</Notice>
            ) : null}
            <Heading>{d.receiptTitle}</Heading>
            <ReceiptChooser sale={sale} />
            {sale.client !== null ? (
                <Button variant="outline" full icon="calendar" onPress={onBookNext}>
                    {d.bookNext}
                </Button>
            ) : null}
            <Button size="lg" full onPress={onNew}>
                {d.newSale}
            </Button>
        </View>
    );
}

function PayBody({ sale, onBack }: { sale: SaleTicket; onBack: () => void }) {
    const due = sale.totals.dueCents;
    if (sale.terminal !== null) return <Reader sale={sale} />;
    if (sale.checkout.clientSecret !== null)
        return (
            <ChargeSheet
                checkout={sale.checkout}
                methods={[]}
                amountLabel={formatMoney(sale.paidCents)}
                submitLabel={d.charge(formatMoney(sale.paidCents))}
                busyLabel={d.charging}
                onSubmit={() => undefined}
                onCancel={sale.checkout.cancel}
            />
        );
    return (
        <View style={styles.stack}>
            <View style={styles.row}>
                <View style={styles.grow}>
                    <Text style={styles.title}>{d.payTitle}</Text>
                    <Text style={styles.soft}>{d.payFor(sale.client?.name ?? d.walkIn)}</Text>
                </View>
                <Text style={styles.big}>{formatMoney(due)}</Text>
            </View>
            {sale.totals.depositCents > 0 ? (
                <Text style={styles.note}>
                    {d.depositCredit(formatMoney(sale.totals.depositCents))}
                </Text>
            ) : null}
            <TipBlock sale={sale} />
            <Heading>{d.howPaying}</Heading>
            <Choice
                layout="tiles"
                columns={2}
                label={d.howPaying}
                value={sale.method}
                onChange={sale.setMethod}
                options={sale.payOptions}
            />
            {sale.method === "cash" ? <CashBox sale={sale} /> : null}
            {sale.method === "saved" && sale.savedCardLabel !== null ? (
                <Text style={styles.soft}>{d.savedCardCharge(sale.savedCardLabel)}</Text>
            ) : null}
            {sale.error !== null ? <Notice tone="danger">{sale.error}</Notice> : null}
            <Button
                size="lg"
                full
                busy={sale.busy}
                {...(sale.method === "tap" ? { icon: "contactless" as const } : {})}
                onPress={() => {
                    sale.charge();
                }}
            >
                {sale.busy
                    ? d.charging
                    : sale.method === "tap"
                      ? d.collect(formatMoney(due))
                      : d.charge(formatMoney(due))}
            </Button>
            <Button variant="quiet" full onPress={onBack} disabled={sale.busy}>
                {d.backToTicket}
            </Button>
        </View>
    );
}

type SheetStep = "ticket" | "discount" | "pay";

/** The ticket on a phone: lines, discounts and totals, then the payment sheet and the receipt. */
export function TicketSheet({
    sale,
    open,
    onClose,
    onBookNext,
}: {
    sale: SaleTicket;
    open: boolean;
    onClose: () => void;
    onBookNext: () => void;
}) {
    const [step, setStep] = useState<SheetStep>("ticket");
    const [selected, setSelected] = useState<string | null>(null);
    const tokenProvider = useConnectionToken(api);
    const close = (): void => {
        if (sale.busy) return;
        setStep("ticket");
        onClose();
    };
    let body: ReactNode;
    if (sale.phase === "paid")
        body = (
            <PaidSummary
                sale={sale}
                onNew={() => {
                    sale.newSale();
                    close();
                }}
                onBookNext={() => {
                    sale.newSale();
                    close();
                    onBookNext();
                }}
            />
        );
    else if (step === "pay")
        body = (
            <PayBody
                sale={sale}
                onBack={() => {
                    setStep("ticket");
                }}
            />
        );
    else if (step === "discount")
        body = (
            <DiscountSheetBody
                sale={sale}
                onDone={() => {
                    setStep("ticket");
                }}
            />
        );
    else
        body = (
            <View style={styles.stack}>
                <View style={styles.row}>
                    <Text style={styles.title}>{d.ticket}</Text>
                    <Text style={styles.note}>{sale.number}</Text>
                </View>
                <ClientPicker sale={sale} />
                {sale.held !== null ? <Notice tone="success">{sale.held}</Notice> : null}
                {sale.views.map((v) => (
                    <View key={v.key}>
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
                            <DiscountForm
                                title={d.discountLine(v.title)}
                                initial={sale.lines.find((l) => l.key === v.key)?.discount ?? null}
                                baseCents={v.grossCents}
                                onApply={(next) => {
                                    sale.setLineDiscount(v.key, next);
                                    setSelected(null);
                                }}
                                onCancel={() => {
                                    setSelected(null);
                                }}
                            />
                        ) : null}
                    </View>
                ))}
                {sale.isEmpty ? (
                    <Text style={styles.soft}>{d.emptyTicketShort}</Text>
                ) : (
                    <View style={styles.wrap}>
                        <Button
                            size="sm"
                            variant="outline"
                            icon="percent"
                            onPress={() => {
                                setStep("discount");
                            }}
                        >
                            {sale.saleDiscount !== null
                                ? d.discountedBy(discountLabel(sale.saleDiscount))
                                : d.addDiscount}
                        </Button>
                        <Button
                            size="sm"
                            variant="quiet"
                            onPress={() => {
                                sale.hold();
                                close();
                            }}
                        >
                            {d.holdSale}
                        </Button>
                    </View>
                )}
                <TicketApproval sale={sale} />
                {sale.isEmpty ? null : <DocTotals lines={sale.totalLines} density="compact" />}
                {sale.error !== null ? <Notice tone="danger">{sale.error}</Notice> : null}
                <Button
                    size="lg"
                    full
                    disabled={sale.isEmpty || !sale.ratesReady || sale.overLimit}
                    onPress={() => {
                        setStep("pay");
                    }}
                >
                    {d.charge(formatMoney(sale.totals.dueCents))}
                </Button>
            </View>
        );
    return (
        <Modal open={open} onClose={close} size="xl">
            {sale.terminal !== null ? (
                <TerminalProvider tokenProvider={tokenProvider}>
                    <View>{body}</View>
                </TerminalProvider>
            ) : (
                body
            )}
        </Modal>
    );
}

const styles = StyleSheet.create({
    stack: { gap: 12 },
    row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    grow: { flex: 1 },
    heading: { color: c.muted, fontSize: 11, fontWeight: "600", letterSpacing: 0.6 },
    title: { color: c.ink, fontSize: 18, fontWeight: "700" },
    big: { color: c.ink, fontSize: 24, fontWeight: "700", fontVariant: ["tabular-nums"] },
    soft: { color: c.inkSoft, fontSize: 14 },
    note: { color: c.muted, fontSize: 12 },
    card: {
        gap: 12,
        marginTop: 6,
        marginBottom: 10,
        padding: 14,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.accentLine,
        backgroundColor: c.surface,
    },
    cardTitle: { color: c.ink, fontSize: 14, fontWeight: "600" },
    box: {
        gap: 10,
        padding: 14,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.bg,
    },
    warn: { gap: 10, padding: 14, borderRadius: theme.radius, backgroundColor: c.warnBg },
    warnTitle: { color: c.warnFg, fontSize: 14, fontWeight: "600" },
});
