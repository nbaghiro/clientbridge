import type { WeeklyHoursEditorProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { TimeSlotPicker } from "./TimeSlotPicker";

const c = theme.colors;

/** A row per weekday: a switch, then start and end pills that open a time grid; closed days collapse. */
export function WeeklyHoursEditor({
    days,
    timeOptions,
    onOpen,
    onTime,
    onCopy,
    copyLabel,
    closedLabel,
    toLabel,
    hoursLabel,
}: WeeklyHoursEditorProps) {
    const [picking, setPicking] = useState<{ weekday: number; which: "start" | "end" } | null>(
        null,
    );
    const firstOpen = days.find((d) => d.open)?.weekday;
    const label = (key: string): string => timeOptions.find((o) => o.key === key)?.label ?? key;
    const day = days.find((d) => d.weekday === picking?.weekday);
    return (
        <View>
            {days.map((d, i) => (
                <View key={d.weekday} style={[styles.row, i > 0 && styles.divider]}>
                    <View style={styles.head}>
                        <Text style={[styles.day, !d.open && styles.muted]}>{d.label}</Text>
                        <Text style={[styles.meta, d.error !== null && styles.error]}>
                            {d.open ? (d.error ?? hoursLabel(d.hours)) : closedLabel}
                        </Text>
                        <Switch
                            value={d.open}
                            onValueChange={(v) => {
                                onOpen(d.weekday, v);
                            }}
                            accessibilityLabel={d.label}
                            trackColor={{ true: c.accent, false: c.border }}
                            thumbColor={c.surface}
                        />
                    </View>
                    {d.open ? (
                        <View style={styles.times}>
                            {(["start", "end"] as const).map((which, k) => (
                                <View key={which} style={styles.timeWrap}>
                                    {k === 1 ? <Text style={styles.to}>{toLabel}</Text> : null}
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={`${d.label} ${which}: ${label(d[which])}`}
                                        onPress={() => {
                                            setPicking({ weekday: d.weekday, which });
                                        }}
                                        style={[styles.pill, d.error !== null && styles.pillError]}
                                    >
                                        <Text style={styles.pillText}>{label(d[which])}</Text>
                                    </Pressable>
                                </View>
                            ))}
                            {onCopy !== undefined && d.weekday === firstOpen ? (
                                <View style={styles.copy}>
                                    <Button
                                        size="sm"
                                        variant="link"
                                        onPress={() => {
                                            onCopy(d.weekday);
                                        }}
                                    >
                                        {copyLabel}
                                    </Button>
                                </View>
                            ) : null}
                        </View>
                    ) : null}
                </View>
            ))}
            {picking !== null && day !== undefined ? (
                <Modal
                    onClose={() => {
                        setPicking(null);
                    }}
                    size="xl"
                >
                    <Text style={styles.sheetTitle}>{day.label}</Text>
                    <ScrollView>
                        <TimeSlotPicker
                            label={day.label}
                            columns={4}
                            groups={[
                                {
                                    label: picking.which === "start" ? day.short : toLabel,
                                    slots: timeOptions,
                                },
                            ]}
                            value={day[picking.which]}
                            onChange={(v) => {
                                onTime(day.weekday, picking.which, v);
                                setPicking(null);
                            }}
                        />
                    </ScrollView>
                </Modal>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    row: { paddingVertical: 12 },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    head: { flexDirection: "row", alignItems: "center", gap: 10 },
    day: { flex: 1, fontSize: 15, fontWeight: "600", color: c.ink },
    muted: { color: c.muted },
    meta: { fontSize: 13, color: c.muted, fontVariant: ["tabular-nums"] },
    error: { color: c.danFg, fontWeight: "600" },
    times: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 10 },
    timeWrap: { flexDirection: "row", alignItems: "center", gap: 8 },
    to: { fontSize: 13, color: c.muted },
    pill: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.bg,
    },
    pillError: { borderColor: c.danFg },
    pillText: { fontSize: 15, fontWeight: "600", color: c.ink, fontVariant: ["tabular-nums"] },
    copy: { marginLeft: "auto" },
    sheetTitle: { fontSize: 18, fontWeight: "700", color: c.ink, marginBottom: 14 },
});
