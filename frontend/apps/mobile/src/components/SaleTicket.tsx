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
    usePeoplePhotos,
    useTerminalConnection,
    useDiscountEditor,
    useDiscountSheet,
    formatParts,
    BUSINESS_CURRENCY,
    currencyAffix,
    parseCents,
    formatAmountInput,
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
import { theme } from "@clientbridge/tokens/native";
import { type ReactNode, useEffect, useMemo, useState } from "react";
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
    Panel,
    SearchField,
    SearchSelect,
    SheetHeader,
    TextField,
    ItemImage,
} from "@clientbridge/ui";

import { api, apiBaseUrl } from "../lib/api";
import { useViewer } from "../lib/auth";
import { TerminalProvider, useTerminalCheckout } from "./Terminal";

const d = strings.pos.desk;
const c = theme.colors;

function Heading({ children }: { children: string }) {
    return <Text style={styles.heading}>{children}</Text>;
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
                {...(editor.kind === "amount" ? currencyAffix(BUSINESS_CURRENCY) : {})}
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
                        formatMoney(editor.previewCents, BUSINESS_CURRENCY),
                        formatMoney(baseCents - editor.previewCents, BUSINESS_CURRENCY),
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
        <Panel title={title} style={styles.card}>
            <DiscountFields editor={editor} baseCents={baseCents} />
            <View style={styles.row}>
                {initial !== null ? (
                    <Button
                        style={{ alignSelf: "center" }}
                        variant="link"
                        size="sm"
                        onPress={() => {
                            onApply(null);
                        }}
                    >
                        {d.removeDiscount}
                    </Button>
                ) : (
                    <Button
                        style={{ alignSelf: "center" }}
                        variant="quiet"
                        size="sm"
                        onPress={onCancel}
                    >
                        {d.cancel}
                    </Button>
                )}
                <Button
                    style={{ alignSelf: "center" }}
                    size="sm"
                    onPress={() => {
                        const next = editor.apply();
                        if (next !== null) onApply(next);
                    }}
                >
                    {d.applyDiscount}
                </Button>
            </View>
        </Panel>
    );
}

function ClientPicker({ sale }: { sale: SaleTicket }) {
    const photos = usePeoplePhotos();
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
                            leading={<Avatar name={cl.name} src={photos.client(cl.id)} size="sm" />}
                            title={cl.name}
                            detail={formatPhone(cl.phone)}
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
                : {
                      leading: (
                          <Avatar
                              name={sale.client.name}
                              src={photos.client(sale.client.id)}
                              size="sm"
                          />
                      ),
                  })}
            title={sale.client?.name ?? d.walkIn}
            detail={sale.client?.detail ?? d.clientHint}
            meta={sale.client === null ? d.chooseClient : d.changeClient}
            onPress={() => {
                setSearching(true);
            }}
        />
    );
}

/** Discounts B on a phone: scope, amount and reason, and a before and after. */
function DiscountSheetBody({ sale, onDone }: { sale: SaleTicket; onDone: () => void }) {
    const sheet = useDiscountSheet(sale);
    const p = sheet.preview;
    const base =
        sheet.scope === "sale"
            ? sale.totals.subtotalCents + sale.totals.saleDiscountCents
            : sale.lines
                  .filter((l) => sheet.keys.includes(l.key))
                  .reduce((n, l) => n + l.grossCents, 0);
    return (
        <View style={styles.stack}>
            <SheetHeader title={d.discountTitle} />
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
            {sheet.scope === "lines"
                ? sale.lines.map((l) => (
                      <Checkbox
                          key={l.key}
                          label={formatParts([
                              l.description,
                              formatMoney(l.grossCents, BUSINESS_CURRENCY),
                          ])}
                          value={sheet.keys.includes(l.key)}
                          onChange={() => {
                              sheet.toggleKey(l.key);
                          }}
                      />
                  ))
                : null}
            <DiscountFields editor={sheet.editor} baseCents={base} />
            <DocTotals
                currency={BUSINESS_CURRENCY}
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
            <Button
                size="lg"
                full
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
    const photos = usePeoplePhotos();
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
            <Text style={styles.note}>
                {d.tipOn(formatMoney(sale.totals.subtotalCents, BUSINESS_CURRENCY))}
            </Text>
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
                                leading={
                                    <Avatar
                                        name={sh.name}
                                        src={photos.staff(sh.staffId)}
                                        size="sm"
                                        color={sh.color}
                                    />
                                }
                                title={sh.name}
                                detail={d.tipShareOf(Math.round((sh.cents / tip) * 100))}
                                meta={formatMoney(sh.cents, BUSINESS_CURRENCY)}
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
                {...currencyAffix(BUSINESS_CURRENCY)}
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
                            sale.setCashGiven(formatAmountInput(cents, BUSINESS_CURRENCY));
                        }}
                    >
                        {i === 0 ? d.exactCash : formatMoney(cents, BUSINESS_CURRENCY)}
                    </Button>
                ))}
            </View>
            <View style={styles.row}>
                <Text style={styles.soft}>{d.changeDue}</Text>
                <Text style={styles.big}>
                    {formatMoney(Math.max(0, sale.changeCents ?? 0), BUSINESS_CURRENCY)}
                </Text>
            </View>
        </View>
    );
}

function ReceiptChooser({ sale }: { sale: SaleTicket }) {
    const r = sale.receipt;
    const [choice, setChoice] = useState<"text" | "skip">(
        sale.client?.phone != null ? "text" : "skip",
    );
    if (r.sent !== null)
        return (
            <Notice tone="success">
                {r.sent === "skipped" ? d.receiptSkipped : d.receiptSent(r.phone)}
            </Notice>
        );
    return (
        <View style={styles.stack}>
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
            {choice === "text" ? (
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
                    if (choice === "text") r.send();
                    else r.skip();
                }}
            >
                {choice === "text" ? d.sendText : d.receiptNone}
            </Button>
            {r.error !== null ? <Notice tone="danger">{r.error}</Notice> : null}
        </View>
    );
}

function VisitNoteBlock({ clientId, bookingId }: { clientId: string; bookingId: string }) {
    const note = useVisitNote(api, clientId, bookingId);
    return (
        <View style={styles.stack}>
            <Heading>{d.visitNote}</Heading>
            <TextField
                label={d.visitNote}
                multiline
                rows={3}
                value={note.body}
                onChange={note.setBody}
                placeholder={d.visitNotePlaceholder}
            />
            <Text style={styles.note}>{d.visitNotePhotos(note.sharedPhotos)}</Text>
            {note.error !== null ? <Notice tone="danger">{note.error}</Notice> : null}
            {note.sent ? <Notice tone="success">{d.visitNoteSent}</Notice> : null}
            <Button
                variant="outline"
                full
                icon="send"
                busy={note.busy}
                disabled={note.body.trim() === ""}
                onPress={note.submit}
            >
                {d.visitNoteSend}
            </Button>
        </View>
    );
}

function GiftCardEntry({ sale }: { sale: SaleTicket }) {
    const g = sale.giftCard;
    return (
        <View style={styles.stack}>
            <View style={styles.row}>
                <View style={styles.grow}>
                    <TextField label={d.giftCardCode} value={g.code} onChange={g.setCode} />
                </View>
                <Button
                    variant="outline"
                    busy={g.busy}
                    disabled={g.code.trim() === "" || sale.busy}
                    onPress={g.apply}
                >
                    {d.giftCardApply}
                </Button>
            </View>
            {g.error !== null ? <Notice tone="danger">{g.error}</Notice> : null}
        </View>
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

/** Tap to Pay: connects the phone's reader, then collects the sale's PaymentIntent. */
function Reader({ sale, locationId }: { sale: SaleTicket; locationId: string | null }) {
    const terminal = useTerminalCheckout(locationId);
    const secret = sale.terminal?.clientSecret ?? null;
    const { ready, charge, phase, stop } = terminal;
    useEffect(() => {
        if (ready && secret !== null && phase === "ready") charge(secret);
    }, [ready, secret, phase, charge]);
    useEffect(() => {
        if (phase === "done") sale.markPaid();
    }, [phase, sale]);
    return (
        <View style={styles.stack}>
            <SheetHeader
                title={
                    phase === "error"
                        ? strings.terminal.failed
                        : phase === "connecting"
                          ? strings.terminal.connecting
                          : d.tapReady
                }
            />
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
            {sale.error !== null ? <Notice tone="danger">{sale.error}</Notice> : null}
            <Button
                variant="quiet"
                busy={sale.busy}
                onPress={() => {
                    stop()
                        .catch(() => undefined)
                        .finally(sale.cancelCheckout);
                }}
            >
                {d.cancelCheckout}
            </Button>
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
    const nextStart = useNextVisit(sale.visitId)?.start ?? null;
    const zone = useBusinessZone();
    const method = sale.paidByGiftCard
        ? d.paidByGiftCard
        : sale.method === "saved" && sale.savedCardLabel !== null
          ? sale.savedCardLabel
          : METHOD_LABEL[sale.method];
    return (
        <View style={styles.stack}>
            <SheetHeader title={d.paidTitle} />
            <Text style={styles.soft}>
                {d.paidBody(formatMoney(sale.paidCents, BUSINESS_CURRENCY), method)}
            </Text>
            {sale.changeGiven !== null && sale.changeGiven > 0 ? (
                <Notice tone="info">
                    {d.changeToGive(formatMoney(sale.changeGiven, BUSINESS_CURRENCY))}
                </Notice>
            ) : null}
            <Heading>{d.receiptTitle}</Heading>
            <ReceiptChooser sale={sale} />
            {sale.client !== null && sale.visitId !== null ? (
                <VisitNoteBlock clientId={sale.client.id} bookingId={sale.visitId} />
            ) : null}
            {sale.client !== null ? (
                <Button variant="outline" full icon="calendar" onPress={onBookNext}>
                    {nextStart === null
                        ? d.bookNext
                        : d.bookNextOn(formatMonthDay(nextStart, zone))}
                </Button>
            ) : null}
            <Button size="lg" full onPress={onNew}>
                {d.newSale}
            </Button>
        </View>
    );
}

function PayBody({
    sale,
    locationId,
    onBack,
}: {
    sale: SaleTicket;
    locationId: string | null;
    onBack: () => void;
}) {
    const due = sale.totals.dueCents;
    if (sale.terminal !== null) return <Reader sale={sale} locationId={locationId} />;
    if (sale.checkout.clientSecret !== null)
        return (
            <ChargeSheet
                checkout={sale.checkout}
                methods={[]}
                amountLabel={formatMoney(sale.paidCents, BUSINESS_CURRENCY)}
                submitLabel={d.charge(formatMoney(sale.paidCents, BUSINESS_CURRENCY))}
                busyLabel={d.charging}
                onSubmit={() => undefined}
                onCancel={sale.cancelCheckout}
            />
        );
    return (
        <View style={styles.stack}>
            <SheetHeader
                title={d.payTitle}
                subtitle={d.payFor(sale.client?.name ?? d.walkIn)}
                onClose={sale.busy ? undefined : onBack}
                closeLabel={d.backToTicket}
            />
            <TipBlock sale={sale} />
            <GiftCardEntry sale={sale} />
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
            <DocTotals currency={BUSINESS_CURRENCY} lines={sale.totalLines} density="compact" />
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
                      ? d.collect(formatMoney(due, BUSINESS_CURRENCY))
                      : d.charge(formatMoney(due, BUSINESS_CURRENCY))}
            </Button>
            {sale.canInvoice ? (
                <Button
                    variant="outline"
                    full
                    icon="send"
                    disabled={sale.busy}
                    onPress={sale.sendAsInvoice}
                >
                    {d.sendAsInvoice}
                </Button>
            ) : null}
        </View>
    );
}

type SheetStep = "ticket" | "discount" | "pay";

/** The ticket on a phone: lines, discounts and totals, then the payment sheet and the receipt. */
export function TicketSheet({
    sale,
    open,
    adder,
    onClose,
    onBookNext,
}: {
    sale: SaleTicket;
    open: boolean;
    // Shown under the client, where the register's tiles are out of reach.
    adder?: ReactNode;
    onClose: () => void;
    onBookNext: () => void;
}) {
    const [step, setStep] = useState<SheetStep>("ticket");
    const [selected, setSelected] = useState<string | null>(null);
    const { tokenProvider, locationId } = useTerminalConnection(api);
    useEffect(() => {
        if (sale.invoiced !== null) setStep("ticket");
    }, [sale.invoiced]);
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
                locationId={locationId}
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
                <SheetHeader
                    title={d.ticket}
                    subtitle={sale.number}
                    onClose={close}
                    closeLabel={strings.common.close}
                />
                <ClientPicker sale={sale} />
                {adder}
                {sale.held !== null ? <Notice tone="success">{sale.held}</Notice> : null}
                {sale.invoiced !== null ? <Notice tone="success">{sale.invoiced}</Notice> : null}
                {sale.views.map((v) => (
                    <View key={v.key}>
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
                {sale.isEmpty ? null : (
                    <DocTotals
                        currency={BUSINESS_CURRENCY}
                        lines={sale.totalLines}
                        density="compact"
                    />
                )}
                {sale.error !== null ? <Notice tone="danger">{sale.error}</Notice> : null}
                <Button
                    size="lg"
                    full
                    disabled={sale.isEmpty || !sale.ratesReady}
                    onPress={() => {
                        setStep("pay");
                    }}
                >
                    {d.charge(formatMoney(sale.totals.dueCents, BUSINESS_CURRENCY))}
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

/** Adds any sellable item to the ticket by name. */
function ItemAdder({ sale }: { sale: SaleTicket }) {
    const all = useCatalogItems();
    const items = useMemo(() => sellableItems(all), [all]);
    return (
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
    );
}

/** Checkout over the current screen: a visit's ticket (or a new sale), extra items, then payment. */
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
        platform: "mobile",
        role: viewer?.role ?? null,
    });
    useLinkedVisit(bookingId, useCheckoutQueue(), sale.addVisit);
    const visitId = sale.visitId;
    return (
        <TicketSheet
            sale={sale}
            open
            adder={<ItemAdder sale={sale} />}
            onClose={onClose}
            onBookNext={() => {
                replaceTask(
                    visitId === null ? { kind: "booking" } : { kind: "booking", rebookId: visitId },
                );
            }}
        />
    );
}

const styles = StyleSheet.create({
    stack: { gap: 12 },
    row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    grow: { flex: 1 },
    heading: {
        color: c.muted,
        fontFamily: theme.fonts.ui,
        fontSize: 11,
        fontWeight: "600",
        letterSpacing: 0.6,
        textTransform: "uppercase",
    },
    big: {
        color: c.ink,
        fontFamily: theme.fonts.ui,
        fontSize: 24,
        fontWeight: "700",
        fontVariant: ["tabular-nums"],
    },
    soft: { color: c.inkSoft, fontFamily: theme.fonts.ui, fontSize: 14 },
    note: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 12 },
    card: { gap: 12, marginTop: 6, marginBottom: 10, borderColor: c.accentLine },
    box: {
        gap: 10,
        padding: 14,
        borderRadius: theme.radius,
        borderWidth: theme.borderWidth,
        borderColor: c.border,
        backgroundColor: c.bg,
    },
});
