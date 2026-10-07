import {
    type AwayEntry,
    type AwayLength,
    formatTime,
    formatWeekday,
    strings,
    useTeamWeek,
    useTimeOffForm,
    useWeekEditor,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Avatar,
    Badge,
    Button,
    Choice,
    DateStrip,
    Icon,
    IconButton,
    Loading,
    LoadFailed,
    Modal,
    Notice,
    Skeleton,
    TextField,
    WeeklyHoursEditor,
} from "@clientbridge/ui";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";
import { useViewer } from "../lib/auth";

const c = theme.colors;
const s = strings.hours;

/** One person at a time: their regular week in place, their time off and the business closures. */
export function Hours() {
    const viewer = useViewer();
    const week = useTeamWeek(api, viewer);
    const [picked, setPicked] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const staffId = picked ?? viewer?.staffId ?? week.members[0]?.id ?? "";
    const member = week.members.find((m) => m.id === staffId) ?? week.members[0];
    const coming: AwayEntry[] = [...(member?.away ?? []), ...week.closures].sort(
        (a, b) => +a.start - +b.start,
    );

    return (
        <View style={styles.body}>
            <Text style={styles.sectionTitle}>{s.title}</Text>
            <Text style={styles.muted}>{week.canClose ? s.subtitle : s.ownOnly}</Text>
            {week.members.length > 1 ? (
                <Choice
                    label={s.selectPerson}
                    options={week.members.map((m) => ({
                        key: m.id,
                        label: m.name.split(" ")[0] ?? m.name,
                    }))}
                    value={member?.id ?? null}
                    onChange={setPicked}
                />
            ) : null}
            {week.load.state === "loading" ? (
                <Skeleton variant="row" count={5} label={s.loading} />
            ) : week.load.state === "error" ? (
                <LoadFailed
                    message={s.loadError}
                    onRetry={week.load.retry}
                    retrying={week.load.retrying}
                />
            ) : member === undefined ? (
                <Text style={styles.empty}>{s.noStaff}</Text>
            ) : (
                <>
                    {week.load.state === "empty" ? (
                        <Notice tone="info" banner>{`${s.emptyHours}. ${s.emptyHoursBody}`}</Notice>
                    ) : null}
                    <View style={styles.who}>
                        <Avatar name={member.name} color={member.color} size="lg" />
                        <View style={styles.whoText}>
                            <Text style={styles.name}>{member.name}</Text>
                            {member.title !== "" ? (
                                <Text style={styles.muted}>{member.title}</Text>
                            ) : null}
                        </View>
                    </View>
                    {member.editable ? <PersonHours key={member.id} staffId={member.id} /> : null}
                    <Text style={styles.section}>{s.upcomingFor(member.name)}</Text>
                    <View style={styles.list}>
                        {coming.length === 0 ? (
                            <Text style={styles.empty}>{s.noTimeOff}</Text>
                        ) : null}
                        {coming.map((a, i) => (
                            <View key={a.id} style={[styles.row, i > 0 && styles.divider]}>
                                <View
                                    style={[
                                        styles.tile,
                                        {
                                            backgroundColor:
                                                a.staffId === null ? c.danBg : c.warnBg,
                                        },
                                    ]}
                                >
                                    <Icon
                                        name={a.staffId === null ? "lock" : "moon"}
                                        size={16}
                                        color={a.staffId === null ? c.danFg : c.warnFg}
                                    />
                                </View>
                                <View style={styles.whoText}>
                                    <Text style={styles.rowTitle}>
                                        {a.staffId === null
                                            ? `${a.reason} · ${s.everyone}`
                                            : a.reason}
                                    </Text>
                                    <Text style={styles.muted}>{a.when}</Text>
                                    {a.affected > 0 ? (
                                        <View style={styles.badge}>
                                            <Badge label={s.toMove(a.affected)} intent="warning" />
                                        </View>
                                    ) : null}
                                </View>
                                {a.staffId !== null || week.canClose ? (
                                    <IconButton
                                        icon="trash"
                                        size="sm"
                                        disabled={week.removing === a.id}
                                        label={s.removeLabel(`${a.reason}, ${a.when}`)}
                                        onPress={() => {
                                            week.removeAway(a.id);
                                        }}
                                    />
                                ) : null}
                            </View>
                        ))}
                    </View>
                    {week.removeError !== null ? (
                        <Notice tone="danger">{week.removeError}</Notice>
                    ) : null}
                    {member.editable ? (
                        <Button
                            variant="outline"
                            full
                            onPress={() => {
                                setAdding(true);
                            }}
                        >
                            {s.addTimeOff}
                        </Button>
                    ) : null}
                </>
            )}
            {adding ? (
                <TimeOffSheet
                    staffId={member?.id ?? ""}
                    onClose={() => {
                        setAdding(false);
                    }}
                />
            ) : null}
        </View>
    );
}

function PersonHours({ staffId }: { staffId: string }) {
    const editor = useWeekEditor(staffId);
    return (
        <View style={styles.card}>
            <Text style={styles.cardTitle}>{s.regularHours}</Text>
            <Text style={styles.muted}>{s.regularHoursHint}</Text>
            {!editor.ready ? (
                <Loading label={s.loading} />
            ) : (
                <WeeklyHoursEditor
                    days={editor.days}
                    timeOptions={editor.timeOptions}
                    onOpen={editor.setOpen}
                    onTime={editor.setTime}
                    onCopy={editor.copyToWeekdays}
                    copyLabel={s.copyWeekdays}
                    closedLabel={s.closed}
                    toLabel={s.to}
                    hoursLabel={s.dayHours}
                />
            )}
            {editor.error !== null ? <Notice tone="danger">{editor.error}</Notice> : null}
            {editor.saved ? <Notice tone="success">{s.saved}</Notice> : null}
            <View style={styles.saveRow}>
                <Text style={styles.muted}>
                    {s.daysOpen(editor.openDays)} · {s.weekTotal(editor.totalHours)}
                </Text>
                <Button busy={editor.busy} onPress={editor.submit}>
                    {s.saveHours}
                </Button>
            </View>
        </View>
    );
}

const LENGTHS: { key: AwayLength; label: string }[] = [
    { key: "day", label: s.lengthDay },
    { key: "days", label: s.lengthDays },
    { key: "week", label: s.lengthWeek },
    { key: "part", label: s.lengthPart },
];

/** Time off or a closure, picked with a week of dates instead of a date field. */
function TimeOffSheet({ staffId, onClose }: { staffId: string; onClose: () => void }) {
    const form = useTimeOffForm(api, useViewer(), onClose, staffId);
    const [page, setPage] = useState(0);
    const closure = form.staffId === "";
    const hourly = form.timeOptions.filter(
        (o) => o.key.endsWith(":00") && o.key >= "07:00" && o.key <= "20:00",
    );
    const strip = (value: string, onChange: (k: string) => void, label: string) => (
        <View>
            <Text style={styles.label}>{label}</Text>
            <DateStrip
                label={label}
                days={form.pickerDays(page * 7)}
                value={value}
                onChange={onChange}
                onPrev={
                    page > 0
                        ? () => {
                              setPage((p) => p - 1);
                          }
                        : undefined
                }
                onNext={() => {
                    setPage((p) => p + 1);
                }}
                prevLabel={s.prevWeek}
                nextLabel={s.nextWeek}
            />
        </View>
    );
    return (
        <Modal onClose={onClose} size="xl">
            <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
                <Text accessibilityRole="header" style={styles.title}>
                    {closure ? s.addClosure : s.addTimeOff}
                </Text>
                <Text style={styles.muted}>{closure ? s.closuresHint : s.timeOffHint}</Text>
                {form.staffOptions.length > 1 ? (
                    <>
                        <Text style={styles.label}>{s.who}</Text>
                        <Choice
                            label={s.who}
                            options={form.staffOptions}
                            value={form.staffId}
                            onChange={form.setStaffId}
                        />
                    </>
                ) : null}
                <Text style={styles.label}>{s.length}</Text>
                <Choice
                    label={s.length}
                    options={LENGTHS}
                    value={form.length}
                    onChange={form.setLength}
                />
                {strip(form.from, form.setFrom, form.length === "days" ? s.firstDay : s.date)}
                {form.length === "days" ? strip(form.to, form.setTo, s.lastDay) : null}
                {form.length === "part" ? (
                    <>
                        <Text style={styles.label}>{s.startTime}</Text>
                        <Choice
                            label={s.startTime}
                            options={hourly}
                            value={form.startTime}
                            onChange={form.setStartTime}
                        />
                        <Text style={styles.label}>{s.endTime}</Text>
                        <Choice
                            label={s.endTime}
                            options={hourly}
                            value={form.endTime}
                            onChange={form.setEndTime}
                        />
                    </>
                ) : null}
                <TextField
                    label={s.reason}
                    value={form.reason}
                    onChange={form.setReason}
                    placeholder={s.reasonPlaceholder}
                    hint={s.reasonHint}
                />
                <View style={styles.summary}>
                    <Text style={styles.summaryTitle}>{form.summary}</Text>
                    {form.affected.length === 0 ? (
                        <Text style={styles.summaryNote}>{s.nothingBooked}</Text>
                    ) : (
                        <>
                            <Text style={[styles.summaryNote, styles.warn]}>
                                {form.affectedNote}
                            </Text>
                            {form.affected.map((e) => (
                                <View key={e.id} style={styles.visit}>
                                    <View
                                        style={[
                                            styles.bar,
                                            { backgroundColor: e.color ?? c.accent },
                                        ]}
                                    />
                                    <Text style={styles.visitTime} numberOfLines={1}>
                                        {formatWeekday(e.start)} {formatTime(e.start)}
                                    </Text>
                                    <Text style={styles.visitName} numberOfLines={1}>
                                        {e.headline}
                                    </Text>
                                </View>
                            ))}
                        </>
                    )}
                </View>
                {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
            </ScrollView>
            <View style={styles.footer}>
                <Button variant="outline" grow onPress={onClose}>
                    {s.cancel}
                </Button>
                <Button grow busy={form.busy} disabled={!form.canSubmit} onPress={form.submit}>
                    {closure ? s.saveClosure : s.saveTimeOff}
                </Button>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    body: { gap: 14, paddingTop: 8 },
    sectionTitle: { fontSize: 18, fontWeight: "700", color: c.ink },
    who: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 },
    whoText: { flex: 1, minWidth: 0 },
    name: { fontSize: 18, fontWeight: "700", color: c.ink },
    muted: { fontSize: 13, color: c.muted, marginTop: 2 },
    card: {
        backgroundColor: c.surface,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        padding: 16,
        gap: 8,
    },
    cardTitle: { fontSize: 16, fontWeight: "700", color: c.ink },
    saveRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: c.border,
        paddingTop: 12,
        marginTop: 4,
    },
    section: {
        fontSize: 12,
        fontWeight: "700",
        color: c.muted,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginTop: 4,
    },
    list: {
        backgroundColor: c.surface,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
    },
    empty: { padding: 16, fontSize: 14, color: c.muted, textAlign: "center" },
    row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    tile: {
        width: 32,
        height: 32,
        borderRadius: 6,
        alignItems: "center",
        justifyContent: "center",
    },
    rowTitle: { fontSize: 15, fontWeight: "600", color: c.ink },
    badge: { flexDirection: "row", marginTop: 6 },
    sheet: { paddingBottom: 12 },
    title: { fontSize: 20, fontWeight: "700", color: c.ink },
    label: { color: c.inkSoft, fontSize: 13, fontWeight: "600", marginBottom: 8, marginTop: 16 },
    summary: {
        marginTop: 18,
        padding: 14,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.bg,
        gap: 6,
    },
    summaryTitle: { fontSize: 14, fontWeight: "700", color: c.ink },
    summaryNote: { fontSize: 12, color: c.muted, lineHeight: 17 },
    warn: { color: c.warnFg },
    visit: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 4 },
    bar: { width: 3, height: 20, borderRadius: 2 },
    visitTime: { width: 104, fontSize: 13, color: c.muted, fontVariant: ["tabular-nums"] },
    visitName: { flex: 1, fontSize: 13, color: c.ink },
    footer: {
        flexDirection: "row",
        gap: 10,
        paddingTop: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: c.border,
    },
});
