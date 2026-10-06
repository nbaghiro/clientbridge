import type { ActivityTimelineProps } from "@clientbridge/app-core";
import { INTENT_COLORS } from "@clientbridge/tokens";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, Text, View } from "react-native";

import { Icon } from "./Icon";
import type { NativeProps } from "./props";

const c = theme.colors;

export function ActivityTimeline({ entries, style }: NativeProps<ActivityTimelineProps>) {
    return (
        <View style={style}>
            {entries.map((e, i) => {
                const tone = INTENT_COLORS[e.intent ?? "neutral"];
                const big = e.icon !== undefined;
                return (
                    <View key={e.key} style={styles.item}>
                        <View style={[styles.rail, big && styles.railBig]}>
                            {big ? (
                                <View style={[styles.disc, { backgroundColor: c[tone.soft] }]}>
                                    {e.icon !== undefined ? (
                                        <Icon name={e.icon} size={14} color={c[tone.ink]} />
                                    ) : null}
                                </View>
                            ) : (
                                <View style={[styles.dot, { backgroundColor: c[tone.line] }]} />
                            )}
                            {i < entries.length - 1 ? <View style={styles.line} /> : null}
                        </View>
                        <View
                            style={[
                                styles.body,
                                big && styles.bodyBig,
                                i === entries.length - 1 && styles.last,
                            ]}
                        >
                            <View style={styles.head}>
                                <Text style={styles.label}>{e.label}</Text>
                                {e.aside !== undefined ? (
                                    <Text style={styles.aside}>{e.aside}</Text>
                                ) : (
                                    <Text style={styles.at}>{e.at}</Text>
                                )}
                            </View>
                            {e.detail !== undefined || e.aside !== undefined ? (
                                <Text style={styles.detail}>
                                    {[e.detail, e.aside !== undefined ? e.at : undefined]
                                        .filter(Boolean)
                                        .join(" · ")}
                                </Text>
                            ) : null}
                            {e.quote !== undefined ? (
                                <Text style={styles.quote}>{e.quote}</Text>
                            ) : null}
                        </View>
                    </View>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    item: { flexDirection: "row", gap: 12 },
    rail: { width: 11, alignItems: "center" },
    railBig: { width: 28 },
    dot: { width: 11, height: 11, borderRadius: 6, marginTop: 4 },
    disc: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
    },
    line: { flex: 1, width: 1, backgroundColor: c.border, marginTop: 2 },
    body: { flex: 1, paddingBottom: 14 },
    bodyBig: { paddingTop: 4, paddingBottom: 18 },
    last: { paddingBottom: 0 },
    head: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 12,
    },
    label: { color: c.ink, fontSize: 14, fontWeight: "600", flexShrink: 1 },
    at: { color: c.muted, fontSize: 12 },
    aside: { color: c.ink, fontSize: 14, fontWeight: "600" },
    detail: { color: c.muted, fontSize: 13, marginTop: 2 },
    quote: {
        color: c.inkSoft,
        fontSize: 14,
        lineHeight: 20,
        backgroundColor: c.bg,
        borderRadius: theme.radius,
        padding: 10,
        marginTop: 8,
    },
});
