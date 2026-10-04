import {
    ITEM_KINDS,
    KIND_LABEL,
    filterItems,
    mediaUrl,
    strings,
    useCatalogItems,
    useItemForm,
    useSearch,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { useState } from "react";
import {
    ActivityIndicator,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";

import { api, apiBaseUrl } from "../lib/api";
import { ItemImage } from "../ui/ItemImage";
import { ListPage } from "../ui/ListPage";
import { Money } from "../ui/Money";

export function CatalogScreen() {
    const items = useCatalogItems();
    const { q, setQ, filtered } = useSearch(items, filterItems);
    const [adding, setAdding] = useState(false);

    return (
        <View style={styles.screen}>
            <ListPage
                summary={strings.catalog.itemCount(items.length)}
                action={{
                    label: strings.catalog.addItem,
                    onPress: () => {
                        setAdding(true);
                    },
                }}
                search={{
                    value: q,
                    onChange: setQ,
                    placeholder: strings.catalog.searchPlaceholder,
                }}
                rows={filtered}
                rowKey={(i) => i.id}
                empty={q ? strings.catalog.noMatch : strings.catalog.empty}
                renderRow={(item) => (
                    <View style={[styles.row, item.active ? null : styles.dim]}>
                        <ItemImage
                            src={mediaUrl(apiBaseUrl, item.image_file_id)}
                            name={item.name}
                            color={item.color}
                        />
                        <View style={styles.rowMain}>
                            <Text style={styles.rowName} numberOfLines={1}>
                                {item.name}
                            </Text>
                            <Text style={styles.rowSub}>
                                {KIND_LABEL[item.kind] ?? item.kind}
                                {item.duration_min
                                    ? strings.catalog.durationSep(item.duration_min)
                                    : ""}
                            </Text>
                        </View>
                        <Money cents={item.price_cents} strong />
                    </View>
                )}
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
                    <Text style={styles.modalTitle}>{strings.catalog.addItem}</Text>
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
                        placeholder={strings.catalog.name}
                        placeholderTextColor={theme.colors.muted}
                        autoFocus
                    />
                    <View style={styles.twoCol}>
                        <TextInput
                            style={[styles.input, styles.col]}
                            value={form.price}
                            onChangeText={form.setPrice}
                            placeholder={strings.catalog.priceLabel}
                            placeholderTextColor={theme.colors.muted}
                            keyboardType="decimal-pad"
                        />
                        <TextInput
                            style={[styles.input, styles.col]}
                            value={form.duration}
                            onChangeText={form.setDuration}
                            placeholder={strings.catalog.durationLabel}
                            placeholderTextColor={theme.colors.muted}
                            keyboardType="number-pad"
                        />
                    </View>
                    {form.error ? <Text style={styles.error}>{form.error}</Text> : null}
                    <View style={styles.actions}>
                        <Pressable style={styles.cancel} onPress={onClose}>
                            <Text style={styles.cancelText}>{strings.common.cancel}</Text>
                        </Pressable>
                        <Pressable style={styles.save} onPress={form.submit} disabled={form.busy}>
                            {form.busy ? (
                                <ActivityIndicator color={theme.colors.accentInk} />
                            ) : (
                                <Text style={styles.saveText}>{strings.catalog.addItem}</Text>
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
    row: { flexDirection: "row", alignItems: "center", gap: 12 },
    dim: { opacity: 0.5 },
    rowMain: { flex: 1 },
    rowName: { color: theme.colors.ink, fontSize: 15, fontWeight: "600" },
    rowSub: { color: theme.colors.muted, fontSize: 13, marginTop: 1 },
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
    kindRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    kindChip: {
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 999,
        paddingHorizontal: 13,
        paddingVertical: 6,
    },
    kindChipOn: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
    kindText: { color: theme.colors.inkSoft, fontSize: 13, fontWeight: "600" },
    kindTextOn: { color: theme.colors.accentInk },
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
    saveText: { color: theme.colors.accentInk, fontSize: 14, fontWeight: "700" },
});
