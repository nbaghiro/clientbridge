import type { MeterProps } from "@clientbridge/app-core";
import { INTENT_COLORS } from "@clientbridge/tokens";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, Text, View } from "react-native";

const c = theme.colors;

export function Meter({
    value,
    max,
    label,
    detail,
    intent = "accent",
    units = false,
    overflow = 0,
    marker = null,
    labelPosition = "above",
    size = "md",
}: MeterProps) {
    const scale = Math.max(1, max);
    const share = Math.max(0, Math.min(1, value / scale));
    const tone = INTENT_COLORS[intent];
    const fill = c[tone.line];
    const h = size === "sm" ? 6 : 8;
    const bar = (
        <View
            accessibilityRole="progressbar"
            accessibilityLabel={label}
            accessibilityValue={{ min: 0, max: scale, now: value }}
            style={labelPosition === "beside" ? styles.grow : undefined}
        >
            {units ? (
                <View style={styles.units}>
                    {Array.from({ length: scale }, (_, i) => (
                        <View
                            key={i}
                            style={[
                                styles.unit,
                                { height: h },
                                i < Math.round(share * scale) && { backgroundColor: fill },
                            ]}
                        />
                    ))}
                    {overflow > 0
                        ? Array.from({ length: Math.min(overflow, 4) }, (_, i) => (
                              <View
                                  key={`o${String(i)}`}
                                  style={[styles.extra, { height: h, borderColor: fill }]}
                              />
                          ))
                        : null}
                </View>
            ) : (
                <View style={[styles.track, { height: h, borderRadius: h / 2 }]}>
                    <View
                        style={[
                            styles.fill,
                            {
                                width: `${String(value > 0 ? Math.max(4, share * 100) : 0)}%` as `${number}%`,
                                backgroundColor: fill,
                            },
                        ]}
                    />
                    {marker !== null ? (
                        <View
                            style={[
                                styles.marker,
                                {
                                    left: `${String(Math.min(100, (marker / scale) * 100))}%` as `${number}%`,
                                },
                            ]}
                        />
                    ) : null}
                </View>
            )}
        </View>
    );
    if (labelPosition === "hidden") return bar;
    if (labelPosition === "beside") {
        return (
            <View style={styles.beside}>
                {bar}
                <Text style={[styles.besideLabel, { color: c[tone.ink] }]}>{label}</Text>
            </View>
        );
    }
    if (labelPosition === "below") {
        return (
            <View>
                {bar}
                <Text style={styles.below}>{label}</Text>
            </View>
        );
    }
    return (
        <View>
            <View style={styles.head}>
                <Text style={styles.label}>{label}</Text>
                {detail !== undefined ? <Text style={styles.detail}>{detail}</Text> : null}
            </View>
            {bar}
        </View>
    );
}

const styles = StyleSheet.create({
    grow: { flex: 1 },
    units: { flexDirection: "row", alignItems: "center", gap: 3 },
    unit: { flex: 1, borderRadius: 4, backgroundColor: c.border },
    extra: { width: 8, borderRadius: 4, borderWidth: 1, borderStyle: "dashed", marginLeft: 2 },
    track: { backgroundColor: c.border, overflow: "hidden" },
    fill: { height: "100%", borderRadius: 4 },
    marker: {
        position: "absolute",
        top: 0,
        bottom: 0,
        width: 1,
        backgroundColor: c.ink,
        opacity: 0.25,
    },
    beside: { flexDirection: "row", alignItems: "center", gap: 10 },
    besideLabel: { fontSize: 12, fontWeight: "500" },
    below: { fontSize: 12, color: c.muted, marginTop: 4 },
    head: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 12,
        marginBottom: 8,
    },
    label: { color: c.ink, fontSize: 15, fontWeight: "600" },
    detail: { color: c.muted, fontSize: 12 },
});
