import type { ProgressStepState, ProgressStepsProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, Text, View } from "react-native";

import { Icon } from "./Icon";

const c = theme.colors;

function Dot({ state, n }: { state: ProgressStepState; n: number }) {
    return (
        <View style={[styles.dot, DOT[state]]}>
            {state === "done" ? (
                <Icon name="check" size={14} color={c.accentInk} />
            ) : state === "blocked" ? (
                <Icon name="alert" size={13} color={c.warnFg} />
            ) : (
                <Text style={[styles.n, { color: state === "current" ? c.accent : c.muted }]}>
                    {n}
                </Text>
            )}
        </View>
    );
}

export function ProgressSteps({ steps, layout = "row", label }: ProgressStepsProps) {
    if (layout === "row") {
        const current = steps.findIndex((s) => s.state === "current");
        return (
            <View
                accessibilityRole="progressbar"
                accessibilityLabel={label}
                accessibilityValue={{
                    min: 1,
                    max: steps.length,
                    now: current + 1,
                    text: steps[current]?.label ?? "",
                }}
                style={styles.row}
            >
                {steps.map((s, i) => (
                    <View
                        key={s.key}
                        style={[
                            styles.bar,
                            {
                                backgroundColor:
                                    s.state === "done" || i === current ? c.accent : c.border,
                            },
                        ]}
                    />
                ))}
            </View>
        );
    }
    return (
        <View accessibilityLabel={label}>
            {steps.map((s, i) => (
                <View
                    key={s.key}
                    style={styles.item}
                    accessible
                    accessibilityLabel={s.hint !== undefined ? `${s.label}, ${s.hint}` : s.label}
                    accessibilityState={{
                        selected: s.state === "current",
                        disabled: s.state === "todo",
                    }}
                >
                    <View style={styles.rail}>
                        <Dot state={s.state} n={i + 1} />
                        {i < steps.length - 1 ? (
                            <View
                                style={[
                                    styles.line,
                                    { backgroundColor: s.state === "done" ? c.accent : c.border },
                                ]}
                            />
                        ) : null}
                    </View>
                    <View style={[styles.text, i < steps.length - 1 && styles.gap]}>
                        <Text style={[styles.label, s.state === "todo" && styles.muted]}>
                            {s.label}
                        </Text>
                        {s.hint !== undefined ? (
                            <Text style={[styles.hint, s.state === "blocked" && styles.warn]}>
                                {s.hint}
                            </Text>
                        ) : null}
                    </View>
                </View>
            ))}
        </View>
    );
}

const DOT = StyleSheet.create({
    done: { backgroundColor: c.accent },
    current: { borderWidth: 2, borderColor: c.accent, backgroundColor: c.surface },
    todo: { borderWidth: 2, borderColor: c.border, backgroundColor: c.surface },
    blocked: { backgroundColor: c.warnBg },
});

const styles = StyleSheet.create({
    row: { flexDirection: "row", gap: 6 },
    bar: { flex: 1, height: 4, borderRadius: 2 },
    item: { flexDirection: "row", gap: 12 },
    rail: { alignItems: "center" },
    dot: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
    },
    n: { fontSize: 12, fontWeight: "700" },
    line: { width: 2, flex: 1, marginVertical: 4, borderRadius: 1 },
    text: { flex: 1, paddingTop: 4 },
    gap: { paddingBottom: 18 },
    label: { color: c.ink, fontSize: 15, fontWeight: "600" },
    muted: { color: c.muted, fontWeight: "500" },
    hint: { color: c.muted, fontSize: 13, marginTop: 2, lineHeight: 18 },
    warn: { color: c.warnFg },
});
