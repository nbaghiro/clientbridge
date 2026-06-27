import {
    type ClientRow,
    clientStatusIntent,
    filterClients,
    formatMoney,
    initials,
    useClientForm,
    useClients,
    useSearch,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { type ComponentProps, useState } from "react";
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
import { SafeAreaView } from "react-native-safe-area-context";

import { IconPlus, IconSearch } from "../components/icons";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";

export function ClientsScreen() {
    const clients = useClients();
    const { q, setQ, filtered } = useSearch(clients, filterClients);
    const [adding, setAdding] = useState(false);

    return (
        <SafeAreaView style={styles.screen} edges={["top"]}>
            <View style={styles.header}>
                <View>
                    <Text style={styles.title}>Clients</Text>
                    <Text style={styles.count}>{clients.length} total</Text>
                </View>
                <Pressable
                    style={styles.add}
                    onPress={() => {
                        setAdding(true);
                    }}
                >
                    <IconPlus size={16} color="#fff" />
                    <Text style={styles.addText}>Add</Text>
                </Pressable>
            </View>

            <View style={styles.searchWrap}>
                <IconSearch size={16} color={theme.colors.muted} />
                <TextInput
                    style={styles.search}
                    value={q}
                    onChangeText={setQ}
                    placeholder="Search clients…"
                    placeholderTextColor={theme.colors.muted}
                    autoCapitalize="none"
                />
            </View>

            <FlatList
                data={filtered}
                keyExtractor={(c) => c.id}
                contentContainerStyle={styles.list}
                renderItem={({ item }) => <ClientRowView c={item} />}
                ListEmptyComponent={
                    <Text style={styles.empty}>
                        {q ? "No clients match your search." : "No clients yet."}
                    </Text>
                }
            />

            <AddClientModal
                visible={adding}
                onClose={() => {
                    setAdding(false);
                }}
            />
        </SafeAreaView>
    );
}

function ClientRowView({ c }: { c: ClientRow }) {
    return (
        <View style={styles.row}>
            <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials(c.name)}</Text>
            </View>
            <View style={styles.rowMain}>
                <Text style={styles.rowName} numberOfLines={1}>
                    {c.name}
                </Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                    {c.email ?? c.phone ?? "—"}
                </Text>
            </View>
            <View style={styles.rowRight}>
                <Text style={styles.rowValue}>{formatMoney(c.lifetime_value_cents)}</Text>
                <StatusBadge status={c.status} intent={clientStatusIntent(c.status)} />
            </View>
        </View>
    );
}

function ModalField({ label, ...props }: { label: string } & ComponentProps<typeof TextInput>) {
    return (
        <View style={styles.field}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <TextInput
                style={styles.fieldInput}
                placeholderTextColor={theme.colors.muted}
                {...props}
            />
        </View>
    );
}

function AddClientModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
    const form = useClientForm(api, onClose);

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <View style={styles.modal}>
                    <Text style={styles.modalTitle}>Add client</Text>
                    <ModalField
                        label="Name"
                        value={form.name}
                        onChangeText={form.setName}
                        autoFocus
                    />
                    <ModalField
                        label="Email"
                        value={form.email}
                        onChangeText={form.setEmail}
                        keyboardType="email-address"
                        autoCapitalize="none"
                    />
                    <ModalField label="Phone" value={form.phone} onChangeText={form.setPhone} />
                    {form.error ? <Text style={styles.error}>{form.error}</Text> : null}
                    <View style={styles.modalActions}>
                        <Pressable style={styles.cancel} onPress={onClose}>
                            <Text style={styles.cancelText}>Cancel</Text>
                        </Pressable>
                        <Pressable
                            style={styles.save}
                            onPress={() => {
                                form.submit();
                            }}
                            disabled={form.busy}
                        >
                            {form.busy ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <Text style={styles.saveText}>Add client</Text>
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
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 12,
    },
    title: { color: theme.colors.ink, fontSize: 26, fontWeight: "700", letterSpacing: -0.4 },
    count: { color: theme.colors.muted, fontSize: 13, marginTop: 2 },
    add: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: theme.colors.accent,
        borderRadius: theme.radius,
        paddingHorizontal: 13,
        paddingVertical: 9,
    },
    addText: { color: "#fff", fontSize: 14, fontWeight: "700" },
    searchWrap: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginHorizontal: 20,
        marginBottom: 8,
        paddingHorizontal: 12,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: theme.radius,
        backgroundColor: theme.colors.surface,
    },
    search: { flex: 1, paddingVertical: 11, color: theme.colors.ink, fontSize: 15 },
    list: { paddingHorizontal: 20, paddingBottom: 24 },
    row: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 11,
        borderBottomColor: theme.colors.border,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    avatar: {
        width: 40,
        height: 40,
        borderRadius: theme.avatarRadius,
        backgroundColor: theme.colors.accentWeak,
        alignItems: "center",
        justifyContent: "center",
    },
    avatarText: { color: theme.colors.accent, fontWeight: "700", fontSize: 13 },
    rowMain: { flex: 1 },
    rowName: { color: theme.colors.ink, fontSize: 15, fontWeight: "600" },
    rowSub: { color: theme.colors.muted, fontSize: 13, marginTop: 1 },
    rowRight: { alignItems: "flex-end", gap: 4 },
    rowValue: { color: theme.colors.ink, fontSize: 14, fontWeight: "600" },
    empty: { color: theme.colors.muted, textAlign: "center", paddingVertical: 48, fontSize: 14 },
    backdrop: {
        flex: 1,
        backgroundColor: "rgba(20,25,30,0.4)",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
    },
    modal: {
        width: "100%",
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius,
        padding: 22,
    },
    modalTitle: { color: theme.colors.ink, fontSize: 18, fontWeight: "700", marginBottom: 14 },
    field: { marginBottom: 12 },
    fieldLabel: { color: theme.colors.inkSoft, fontSize: 13, fontWeight: "600", marginBottom: 5 },
    fieldInput: {
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: theme.radius,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: theme.colors.ink,
        fontSize: 15,
        backgroundColor: theme.colors.bg,
    },
    error: { color: theme.colors.danFg, fontSize: 13, marginBottom: 4 },
    modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 8 },
    cancel: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: theme.radius },
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
