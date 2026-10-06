import type { UsageBarProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, Text, View } from "react-native";

const c = theme.colors;

/** A day of a room or station: bookings as coloured spans, hour ticks under it and a now line. */
export function UsageBar({ segments, total, now, ticks = [], label }: UsageBarProps) {
    const pct = (m: number): `${number}%` => `${(m / total) * 100}%`;
    return (
        <View accessibilityLabel={label}>
            <View style={styles.track}>
                {ticks.map((t) => (
                    <View key={t.at} style={[styles.tick, { left: pct(t.at) }]} />
                ))}
                {segments.map((s) => (
                    <View
                        key={s.key}
                        style={[
                            styles.seg,
                            {
                                left: pct(s.from),
                                width: pct(s.to - s.from),
                                backgroundColor: s.color ?? c.accent,
                            },
                        ]}
                    />
                ))}
                {now !== undefined && now !== null && now > 0 && now < total ? (
                    <View style={[styles.now, { left: pct(now) }]} />
                ) : null}
            </View>
            {ticks.length > 0 ? (
                <View style={styles.labels}>
                    {ticks.map((t) => (
                        <Text
                            key={t.at}
                            numberOfLines={1}
                            style={[
                                styles.tickLabel,
                                t.at / total > 0.85
                                    ? { right: 0, textAlign: "right" }
                                    : { left: pct(t.at) },
                            ]}
                        >
                            {t.label}
                        </Text>
                    ))}
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    track: { height: 22, borderRadius: 6, backgroundColor: c.bg, overflow: "hidden" },
    tick: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: c.borderSoft },
    seg: { position: "absolute", top: 3, bottom: 3, borderRadius: 4 },
    now: { position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: c.danFg },
    labels: { height: 14, marginTop: 3 },
    tickLabel: { position: "absolute", width: 44, fontSize: 10, color: c.muted },
});
