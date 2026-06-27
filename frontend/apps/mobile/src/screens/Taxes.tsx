import { theme } from "@clientbridge/tokens/theme";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";

interface TaxRate {
    id: string;
    jurisdiction: string;
    province: string;
    rate_bps: number;
    name: string;
}

export function TaxesScreen() {
    const [rates, setRates] = useState<TaxRate[] | null>(null);

    useEffect(() => {
        void api
            .get<TaxRate[]>("/v1/tax-rates")
            .then(setRates)
            .catch(() => {
                setRates([]);
            });
    }, []);

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Text style={styles.note}>
                Sales tax applied to your invoices, based on your province.
            </Text>
            {rates === null ? (
                <ActivityIndicator style={styles.loading} color={theme.colors.muted} />
            ) : rates.length === 0 ? (
                <Text style={styles.empty}>No tax rates set for your province yet.</Text>
            ) : (
                <View style={styles.group}>
                    {rates.map((r, i) => (
                        <View key={r.id} style={[styles.row, i > 0 ? styles.rowBorder : null]}>
                            <View style={styles.rowMain}>
                                <View style={styles.badge}>
                                    <Text style={styles.badgeText}>{r.jurisdiction}</Text>
                                </View>
                                <Text style={styles.name}>{r.name}</Text>
                            </View>
                            <Text style={styles.prov}>{r.province}</Text>
                        </View>
                    ))}
                </View>
            )}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    content: { padding: 16 },
    note: { color: theme.colors.muted, fontSize: 13, marginBottom: 14, lineHeight: 18 },
    loading: { marginTop: 24 },
    empty: { color: theme.colors.muted, fontSize: 14, textAlign: "center", marginTop: 24 },
    group: {
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: theme.colors.border,
        overflow: "hidden",
    },
    row: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
    rowMain: { flexDirection: "row", alignItems: "center", gap: 10 },
    badge: {
        backgroundColor: theme.colors.accentWeak,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 2,
    },
    badgeText: { color: theme.colors.accent, fontSize: 11, fontWeight: "700" },
    name: { color: theme.colors.ink, fontSize: 15, fontWeight: "500" },
    prov: { color: theme.colors.muted, fontSize: 14 },
});
