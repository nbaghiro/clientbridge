import { strings, useTaxRates } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { Badge, Empty, Loading, Panel } from "@clientbridge/ui";
import { StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";

export function Taxes() {
    const rates = useTaxRates(api);

    return (
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>{strings.taxes.title}</Text>
            <Text style={styles.note}>{strings.taxes.subtitle}</Text>
            {rates === null ? (
                <Loading />
            ) : rates.length === 0 ? (
                <Empty message={strings.taxes.empty} />
            ) : (
                <Panel flush>
                    {rates.map((r, i) => (
                        <View key={r.id} style={[styles.row, i > 0 ? styles.rowBorder : null]}>
                            <View style={styles.rowMain}>
                                <Badge label={r.jurisdiction} />
                                <Text style={styles.name}>{r.name}</Text>
                            </View>
                            <Text style={styles.prov}>{r.province}</Text>
                        </View>
                    ))}
                </Panel>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    section: { marginTop: 28 },
    sectionTitle: { color: theme.colors.ink, fontSize: 17, fontWeight: "700", marginBottom: 8 },
    note: { color: theme.colors.muted, fontSize: 13, marginBottom: 14, lineHeight: 18 },
    row: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
    rowMain: { flexDirection: "row", alignItems: "center", gap: 10 },
    name: { color: theme.colors.ink, fontSize: 15, fontWeight: "500" },
    prov: { color: theme.colors.muted, fontSize: 14 },
});
