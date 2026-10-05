import {
    RECUR_FREQUENCIES,
    combineDayAndTime,
    staffLabel,
    strings,
    useBookingForm,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { type ReactNode, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Choice, Modal, Notice } from "@clientbridge/ui";

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
            <Text style={styles.title}>{strings.bookings.newBooking}</Text>
            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
                <Section label={strings.bookings.client}>
                    <Choice
                        label={strings.bookings.client}
                        options={form.clients.map((cl) => ({ key: cl.id, label: cl.name }))}
                        value={form.clientId}
                        onChange={form.setClientId}
                    />
                </Section>
                <Section label={strings.bookings.service}>
                    <Choice
                        label={strings.bookings.service}
                        options={form.items.map((it) => ({ key: it.id, label: it.name }))}
                        value={form.itemId}
                        onChange={form.setItemId}
                    />
                </Section>
                {form.staff.length > 1 ? (
                    <Section label={strings.bookings.staff}>
                        <Choice
                            label={strings.bookings.staff}
                            options={form.staff.map((s) => ({ key: s.id, label: staffLabel(s) }))}
                            value={form.effStaff}
                            onChange={form.setStaffId}
                        />
                    </Section>
                ) : null}
                <Section label={strings.bookings.date}>
                    <Choice
                        label={strings.bookings.date}
                        options={days.map((d, i) => ({ key: String(i), label: d.label }))}
                        value={String(dayIdx)}
                        onChange={(i) => {
                            setDayIdx(Number(i));
                        }}
                    />
                </Section>
                <Section label={strings.bookings.time}>
                    <Choice
                        label={strings.bookings.time}
                        options={form.timeOptions.map((t, i) => ({
                            key: String(i),
                            label: t.label,
                        }))}
                        value={timeIdx === null ? null : String(timeIdx)}
                        onChange={(i) => {
                            setTimeIdx(Number(i));
                        }}
                    />
                </Section>
                <Section label={strings.bookings.repeat}>
                    <Choice
                        label={strings.bookings.repeat}
                        options={[
                            { key: ONCE, label: strings.bookings.oneTime },
                            ...RECUR_FREQUENCIES.map((f) => ({ key: f.value, label: f.label })),
                        ]}
                        value={form.repeat ? form.frequency : ONCE}
                        onChange={(key) => {
                            const frequency = RECUR_FREQUENCIES.find((f) => f.value === key);
                            form.setRepeat(frequency !== undefined);
                            if (frequency !== undefined) form.setFrequency(frequency.value);
                        }}
                    />
                </Section>
                {form.repeat ? (
                    <>
                        <Section label={strings.bookings.every}>
                            <Choice
                                label={strings.bookings.every}
                                options={[1, 2, 3, 4].map((n) => ({
                                    key: String(n),
                                    label: String(n),
                                }))}
                                value={String(form.interval)}
                                onChange={(n) => {
                                    form.setInterval(Number(n));
                                }}
                            />
                        </Section>
                        <Section label={strings.bookings.occurrences}>
                            <Choice
                                label={strings.bookings.occurrences}
                                options={[2, 4, 6, 8, 12].map((n) => ({
                                    key: String(n),
                                    label: String(n),
                                }))}
                                value={String(form.count)}
                                onChange={(n) => {
                                    form.setCount(Number(n));
                                }}
                            />
                        </Section>
                    </>
                ) : null}
            </ScrollView>
            {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
            {form.notice !== null ? <Notice tone="success">{form.notice}</Notice> : null}
            <View style={styles.actions}>
                <Button variant="quiet" onPress={onClose}>
                    {strings.common.cancel}
                </Button>
                <Button onPress={submit} busy={form.busy}>
                    {form.busy
                        ? strings.bookings.booking
                        : form.repeat
                          ? strings.bookings.bookSeries
                          : strings.bookings.book}
                </Button>
            </View>
        </Modal>
    );
}

const ONCE = "once";

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
    row: { paddingRight: 16 },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 18 },
});
