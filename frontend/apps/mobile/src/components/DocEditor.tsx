import {
    type DocDraft,
    docEditorTitle,
    formatMoney,
    mediaUrl,
    sellableItems,
    strings,
    useCatalogItems,
    useClients,
    useDocForm,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button, Choice, ItemImage, Modal, Notice, TextField } from "@clientbridge/ui";

import { api, apiBaseUrl } from "../lib/api";

const c = theme.colors;

export interface DocEditorProps {
    kind: "invoice" | "estimate";
    draft?: DocDraft | undefined;
    onClose: () => void;
}

export function DocEditor({ kind, draft, onClose }: DocEditorProps) {
    const clients = useClients();
    const items = useCatalogItems();
    const catalog = useMemo(() => sellableItems(items), [items]);
    const form = useDocForm(api, kind, onClose, draft);
    const [picking, setPicking] = useState(false);
    const shownClients = form.editing ? clients.filter((cl) => cl.id === form.clientId) : clients;

    return (
        <Modal onClose={onClose}>
            <Text style={styles.sheetTitle}>{docEditorTitle(kind, form.editing)}</Text>
            <ScrollView style={styles.sheetBody} keyboardShouldPersistTaps="handled">
                <Text style={styles.sectionLabel}>{strings.billing.clientLabel}</Text>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.chipRow}
                >
                    <Choice
                        label={strings.billing.clientLabel}
                        options={shownClients.map((cl) => ({
                            key: cl.id,
                            label: cl.name,
                            disabled: form.editing,
                        }))}
                        value={form.clientId}
                        onChange={form.setClientId}
                    />
                </ScrollView>

                <Text style={[styles.sectionLabel, styles.sectionSpace]}>
                    {strings.billing.linesLabel}
                </Text>
                {form.lines.map((l) => (
                    <View key={l.key} style={styles.lineEdit}>
                        <TextInput
                            style={[styles.lineInput, styles.lineDescInput]}
                            value={l.description}
                            onChangeText={(v) => {
                                form.setLine(l.key, { description: v, itemId: null });
                            }}
                            placeholder={strings.billing.lineDescriptionPlaceholder}
                            placeholderTextColor={c.muted}
                        />
                        <TextInput
                            style={[styles.lineInput, styles.lineQtyInput]}
                            value={l.quantity}
                            onChangeText={(v) => {
                                form.setLine(l.key, { quantity: v });
                            }}
                            keyboardType="decimal-pad"
                            placeholder={strings.billing.lineQty}
                            placeholderTextColor={c.muted}
                        />
                        <TextInput
                            style={[styles.lineInput, styles.linePriceInput]}
                            value={l.unit}
                            onChangeText={(v) => {
                                form.setLine(l.key, { unit: v });
                            }}
                            keyboardType="decimal-pad"
                            placeholder={strings.billing.linePricePlaceholder}
                            placeholderTextColor={c.muted}
                        />
                        <Pressable
                            onPress={() => {
                                form.removeLine(l.key);
                            }}
                            style={styles.lineRemove}
                            hitSlop={8}
                        >
                            <Text style={styles.lineRemoveText}>×</Text>
                        </Pressable>
                    </View>
                ))}
                <View style={styles.lineLinks}>
                    <Button
                        variant="link"
                        onPress={() => {
                            form.addLine();
                        }}
                    >
                        {strings.billing.addLine}
                    </Button>
                    {catalog.length > 0 ? (
                        <Button
                            variant="link"
                            onPress={() => {
                                setPicking((p) => !p);
                            }}
                        >
                            {strings.billing.fromCatalog}
                        </Button>
                    ) : null}
                </View>
                {picking ? (
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.chipRow}
                    >
                        {catalog.map((item) => (
                            <Pressable
                                key={item.id}
                                style={styles.pick}
                                onPress={() => {
                                    form.addCatalogItem(item);
                                    setPicking(false);
                                }}
                            >
                                <ItemImage
                                    src={mediaUrl(apiBaseUrl, item.image_file_id)}
                                    name={item.name}
                                    color={item.color}
                                    size={40}
                                />
                                <Text style={styles.pickName} numberOfLines={2}>
                                    {item.name}
                                </Text>
                                <Text style={styles.pickPrice}>
                                    {formatMoney(item.price_cents)}
                                </Text>
                            </Pressable>
                        ))}
                    </ScrollView>
                ) : null}

                <TextField
                    label={strings.billing.notesLabel}
                    multiline
                    rows={2}
                    value={form.notes}
                    onChange={form.setNotes}
                    placeholder={strings.billing.notesPlaceholder}
                />
            </ScrollView>
            {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
            <View style={styles.foot}>
                <Text style={styles.subtotal}>
                    {strings.billing.subtotal}{" "}
                    <Text style={styles.subtotalValue}>{formatMoney(form.subtotalCents)}</Text>
                    <Text style={styles.subtotalTax}>{strings.billing.plusTax}</Text>
                </Text>
                <View style={styles.actions}>
                    <Button variant="quiet" onPress={onClose}>
                        {strings.common.cancel}
                    </Button>
                    <Button busy={form.busy} onPress={form.submit}>
                        {form.editing ? strings.billing.saveChanges : strings.billing.saveDraft}
                    </Button>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    sheetTitle: { color: c.ink, fontSize: 18, fontWeight: "700" },
    sheetBody: { maxHeight: "70%" },
    sectionLabel: {
        color: c.muted,
        fontSize: 11,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
    sectionSpace: { marginTop: 16 },
    chipRow: { paddingVertical: 8 },
    lineEdit: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
    lineInput: {
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: theme.radius,
        paddingHorizontal: 10,
        paddingVertical: 9,
        color: c.ink,
        fontSize: 14,
        backgroundColor: c.bg,
    },
    lineDescInput: { flex: 1 },
    lineQtyInput: { width: 52, textAlign: "center" },
    linePriceInput: { width: 76, textAlign: "right" },
    lineRemove: { width: 20, alignItems: "center" },
    lineRemoveText: { color: c.muted, fontSize: 18 },
    lineLinks: { flexDirection: "row", gap: 18, marginTop: 6 },
    pick: {
        width: 96,
        padding: 8,
        borderRadius: theme.radius,
        borderColor: c.border,
        borderWidth: 1,
        backgroundColor: c.bg,
    },
    pickName: { color: c.ink, fontSize: 12, fontWeight: "600", marginTop: 6 },
    pickPrice: { color: c.muted, fontSize: 12, marginTop: 2, fontVariant: ["tabular-nums"] },

    foot: { marginTop: 12 },
    subtotal: { color: c.muted, fontSize: 13 },
    subtotalValue: { color: c.ink, fontWeight: "700" },
    subtotalTax: { fontSize: 11 },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 8 },
});
