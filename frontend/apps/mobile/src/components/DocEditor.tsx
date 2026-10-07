import {
    type DocDraft,
    type DocTerms,
    formatMoney,
    sellableItems,
    strings,
    useCatalogItems,
    useClients,
    useDocComposer,
    useLetterhead,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
    Button,
    Checkbox,
    Choice,
    DocTotals,
    Empty,
    IconButton,
    Modal,
    Notice,
    PrintedDocument,
    Select,
    TextField,
    confirm,
} from "@clientbridge/ui";

import { api } from "../lib/api";

const c = theme.colors;
const s = strings.billing;

export interface DocEditorProps {
    kind: "invoice" | "estimate";
    draft?: DocDraft | undefined;
    onClose: () => void;
}

export function DocEditor({ kind, draft, onClose }: DocEditorProps) {
    const clients = useClients();
    const items = useCatalogItems();
    const catalog = useMemo(() => sellableItems(items), [items]);
    const letterhead = useLetterhead();
    const form = useDocComposer(api, kind, draft);
    const [preview, setPreview] = useState(false);
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
            <View style={styles.head}>
                <IconButton icon="x" label={strings.common.close} onPress={close} />
                <Text style={styles.title}>{form.title}</Text>
                <Button
                    variant="link"
                    onPress={() => {
                        setPreview((v) => !v);
                    }}
                >
                    {preview ? s.edit : s.preview}
                </Button>
            </View>

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
                        <View style={styles.card}>
                            <Text style={styles.label}>{s.client}</Text>
                            <Text style={styles.strong}>{client.name}</Text>
                        </View>
                    ) : (
                        <Select
                            label={s.client}
                            value={form.clientId}
                            error={form.clientError}
                            options={[
                                { key: "", label: s.chooseClient },
                                ...clients.map((x) => ({ key: x.id, label: x.name })),
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
                            <View key={l.key} style={styles.card}>
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
                                    <Text style={styles.amount}>{formatMoney(l.amountCents)}</Text>
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
                                            prefix="$"
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
                                {l.error !== null ? <Notice tone="danger">{l.error}</Notice> : null}
                            </View>
                        ))}
                        {catalog.length > 0 ? (
                            <Select
                                name={s.addFromCatalog}
                                value=""
                                options={[
                                    { key: "", label: s.addFromCatalog },
                                    ...catalog.map((i) => ({
                                        key: i.id,
                                        label: `${i.name} · ${formatMoney(i.price_cents)}`,
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

                    <View style={[styles.card, styles.section]}>
                        <DocTotals lines={form.totals} />
                    </View>

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
                        <Text style={styles.total}>{formatMoney(form.pricing.totalCents)}</Text>
                    </View>
                    <Button
                        variant="outline"
                        busy={form.busy}
                        disabled={form.sending}
                        onPress={form.saveDraft}
                    >
                        {form.busy ? s.saving : s.saveDraft}
                    </Button>
                    <Button
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
    head: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
    title: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "700", color: c.ink },
    body: { flexGrow: 0, maxHeight: 560 },
    section: { marginTop: 16, gap: 10 },
    sectionHead: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
    label: { fontSize: 14, fontWeight: "600", color: c.ink },
    note: { fontSize: 12, color: c.muted, flexShrink: 1 },
    strong: { fontSize: 15, fontWeight: "600", color: c.ink, marginTop: 2 },
    card: {
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: 10,
        backgroundColor: c.surface,
        padding: 12,
        gap: 10,
    },
    lineHead: { flexDirection: "row", alignItems: "center", gap: 8 },
    lineFields: { flexDirection: "row", gap: 10 },
    qty: { width: 80 },
    grow: { flex: 1 },
    amount: { fontSize: 15, fontWeight: "700", color: c.ink, fontVariant: ["tabular-nums"] },
    total: { fontSize: 20, fontWeight: "700", color: c.ink },
    footer: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingTop: 12,
        marginTop: 8,
        borderTopWidth: 1,
        borderTopColor: c.border,
    },
});
