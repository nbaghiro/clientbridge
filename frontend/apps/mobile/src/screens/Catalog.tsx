import {
    ITEM_KINDS,
    KIND_LABEL,
    filterItems,
    formatMoney,
    useCatalogItems,
    useItemForm,
    useSearch,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";

import { IconPlus, IconSearch } from "../components/icons";
import { api } from "../lib/api";

export function CatalogScreen() {
    const items = useCatalogItems();
    const { q, setQ, filtered } = useSearch(items, filterItems);
    const [adding, setAdding] = useState(false);

    return (
        <View style={styles.screen}>
            <View style={styles.toolbar}>
                <View style={styles.searchWrap}>
                    <IconSearch size={16} color={theme.colors.muted} />
                    <TextInput
                        style={styles.search}
                        value={q}
                        onChangeText={setQ}
                        placeholder="Search catalog…"
                        placeholderTextColor={theme.colors.muted}
                        autoCapitalize="none"
                    />
                </View>
                <Pressable
                    style={styles.add}
                    onPress={() => {
                        setAdding(true);
                    }}
                >
                    <IconPlus size={18} color="#fff" />
                </Pressable>
            </View>

            <FlatList
                data={filtered}
                keyExtractor={(i) => i.id}
                contentContainerStyle={styles.list}
                renderItem={({ item }) => (
                    <View style={[styles.row, item.active ? null : styles.dim]}>
                        <View style={styles.rowMain}>
                            <Text style={styles.rowName} numberOfLines={1}>
                                {item.name}
                            </Text>
                            <Text style={styles.rowSub}>
                                {KIND_LABEL[item.kind] ?? item.kind}
                                {item.duration_min ? ` · ${String(item.duration_min)} min` : ""}
                            </Text>
                        </View>
                        <Text style={styles.rowPrice}>{formatMoney(item.price_cents)}</Text>
                    </View>
                )}
                ListEmptyComponent={
                    <Text style={styles.empty}>
                        {q ? "No items match your search." : "No catalog items yet."}
                    </Text>
                }
            />

            <AddItemModal
                visible={adding}
                onClose={() => {
                    setAdding(false);
                }}
            />
        </View>
    );
}

function AddItemModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
    const form = useItemForm(api, onClose);

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <View style={styles.modal}>
                    <Text style={styles.modalTitle}>Add item</Text>
                    <View style={styles.kindRow}>
                        {ITEM_KINDS.map((k) => (
                            <Pressable
                                key={k}
                                style={[
                                    styles.kindChip,
                                    form.kind === k ? styles.kindChipOn : null,
                                ]}
                                onPress={() => {
                                    form.setKind(k);
                                }}
                            >
                                <Text
                                    style={[
                                        styles.kindText,
                                        form.kind === k ? styles.kindTextOn : null,
                                    ]}
                                >
                                    {KIND_LABEL[k]}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                    <TextInput
                        style={styles.input}
                        value={form.name}
                        onChangeText={form.setName}
                        placeholder="Name"
                        placeholderTextColor={theme.colors.muted}
                        autoFocus
                    />
                    <View style={styles.twoCol}>
                        <TextInput
                            style={[styles.input, styles.col]}
                            value={form.price}
                            onChangeText={form.setPrice}
                            placeholder="Price ($)"
                            placeholderTextColor={theme.colors.muted}
                            keyboardType="decimal-pad"
                        />
                        <TextInput
                            style={[styles.input, styles.col]}
                            value={form.duration}
                            onChangeText={form.setDuration}
                            placeholder="Duration (min)"
                            placeholderTextColor={theme.colors.muted}
                            keyboardType="number-pad"
                        />
                    </View>
                    {form.error ? <Text style={styles.error}>{form.error}</Text> : null}
                    <View style={styles.actions}>
                        <Pressable style={styles.cancel} onPress={onClose}>
                            <Text style={styles.cancelText}>Cancel</Text>
                        </Pressable>
                        <Pressable style={styles.save} onPress={form.submit} disabled={form.busy}>
                            {form.busy ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <Text style={styles.saveText}>Add item</Text>
                            )}
                        </Pressable>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    toolbar: { flexDirection: "row", alignItems: "center", gap: 10, padding: 16 },
    searchWrap: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 12,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: theme.radius,
        backgroundColor: theme.colors.surface,
    },
    search: { flex: 1, paddingVertical: 10, color: theme.colors.ink, fontSize: 15 },
    add: {
        width: 42,
        height: 42,
        borderRadius: theme.radius,
        backgroundColor: theme.colors.accent,
        alignItems: "center",
        justifyContent: "center",
    },
    list: { paddingHorizontal: 16, paddingBottom: 24 },
    row: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 12,
        borderBottomColor: theme.colors.border,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    dim: { opacity: 0.5 },
    rowMain: { flex: 1 },
    rowName: { color: theme.colors.ink, fontSize: 15, fontWeight: "600" },
    rowSub: { color: theme.colors.muted, fontSize: 13, marginTop: 1 },
    rowPrice: { color: theme.colors.ink, fontSize: 14, fontWeight: "600" },
    empty: { color: theme.colors.muted, textAlign: "center", paddingVertical: 48, fontSize: 14 },
    backdrop: {
        flex: 1,
        backgroundColor: theme.colors.scrim,
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
    },
    modal: {
        width: "100%",
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius,
        padding: 22,
        gap: 12,
    },
    modalTitle: { color: theme.colors.ink, fontSize: 18, fontWeight: "700" },
    kindRow: { flexDirection: "row", gap: 8 },
    kindChip: {
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 999,
        paddingHorizontal: 13,
        paddingVertical: 6,
    },
    kindChipOn: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
    kindText: { color: theme.colors.inkSoft, fontSize: 13, fontWeight: "600" },
    kindTextOn: { color: "#fff" },
    input: {
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: theme.radius,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: theme.colors.ink,
        fontSize: 15,
        backgroundColor: theme.colors.bg,
    },
    twoCol: { flexDirection: "row", gap: 10 },
    col: { flex: 1 },
    error: { color: theme.colors.danFg, fontSize: 13 },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 },
    cancel: { paddingHorizontal: 14, paddingVertical: 10 },
    cancelText: { color: theme.colors.inkSoft, fontSize: 14, fontWeight: "600" },
    save: {
        backgroundColor: theme.colors.accent,
        borderRadius: theme.radius,
        paddingHorizontal: 16,
        paddingVertical: 10,
        minWidth: 96,
        alignItems: "center",
    },
    saveText: { color: "#fff", fontSize: 14, fontWeight: "700" },
});
