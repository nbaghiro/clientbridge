import {
    type StaffRow,
    WEEKDAYS,
    staffLabel,
    useAvailabilityEditor,
    useStaff,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    View,
} from "react-native";

const c = theme.colors;

export function SchedulingScreen() {
    const staff = useStaff();
    const [staffId, setStaffId] = useState<string | null>(null);
    const selected = staffId ?? staff[0]?.id ?? null;

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Text style={styles.note}>
                Set each team member’s weekly working hours. Bookings are held to these windows.
            </Text>

            {selected === null ? (
                <Text style={styles.empty}>No team members yet.</Text>
            ) : (
                <>
                    {staff.length > 1 ? (
                        <View style={styles.chipWrap}>
                            {staff.map((s: StaffRow) => {
                                const on = s.id === selected;
                                return (
                                    <Pressable
                                        key={s.id}
                                        style={[styles.chip, on && styles.chipOn]}
                                        onPress={() => {
                                            setStaffId(s.id);
                                        }}
                                    >
                                        <Text style={[styles.chipText, on && styles.chipTextOn]}>
                                            {staffLabel(s)}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                        </View>
                    ) : null}

                    <WeeklyHours key={selected} staffId={selected} />
                </>
            )}
        </ScrollView>
    );
}

function WeeklyHours({ staffId }: { staffId: string }) {
    const editor = useAvailabilityEditor(staffId);
    const days = editor.days;

    if (days === null) {
        return <ActivityIndicator style={styles.loading} color={c.muted} />;
    }

    return (
        <View style={styles.group}>
            {days.map((d, i) => {
                const label = WEEKDAYS[d.weekday]?.label ?? "";
                return (
                    <View key={d.weekday} style={[styles.row, i > 0 ? styles.rowBorder : null]}>
                        <View style={styles.rowHead}>
                            <Text style={styles.day}>{label}</Text>
                            <Switch
                                value={d.open}
                                onValueChange={(v) => {
                                    editor.setOpen(d.weekday, v);
                                }}
                                trackColor={{ true: c.accent, false: c.border }}
                            />
                        </View>
                        {d.open ? (
                            <View style={styles.times}>
                                <TextInput
                                    style={styles.time}
                                    value={d.start}
                                    onChangeText={(v) => {
                                        editor.setTime(d.weekday, "start", v);
                                    }}
                                    placeholder="09:00"
                                    placeholderTextColor={c.muted}
                                    keyboardType="numbers-and-punctuation"
                                />
                                <Text style={styles.to}>to</Text>
                                <TextInput
                                    style={styles.time}
                                    value={d.end}
                                    onChangeText={(v) => {
                                        editor.setTime(d.weekday, "end", v);
                                    }}
                                    placeholder="17:00"
                                    placeholderTextColor={c.muted}
                                    keyboardType="numbers-and-punctuation"
                                />
                            </View>
                        ) : (
                            <Text style={styles.closed}>Closed</Text>
                        )}
                    </View>
                );
            })}

            {editor.error !== null ? <Text style={styles.error}>{editor.error}</Text> : null}
            {editor.saved ? <Text style={styles.saved}>Saved.</Text> : null}

            <Pressable
                style={({ pressed }) => [styles.submit, (editor.busy || pressed) && styles.dim]}
                onPress={editor.submit}
                disabled={editor.busy}
            >
                {editor.busy ? (
                    <ActivityIndicator color="#fff" />
                ) : (
                    <Text style={styles.submitText}>Save hours</Text>
                )}
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16 },
    note: { color: c.muted, fontSize: 13, marginBottom: 14, lineHeight: 18 },
    empty: { color: c.muted, fontSize: 14, textAlign: "center", marginTop: 24 },
    loading: { marginTop: 24 },
    chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
    chip: {
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: theme.radius,
        paddingHorizontal: 14,
        paddingVertical: 8,
        backgroundColor: c.surface,
    },
    chipOn: { backgroundColor: c.accent, borderColor: c.accent },
    chipText: { color: c.inkSoft, fontSize: 13, fontWeight: "700" },
    chipTextOn: { color: c.accentInk },
    group: {
        backgroundColor: c.surface,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        padding: 16,
    },
    row: { paddingVertical: 12 },
    rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    rowHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    day: { color: c.ink, fontSize: 15, fontWeight: "600" },
    times: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
    time: {
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: theme.radius,
        paddingHorizontal: 12,
        paddingVertical: 9,
        color: c.ink,
        fontSize: 15,
        backgroundColor: c.bg,
        minWidth: 88,
        textAlign: "center",
    },
    to: { color: c.muted, fontSize: 13 },
    closed: { color: c.muted, fontSize: 13, marginTop: 8 },
    error: { color: c.danFg, fontSize: 13, marginTop: 14 },
    saved: { color: c.success, fontSize: 13, marginTop: 14 },
    submit: {
        backgroundColor: c.accent,
        borderRadius: theme.radius,
        paddingVertical: 15,
        alignItems: "center",
        marginTop: 18,
    },
    dim: { opacity: 0.7 },
    submitText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
