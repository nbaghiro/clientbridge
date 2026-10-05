import {
    RECUR_FREQUENCIES,
    combineDayAndTime,
    staffLabel,
    strings,
    useBookingForm,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { type ReactNode, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Modal } from "@clientbridge/ui";

import { api } from "../lib/api";

const c = theme.colors;
export function BookingForm({ visible, onClose }: { visible: boolean; onClose: () => void }) {
    const form = useBookingForm(api, onClose);
    const days = form.dayOptions;
    const [dayIdx, setDayIdx] = useState(0);
    const [timeIdx, setTimeIdx] = useState<number | null>(null);

    const submit = (): void => {
        const time = timeIdx !== null ? form.timeOptions[timeIdx] : undefined;
        const day = days[dayIdx];
        const startsAt = time && day ? combineDayAndTime(day.date, time.hhmm) : null;
        form.submit(startsAt);
    };

    return (
        <Modal open={visible} onClose={onClose}>
            <Text style={styles.title}>{strings.calendar.newBooking}</Text>
            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
                <Section label={strings.calendar.client}>
                    {form.clients.map((cl) => (
                        <Chip
                            key={cl.id}
                            label={cl.name}
                            on={form.clientId === cl.id}
                            onPress={() => {
                                form.setClientId(cl.id);
                            }}
                        />
                    ))}
                </Section>
                <Section label={strings.calendar.service}>
                    {form.items.map((it) => (
                        <Chip
                            key={it.id}
                            label={it.name}
                            on={form.itemId === it.id}
                            onPress={() => {
                                form.setItemId(it.id);
                            }}
                        />
                    ))}
                </Section>
                {form.staff.length > 1 ? (
                    <Section label={strings.calendar.staff}>
                        {form.staff.map((s) => (
                            <Chip
                                key={s.id}
                                label={staffLabel(s)}
                                on={form.effStaff === s.id}
                                onPress={() => {
                                    form.setStaffId(s.id);
                                }}
                            />
                        ))}
                    </Section>
                ) : null}
                <Section label={strings.calendar.date}>
                    {days.map((d, i) => (
                        <Chip
                            key={d.date.toISOString()}
                            label={d.label}
                            on={dayIdx === i}
                            onPress={() => {
                                setDayIdx(i);
                            }}
                        />
                    ))}
                </Section>
                <Section label={strings.calendar.time}>
                    {form.timeOptions.map((t, i) => (
                        <Chip
                            key={t.hhmm}
                            label={t.label}
                            on={timeIdx === i}
                            onPress={() => {
                                setTimeIdx(i);
                            }}
                        />
                    ))}
                </Section>
                <Section label={strings.calendar.repeat}>
                    <Chip
                        label={strings.calendar.oneTime}
                        on={!form.repeat}
                        onPress={() => {
                            form.setRepeat(false);
                        }}
                    />
                    {RECUR_FREQUENCIES.map((f) => (
                        <Chip
                            key={f.value}
                            label={f.label}
                            on={form.repeat && form.frequency === f.value}
                            onPress={() => {
                                form.setRepeat(true);
                                form.setFrequency(f.value);
                            }}
                        />
                    ))}
                </Section>
                {form.repeat ? (
                    <>
                        <Section label={strings.calendar.every}>
                            {[1, 2, 3, 4].map((n) => (
                                <Chip
                                    key={n}
                                    label={String(n)}
                                    on={form.interval === n}
                                    onPress={() => {
                                        form.setInterval(n);
                                    }}
                                />
                            ))}
                        </Section>
                        <Section label={strings.calendar.occurrences}>
                            {[2, 4, 6, 8, 12].map((n) => (
                                <Chip
                                    key={n}
                                    label={String(n)}
                                    on={form.count === n}
                                    onPress={() => {
                                        form.setCount(n);
                                    }}
                                />
                            ))}
                        </Section>
                    </>
                ) : null}
            </ScrollView>
            {form.error !== null ? <Text style={styles.error}>{form.error}</Text> : null}
            {form.notice !== null ? <Text style={styles.notice}>{form.notice}</Text> : null}
            <View style={styles.actions}>
                <Pressable onPress={onClose} style={styles.cancelBtn}>
                    <Text style={styles.cancelText}>{strings.common.cancel}</Text>
                </Pressable>
                <Pressable
                    onPress={submit}
                    disabled={form.busy}
                    style={[styles.bookBtn, form.busy && styles.dim]}
                >
                    <Text style={styles.bookText}>
                        {form.busy
                            ? strings.calendar.booking
                            : form.repeat
                              ? strings.calendar.bookSeries
                              : strings.calendar.book}
                    </Text>
                </Pressable>
            </View>
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
    notice: { color: c.success, fontSize: 13, marginTop: 12 },
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
