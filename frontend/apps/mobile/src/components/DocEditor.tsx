import { apiUrl as apiBaseUrl } from "../lib/config";
import {
    type DocDraft,
    type DocTerms,
    discountCents,
    discountLabel,
    formatMoney,
    sellableItems,
    strings,
    useCatalogItems,
    useClients,
    useDocComposer,
    useDocDraft,
    useLetterhead,
    formatParts,
    BUSINESS_CURRENCY,
    currencyAffix,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
    Button,
    Checkbox,
    Choice,
    confirm,
    DocTotals,
    Empty,
    IconButton,
    Modal,
    Notice,
    Panel,
    PrintedDocument,
    SearchSelect,
    Select,
    SheetHeader,
    TextField,
} from "@clientbridge/ui";

import { api } from "../lib/api";
import { DiscountForm } from "./SaleTicket";

const c = theme.colors;
const s = strings.billing;

interface DocFormProps {
    kind: "invoice" | "estimate";
    draft?: DocDraft | undefined;
    // A new document's client, when it is started from that client.
    clientId?: string | undefined;
    onClose: () => void;
}

/** A new invoice or estimate, or a saved one once its draft loads. */
export function DocEditor({
    kind,
    id,
    clientId,
    onClose,
}: {
    kind: "invoice" | "estimate";
    id: string | undefined;
    clientId: string | undefined;
    onClose: () => void;
}) {
    if (id === undefined) return <DocForm kind={kind} clientId={clientId} onClose={onClose} />;
    return <SavedDoc kind={kind} id={id} onClose={onClose} />;
}

function SavedDoc({
    kind,
    id,
    onClose,
}: {
    kind: "invoice" | "estimate";
    id: string;
    onClose: () => void;
}) {
    const draft = useDocDraft(kind, id);
    if (draft === null) return null;
    return <DocForm kind={kind} draft={draft} onClose={onClose} />;
}

function DocForm({ kind, draft, clientId, onClose }: DocFormProps) {
    const clients = useClients();
    const items = useCatalogItems();
    const catalog = useMemo(() => sellableItems(items), [items]);
    const letterhead = useLetterhead(apiBaseUrl);
    const [current, setCurrent] = useState(kind);
    const form = useDocComposer(api, current, draft);
    const picked = useRef(false);
    useEffect(() => {
        if (picked.current || clientId === undefined) return;
        picked.current = true;
        form.setClientId(clientId);
    }, [clientId, form]);
    const [preview, setPreview] = useState(false);
    const [discounting, setDiscounting] = useState<string | null>(null);
    const client = clients.find((x) => x.id === form.clientId) ?? null;

    const close = (): void => {
        if (!form.dirty || form.sent !== null) {
            onClose();
            return;
        }
        confirm({
            title: s.discardTitle,
            message: s.discardBody,
            confirmLabel: s.discard,
            cancelLabel: s.keepEditing,
            destructive: true,
        })
            .then((ok) => {
                if (ok) onClose();
            })
            .catch(() => undefined);
    };

    return (
        <Modal onClose={close} size="xl">
            <SheetHeader
                title={form.title}
                onClose={close}
                closeLabel={strings.common.close}
                actions={
                    <Button
                        variant="link"
                        onPress={() => {
                            setPreview((v) => !v);
                        }}
                    >
                        {preview ? s.edit : s.preview}
                    </Button>
                }
            />

            {draft === undefined && form.sent === null && !preview ? (
                <Choice
                    label={s.docKind}
                    layout="segmented"
                    options={[
                        { key: "invoice", label: s.doc.kinds.invoice },
                        { key: "estimate", label: s.doc.kinds.estimate },
                    ]}
                    value={current}
                    onChange={setCurrent}
                />
            ) : null}
            {form.sent !== null ? (
                <Empty
                    variant="card"
                    icon="check"
                    message={form.sent}
                    body={s.sentBody(client?.name ?? "")}
                    actions={
                        <>
                            <Button onPress={onClose}>{strings.common.done}</Button>
                            <Button variant="outline" onPress={form.startOver}>
                                {s.startAnother}
                            </Button>
                        </>
                    }
                />
            ) : preview ? (
                <ScrollView style={styles.body}>
                    <PrintedDocument doc={form.preview(client, letterhead, c.accent)} />
                </ScrollView>
            ) : (
                <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
                    {form.editing && client !== null ? (
                        <Panel style={styles.card}>
                            <Text style={styles.label}>{s.client}</Text>
                            <Text style={styles.strong}>{client.name}</Text>
                        </Panel>
                    ) : (
                        <Select
                            label={s.client}
                            value={form.clientId}
                            error={form.clientError}
                            options={[
                                { key: "", label: s.chooseClient },
                                ...clients.map((x) => ({
                                    key: x.id,
                                    label: x.name,
                                })),
                            ]}
                            onChange={form.setClientId}
                        />
                    )}

                    <View style={styles.section}>
                        <View style={styles.sectionHead}>
                            <Text style={styles.label}>{s.lines}</Text>
                            <Text style={styles.note}>{form.rateNote}</Text>
                        </View>
                        {form.lines.map((l) => (
                            <Panel key={l.key} style={styles.card}>
                                <View style={styles.lineHead}>
                                    <View style={styles.grow}>
                                        <TextField
                                            name={s.description}
                                            value={l.description}
                                            placeholder={s.descriptionPlaceholder}
                                            onChange={(v) => {
                                                form.setLine(l.key, {
                                                    description: v,
                                                    itemId: null,
                                                });
                                            }}
                                        />
                                    </View>
                                    <Text style={styles.amount}>
                                        {formatMoney(
                                            l.grossCents - discountCents(l.grossCents, l.discount),
                                            BUSINESS_CURRENCY,
                                        )}
                                    </Text>
                                    <IconButton
                                        icon="trash"
                                        label={s.removeLine}
                                        size="sm"
                                        onPress={() => {
                                            form.removeLine(l.key);
                                        }}
                                    />
                                </View>
                                <View style={styles.lineFields}>
                                    <View style={styles.qty}>
                                        <TextField
                                            label={s.qty}
                                            size="sm"
                                            type="number"
                                            value={l.quantity}
                                            onChange={(v) => {
                                                form.setLine(l.key, { quantity: v });
                                            }}
                                        />
                                    </View>
                                    <View style={styles.grow}>
                                        <TextField
                                            label={s.price}
                                            size="sm"
                                            type="number"
                                            {...currencyAffix(BUSINESS_CURRENCY)}
                                            value={l.unit}
                                            placeholder="0.00"
                                            onChange={(v) => {
                                                form.setLine(l.key, { unit: v });
                                            }}
                                        />
                                    </View>
                                </View>
                                <Select
                                    label={s.taxClass}
                                    size="sm"
                                    value={l.taxClass}
                                    options={form.taxClassOptions}
                                    onChange={(v) => {
                                        form.setLine(l.key, {
                                            taxClass:
                                                v === "federal_only" || v === "exempt"
                                                    ? v
                                                    : "standard",
                                        });
                                    }}
                                />
                                {kind === "estimate" ? (
                                    <Checkbox
                                        label={s.optional}
                                        value={l.optional}
                                        onChange={(v) => {
                                            form.setLine(l.key, { optional: v });
                                        }}
                                    />
                                ) : null}
                                {discounting === l.key ? (
                                    <DiscountForm
                                        title={s.lineDiscount(
                                            l.description || s.descriptionPlaceholder,
                                        )}
                                        initial={l.discount}
                                        baseCents={l.grossCents}
                                        onApply={(next) => {
                                            form.setLineDiscount(l.key, next);
                                            setDiscounting(null);
                                        }}
                                        onCancel={() => {
                                            setDiscounting(null);
                                        }}
                                    />
                                ) : (
                                    <Button
                                        variant="link"
                                        size="sm"
                                        icon="percent"
                                        disabled={l.grossCents <= 0}
                                        onPress={() => {
                                            setDiscounting(l.key);
                                        }}
                                    >
                                        {l.discount !== null
                                            ? s.discountedBy(discountLabel(l.discount))
                                            : s.addDiscount}
                                    </Button>
                                )}
                                {l.error !== null ? <Notice tone="danger">{l.error}</Notice> : null}
                            </Panel>
                        ))}
                        {catalog.length > 0 ? (
                            <SearchSelect
                                name={s.addFromCatalog}
                                value=""
                                placeholder={s.addFromCatalog}
                                options={[
                                    ...catalog.map((i) => ({
                                        key: i.id,
                                        label: formatParts([
                                            i.name,
                                            formatMoney(i.price_cents, BUSINESS_CURRENCY),
                                        ]),
                                    })),
                                ]}
                                onChange={(id) => {
                                    const item = catalog.find((i) => i.id === id);
                                    if (item !== undefined) form.addCatalogItem(item);
                                }}
                            />
                        ) : null}
                        <Button variant="outline" icon="plus" onPress={form.addLine}>
                            {s.addCustomLine}
                        </Button>
                        {form.linesError !== null ? (
                            <Notice tone="danger">{form.linesError}</Notice>
                        ) : null}
                    </View>

                    <Panel style={[styles.card, styles.section]}>
                        {discounting === "doc" ? (
                            <DiscountForm
                                title={s.discountTitle}
                                initial={form.docDiscount}
                                baseCents={form.discountBaseCents}
                                onApply={(next) => {
                                    form.setDocDiscount(next);
                                    setDiscounting(null);
                                }}
                                onCancel={() => {
                                    setDiscounting(null);
                                }}
                            />
                        ) : (
                            <Button
                                variant="outline"
                                size="sm"
                                icon="percent"
                                disabled={form.discountBaseCents <= 0}
                                onPress={() => {
                                    setDiscounting("doc");
                                }}
                            >
                                {form.docDiscount !== null
                                    ? s.discountedBy(discountLabel(form.docDiscount))
                                    : s.discountTitle}
                            </Button>
                        )}
                        <DocTotals currency={BUSINESS_CURRENCY} lines={form.totals} />
                    </Panel>

                    <View style={styles.section}>
                        <Text style={styles.label}>
                            {kind === "estimate" ? s.validFor : s.dueTerms}
                        </Text>
                        <Choice<DocTerms>
                            layout="segmented"
                            label={kind === "estimate" ? s.validFor : s.dueTerms}
                            options={form.termOptions}
                            value={form.terms}
                            onChange={form.setTerms}
                        />
                    </View>
                    <View style={styles.section}>
                        <TextField
                            label={s.messageToClient}
                            optional
                            multiline
                            rows={3}
                            value={form.message}
                            placeholder={s.messagePlaceholder}
                            onChange={form.setMessage}
                        />
                    </View>
                    {form.saved !== null ? <Notice tone="success">{form.saved}</Notice> : null}
                    {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
                </ScrollView>
            )}

            {form.sent === null ? (
                <View style={styles.footer}>
                    <View style={styles.grow}>
                        <Text style={styles.note}>{s.total}</Text>
                        <Text style={styles.total}>
                            {formatMoney(form.pricing.totalCents, BUSINESS_CURRENCY)}
                        </Text>
                    </View>
                    <Button
                        style={{ alignSelf: "center" }}
                        variant="outline"
                        busy={form.busy}
                        disabled={form.sending}
                        onPress={form.saveDraft}
                    >
                        {form.busy ? s.saving : s.saveDraft}
                    </Button>
                    <Button
                        style={{ alignSelf: "center" }}
                        icon="send"
                        busy={form.sending}
                        disabled={form.busy}
                        onPress={form.send}
                    >
                        {form.sending ? s.sending : s.send}
                    </Button>
                </View>
            ) : null}
        </Modal>
    );
}

const styles = StyleSheet.create({
    body: { flexGrow: 0, maxHeight: 560 },
    section: { marginTop: 16, gap: 10 },
    sectionHead: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
    label: { fontFamily: theme.fonts.ui, fontSize: 14, fontWeight: "600", color: c.ink },
    note: { fontFamily: theme.fonts.ui, fontSize: 12, color: c.muted, flexShrink: 1 },
    strong: {
        fontFamily: theme.fonts.ui,
        fontSize: 15,
        fontWeight: "600",
        color: c.ink,
        marginTop: 2,
    },
    card: { gap: 10 },
    lineHead: { flexDirection: "row", alignItems: "center", gap: 8 },
    lineFields: { flexDirection: "row", gap: 10 },
    qty: { width: 80 },
    grow: { flex: 1 },
    amount: {
        fontFamily: theme.fonts.ui,
        fontSize: 15,
        fontWeight: "700",
        color: c.ink,
        fontVariant: ["tabular-nums"],
    },
    total: { fontFamily: theme.fonts.ui, fontSize: 20, fontWeight: "700", color: c.ink },
    footer: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingTop: 12,
        marginTop: 8,
        borderTopWidth: theme.borderWidth,
        borderTopColor: c.border,
    },
});
