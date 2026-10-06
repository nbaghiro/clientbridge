import type { CalendarEventCardProps, CalendarEventFlag, IconName } from "@clientbridge/app-core";
import { INTENT_COLORS, SHADOW } from "@clientbridge/tokens";
import { theme } from "@clientbridge/tokens/native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "./Icon";

const c = theme.colors;

const FLAG_ICON: Record<CalendarEventFlag, IconName> = {
    online: "globe",
    recurring: "repeat",
    deposit_due: "dollar",
    addons: "bag",
    note: "note",
    walk_in: "user",
    class: "users",
};

/** A visit block: status fill and edge, the service swatch, flags; fills whatever box the grid gives it. */
export function CalendarEventCard({
    headline,
    detail,
    time,
    intent,
    color,
    density = "full",
    flags = [],
    state = "idle",
    label,
    onPress,
}: CalendarEventCardProps) {
    const tone = INTENT_COLORS[intent];
    const fg = c[tone.ink];
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={onPress}
            style={[
                styles.card,
                { backgroundColor: c[tone.soft], borderLeftColor: c[tone.line] },
                intent === "warning" && styles.pending,
                density === "compact" && styles.compact,
                state === "selected" && styles.selected,
                state === "dragging" && styles.dragging,
                state === "refused" && styles.refused,
                state === "faded" && styles.faded,
            ]}
        >
            {density === "compact" ? (
                <Text style={[styles.line, { color: fg }]} numberOfLines={1}>
                    {time !== "" ? <Text style={styles.strong}>{time} </Text> : null}
                    {headline}
                </Text>
            ) : (
                <>
                    <View style={styles.row}>
                        <Text style={[styles.head, { color: fg }]} numberOfLines={1}>
                            {headline}
                        </Text>
                        {flags.map((f) => (
                            <Icon key={f} name={FLAG_ICON[f]} size={11} color={fg} />
                        ))}
                    </View>
                    {density === "regular" ? (
                        <View style={styles.row}>
                            {color ? (
                                <View style={[styles.swatch, { backgroundColor: color }]} />
                            ) : null}
                            <Text style={[styles.line, { color: fg }]} numberOfLines={1}>
                                {[time, detail].filter(Boolean).join(" · ")}
                            </Text>
                        </View>
                    ) : (
                        <>
                            {detail !== undefined ? (
                                <View style={styles.row}>
                                    {color ? (
                                        <View style={[styles.swatch, { backgroundColor: color }]} />
                                    ) : null}
                                    <Text style={[styles.line, { color: fg }]} numberOfLines={1}>
                                        {detail}
                                    </Text>
                                </View>
                            ) : null}
                            <Text style={[styles.time, { color: fg }]} numberOfLines={1}>
                                {time}
                            </Text>
                        </>
                    )}
                </>
            )}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: {
        flex: 1,
        borderLeftWidth: 3,
        borderRadius: 6,
        paddingHorizontal: 6,
        paddingVertical: 4,
        overflow: "hidden",
    },
    compact: { justifyContent: "center", paddingVertical: 1 },
    pending: { borderWidth: 1, borderStyle: "dashed", borderColor: c.warnFg, borderLeftWidth: 3 },
    selected: { borderWidth: 2, borderColor: c.accent, borderLeftWidth: 3 },
    dragging: {
        shadowColor: SHADOW,
        shadowOpacity: 0.2,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
        borderWidth: 2,
        borderColor: c.accent,
    },
    refused: { borderWidth: 2, borderColor: c.danFg },
    faded: { opacity: 0.55 },
    row: { flexDirection: "row", alignItems: "center", gap: 3, minWidth: 0 },
    head: { flex: 1, fontSize: 12, fontWeight: "700" },
    line: { flexShrink: 1, fontSize: 11 },
    strong: { fontWeight: "700" },
    swatch: { width: 6, height: 6, borderRadius: 3 },
    time: { fontSize: 11, opacity: 0.8, marginTop: 1, fontVariant: ["tabular-nums"] },
});
