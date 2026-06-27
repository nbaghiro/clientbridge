import {
    createBooking,
    staffLabel,
    useCatalogItems,
    useClients,
    useStaff,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { type ReactNode, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";

const c = theme.colors;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function nextDays(n: number): Date[] {
    const t = new Date();
    return Array.from(
        { length: n },
        (_, i) => new Date(t.getFullYear(), t.getMonth(), t.getDate() + i),
    );
}

const TIMES = Array.from({ length: 24 }, (_, i) => {
    const h = 7 + Math.floor(i / 2);
    const m = i % 2 === 0 ? 0 : 30;
    return {
        h,
        m,
        label: new Date(2000, 0, 1, h, m).toLocaleTimeString("en-CA", {
            hour: "numeric",
            minute: "2-digit",
        }),
    };
});

export function BookingForm({ visible, onClose }: { visible: boolean; onClose: () => void }) {
    const clients = useClients();
    const items = useCatalogItems();
    const staff = useStaff();
    const days = nextDays(14);

    const [clientId, setClientId] = useState("");
    const [itemId, setItemId] = useState("");
    const [staffId, setStaffId] = useState("");
    const [dayIdx, setDayIdx] = useState(0);
    const [timeIdx, setTimeIdx] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const effStaff = staffId.length > 0 ? staffId : (staff.at(0)?.id ?? "");

    const submit = async (): Promise<void> => {
        const time = timeIdx !== null ? TIMES[timeIdx] : undefined;
        const day = days[dayIdx];
        if (
            clientId.length === 0 ||
            itemId.length === 0 ||
            effStaff.length === 0 ||
            !time ||
            !day
        ) {
            setError("Pick a client, service, and time.");
            return;
        }
        setBusy(true);
        setError(null);
        const startsAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.h, time.m);
        try {
            await createBooking(api, { clientId, itemId, staffId: effStaff, startsAt });
            setClientId("");
            setItemId("");
            setTimeIdx(null);
            onClose();
        } catch {
            setError("Could not book — that time may already be taken.");
            setBusy(false);
        }
    };

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <Pressable style={styles.backdrop} onPress={onClose}>
                <View style={styles.sheet} onStartShouldSetResponder={() => true}>
                    <Text style={styles.title}>New booking</Text>
                    <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
                        <Section label="Client">
                            {clients.map((cl) => (
                                <Chip
                                    key={cl.id}
                                    label={cl.name}
                                    on={clientId === cl.id}
                                    onPress={() => {
                                        setClientId(cl.id);
                                    }}
                                />
                            ))}
                        </Section>
                        <Section label="Service">
                            {items.map((it) => (
                                <Chip
                                    key={it.id}
                                    label={it.name}
                                    on={itemId === it.id}
                                    onPress={() => {
                                        setItemId(it.id);
                                    }}
                                />
                            ))}
                        </Section>
                        {staff.length > 1 ? (
                            <Section label="Staff">
                                {staff.map((s) => (
                                    <Chip
                                        key={s.id}
                                        label={staffLabel(s)}
                                        on={effStaff === s.id}
                                        onPress={() => {
                                            setStaffId(s.id);
                                        }}
                                    />
                                ))}
                            </Section>
                        ) : null}
                        <Section label="Date">
                            {days.map((d, i) => (
                                <Chip
                                    key={d.toISOString()}
                                    label={`${WEEKDAY[d.getDay()] ?? ""} ${d.getDate()}`}
                                    on={dayIdx === i}
                                    onPress={() => {
                                        setDayIdx(i);
                                    }}
                                />
                            ))}
                        </Section>
                        <Section label="Time">
                            {TIMES.map((t, i) => (
                                <Chip
                                    key={t.label}
                                    label={t.label}
                                    on={timeIdx === i}
                                    onPress={() => {
                                        setTimeIdx(i);
                                    }}
                                />
                            ))}
                        </Section>
                    </ScrollView>
                    {error !== null ? <Text style={styles.error}>{error}</Text> : null}
                    <View style={styles.actions}>
                        <Pressable onPress={onClose} style={styles.cancelBtn}>
                            <Text style={styles.cancelText}>Cancel</Text>
                        </Pressable>
                        <Pressable
                            onPress={() => {
                                void submit();
                            }}
                            disabled={busy}
                            style={[styles.bookBtn, busy && styles.dim]}
                        >
                            <Text style={styles.bookText}>{busy ? "Booking…" : "Book"}</Text>
                        </Pressable>
                    </View>
                </View>
            </Pressable>
        </Modal>
    );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
    return (
        <View style={styles.section}>
            <Text style={styles.sectionLabel}>{label}</Text>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.row}
            >
                {children}
            </ScrollView>
        </View>
    );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
    return (
        <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: "rgba(20,25,30,0.4)", justifyContent: "flex-end" },
    sheet: {
        backgroundColor: c.bg,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        paddingHorizontal: 20,
        paddingTop: 18,
        paddingBottom: 36,
    },
    title: { color: c.ink, fontSize: 18, fontWeight: "700", marginBottom: 8 },
    scroll: { maxHeight: 430 },
    section: { marginTop: 14 },
    sectionLabel: {
        color: c.muted,
        fontSize: 12,
        fontWeight: "700",
        textTransform: "uppercase",
        letterSpacing: 0.4,
        marginBottom: 8,
    },
    row: { gap: 8, paddingRight: 16 },
    chip: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: c.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
    },
    chipOn: { backgroundColor: c.accent, borderColor: c.accent },
    chipText: { color: c.ink, fontSize: 14, fontWeight: "500" },
    chipTextOn: { color: c.accentInk },
    error: { color: c.danFg, fontSize: 13, marginTop: 12 },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 18 },
    cancelBtn: { paddingHorizontal: 16, paddingVertical: 11 },
    cancelText: { color: c.muted, fontSize: 15, fontWeight: "600" },
    bookBtn: {
        paddingHorizontal: 24,
        paddingVertical: 11,
        borderRadius: 10,
        backgroundColor: c.accent,
    },
    bookText: { color: c.accentInk, fontSize: 15, fontWeight: "600" },
    dim: { opacity: 0.5 },
});
