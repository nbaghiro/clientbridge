import type { SkeletonProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { useEffect, useRef } from "react";
import { Animated, type DimensionValue, StyleSheet, View } from "react-native";

const c = theme.colors;

export function Skeleton({ variant, count = 1, columns, label }: SkeletonProps) {
    const pulse = useRef(new Animated.Value(0.5)).current;
    useEffect(() => {
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: false }),
                Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: false }),
            ]),
        );
        loop.start();
        return () => {
            loop.stop();
        };
    }, [pulse]);
    const pct = (n: number): DimensionValue => `${String(n)}%` as DimensionValue;
    const bar = (width: DimensionValue, height: number) => (
        <Animated.View style={[styles.bar, { width, height, opacity: pulse }]} />
    );
    return (
        <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={label}
            accessibilityState={{ busy: true }}
            style={columns ? styles.grid : undefined}
        >
            {Array.from({ length: count }, (_, i) =>
                variant === "row" ? (
                    <View key={i} style={styles.row}>
                        <Animated.View style={[styles.bar, styles.tile, { opacity: pulse }]} />
                        <View style={styles.lines}>
                            {bar(pct(55 - ((i * 13) % 24)), 12)}
                            {bar(pct(35 - ((i * 7) % 14)), 10)}
                        </View>
                    </View>
                ) : variant === "stat" ? (
                    <View
                        key={i}
                        style={[
                            styles.stat,
                            columns
                                ? { width: `${String(100 / columns)}%` as DimensionValue }
                                : null,
                        ]}
                    >
                        {bar(70, 10)}
                        {bar(110, 22)}
                    </View>
                ) : (
                    <View key={i} style={styles.line}>
                        {bar(pct(90 - ((i * 17) % 40)), 12)}
                    </View>
                ),
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    grid: { flexDirection: "row", flexWrap: "wrap" },
    bar: { backgroundColor: c.surface2, borderRadius: 4 },
    row: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 16,
    },
    tile: { width: 36, height: 36, borderRadius: theme.radius },
    lines: { flex: 1, gap: 8 },
    stat: { gap: 10, padding: 14 },
    line: { paddingVertical: 6 },
});
