import {
    type ChangeScope,
    type SeriesEnd,
    type SeriesFrequency,
    type SeriesRecord,
    occurrenceRow,
    strings,
    useSeriesComposer,
    useSeriesList,
    useSeriesRecord,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Badge,
    Button,
    Choice,
    Empty,
    Icon,
    ListRow,
    LoadFailed,
    Modal,
    Notice,
    OccurrenceList,
    SearchField,
    Skeleton,
    Stepper,
    TextField,
    Toggle,
} from "@clientbridge/ui";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";
import { useViewer } from "../lib/auth";

const c = theme.colors;
const s = strings.recurrences;

/** Repeat visits: the list with progress, one series' dates with change and cancel, and a new series. */
export function RecurrencesScreen() {
    const list = useSeriesList();
    const [openId, setOpenId] = useState<string | null>(null);
    const [composing, setComposing] = useState(false);

    if (composing) {
        return (
            <SeriesComposer
                onDone={() => {
                    setComposing(false);
                }}
            />
        );
    }
    if (openId !== null) {
        return (
            <Record
                key={openId}
                id={openId}
                onBack={() => {
                    setOpenId(null);
                }}
            />
        );
    }
    return (
        <ScrollView
            style={styles.screen}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
        >
            <View style={styles.headRow}>
                <Text style={styles.muted}>{s.listSubtitle(list.counts.all)}</Text>
                <Button
                    size="sm"
                    icon="plus"
                    onPress={() => {
                        setComposing(true);
                    }}
                >
                    {s.newShort}
                </Button>
            </View>
            <SearchField value={list.q} onChange={list.setQ} placeholder={s.search} />
            <Choice
                label={s.filterAll}
                options={[
                    { key: "all", label: s.filterAll },
                    {
                        key: "attention",
                        label: `${s.filterAttention} · ${String(list.counts.attention)}`,
                    },
                    { key: "ending", label: `${s.filterEnding} · ${String(list.counts.ending)}` },
                ]}
                value={list.filter}
                onChange={list.setFilter}
            />
            {list.load.state === "loading" ? (
                <Skeleton variant="row" count={5} label={s.loading} />
            ) : list.load.state === "error" ? (
                <LoadFailed
                    message={s.loadError}
                    onRetry={list.load.retry}
                    retrying={list.load.retrying}
                />
            ) : list.load.state === "empty" ? (
                <Empty
                    variant="card"
                    icon="repeat"
                    message={s.emptyListTitle}
                    body={s.emptyList}
                    actions={
                        <Button
                            size="sm"
                            onPress={() => {
                                setComposing(true);
                            }}
                        >
                            {s.newSeries}
                        </Button>
                    }
                />
            ) : list.rows.length === 0 ? (
                <Empty message={s.emptySearch} />
            ) : (
                <View style={styles.list}>
                    {list.rows.map((r) => (
                        <ListRow
                            key={r.id}
                            title={[r.petName, r.clientName].filter(Boolean).join(" · ")}
                            detail={`${r.pattern}\n${r.nextLabel}`}
                            meta={
                                r.attention > 0 ? (
                                    <Badge label={s.needsDecision(r.attention)} intent="danger" />
                                ) : r.ending ? (
                                    <Badge label={s.endingSoon} intent="warning" />
                                ) : (
                                    r.progress
                                )
                            }
                            onPress={() => {
                                setOpenId(r.id);
                            }}
                        />
                    ))}
                </View>
            )}
        </ScrollView>
    );
}

const SCOPES: { key: ChangeScope; label: string }[] = [
    { key: "one", label: s.scopeOne },
    { key: "following", label: s.scopeFollowing },
    { key: "all", label: s.scopeAll },
];

function Record({ id, onBack }: { id: string; onBack: () => void }) {
    const rec = useSeriesRecord(api, id);
    const [dialog, setDialog] = useState<"change" | "cancel" | null>(null);
    if (rec === null) return null;
    const r = rec.summary;
    const upcoming = rec.dates.filter((d) => !d.past);
    const past = rec.dates.filter((d) => d.past);
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
            <Button size="sm" variant="link" icon="chevronLeft" onPress={onBack}>
                {s.backToList}
            </Button>
            <Text style={styles.muted}>{r.serviceName}</Text>
            <Text style={styles.title}>
                {[r.petName, r.clientName].filter(Boolean).join(" · ")}
            </Text>
            <View style={styles.rowGap}>
                <Icon name="repeat" size={15} color={c.inkSoft} />
                <Text style={styles.soft}>{r.pattern}</Text>
            </View>
            {rec.canceled ? (
                <Notice tone="success" banner>
                    {s.canceledNote}
                </Notice>
            ) : null}
            {rec.saved !== null ? (
                <Notice tone="success" banner>
                    {rec.saved}
                </Notice>
            ) : null}
            {rec.error !== null && dialog === null ? (
                <Notice tone="danger">{rec.error}</Notice>
            ) : null}
            <View style={styles.card}>
                <Text style={styles.label}>{s.next}</Text>
                <Text style={styles.value}>{r.nextLabel}</Text>
                <Text style={styles.label}>{s.with}</Text>
                <Text style={styles.value}>{r.staffName}</Text>
                <Text style={styles.label}>{s.colProgress}</Text>
                <Text style={styles.value}>{r.progress}</Text>
                <Text style={styles.muted}>{r.endsLabel}</Text>
            </View>
            <View style={styles.actions}>
                <Button
                    grow
                    variant="outline"
                    disabled={rec.canceled || upcoming.length === 0}
                    onPress={() => {
                        setDialog("cancel");
                    }}
                >
                    {s.cancelSeries}
                </Button>
                <Button
                    grow
                    disabled={rec.canceled || upcoming.length === 0}
                    onPress={() => {
                        setDialog("change");
                    }}
                >
                    {s.changeSeries}
                </Button>
            </View>
            <Text style={styles.section}>{s.upcoming}</Text>
            <View style={styles.list}>
                {upcoming.length === 0 ? (
                    <Text style={styles.empty}>{s.noneLeft}</Text>
                ) : (
                    <OccurrenceList
                        label={s.upcoming}
                        rows={upcoming.map((o) => occurrenceRow(o))}
                    />
                )}
            </View>
            {past.length > 0 ? (
                <>
                    <Text style={styles.section}>{s.history}</Text>
                    <View style={styles.list}>
                        <OccurrenceList
                            label={s.history}
                            rows={past.map((o) => occurrenceRow(o))}
                        />
                    </View>
                </>
            ) : null}
            {dialog === "change" ? (
                <ChangeSheet
                    rec={rec}
                    onClose={() => {
                        setDialog(null);
                    }}
                />
            ) : null}
            {dialog === "cancel" ? (
                <Modal
                    onClose={() => {
                        setDialog(null);
                    }}
                >
                    <View style={styles.sheet}>
                        <Text style={styles.sheetTitle}>{s.cancelTitle}</Text>
                        <Text style={styles.soft}>{rec.cancelSummary}</Text>
                        <Toggle
                            label={s.notifyClient}
                            value={rec.cancelNotify}
                            onChange={rec.setCancelNotify}
                        />
                        <Button
                            full
                            variant="danger"
                            busy={rec.busy}
                            onPress={() => {
                                rec.cancelSeries();
                                setDialog(null);
                            }}
                        >
                            {s.confirmCancel}
                        </Button>
                        <Button
                            full
                            variant="quiet"
                            onPress={() => {
                                setDialog(null);
                            }}
                        >
                            {s.keepSeries}
                        </Button>
                    </View>
                </Modal>
            ) : null}
        </ScrollView>
    );
}

function ChangeSheet({ rec, onClose }: { rec: SeriesRecord; onClose: () => void }) {
    return (
        <Modal size="xl" onClose={onClose}>
            <ScrollView contentContainerStyle={styles.sheet}>
                <Text style={styles.sheetTitle}>{s.changeSeries}</Text>
                <Text style={styles.label}>{s.scope}</Text>
                <Choice
                    layout="segmented"
                    label={s.scope}
                    options={SCOPES}
                    value={rec.scope}
                    onChange={rec.setScope}
                />
                <Text style={styles.label}>{s.newDay}</Text>
                <Choice
                    label={s.newDay}
                    options={rec.weekdayOptions}
                    value={rec.weekday}
                    onChange={rec.setWeekday}
                />
                <Text style={styles.label}>{s.newTime}</Text>
                <Choice
                    label={s.newTime}
                    options={rec.timeOptions}
                    value={rec.time}
                    onChange={rec.setTime}
                />
                <Text style={styles.label}>{s.newWith}</Text>
                <Choice
                    label={s.newWith}
                    options={rec.staffOptions}
                    value={rec.staffId}
                    onChange={rec.setStaffId}
                />
                <Text style={styles.value}>{rec.changeSummary}</Text>
                {rec.changed ? (
                    <OccurrenceList
                        label={s.preview}
                        rows={rec.preview.map((o) => occurrenceRow(o))}
                    />
                ) : null}
            </ScrollView>
            <Button
                full
                busy={rec.busy}
                disabled={!rec.changed}
                onPress={() => {
                    rec.saveChange();
                    onClose();
                }}
            >
                {s.saveChange}
            </Button>
        </Modal>
    );
}

const FREQS: { key: SeriesFrequency; label: string }[] = [
    { key: "week", label: s.weekly },
    { key: "month", label: s.monthly },
];
const ENDS: { key: SeriesEnd; label: string }[] = [
    { key: "count", label: s.endCount },
    { key: "until", label: s.endUntil },
];

function SeriesComposer({ onDone }: { onDone: () => void }) {
    const f = useSeriesComposer(api, useViewer());
    if (f.done) {
        return (
            <View style={[styles.screen, styles.body]}>
                <Empty
                    variant="card"
                    icon="check"
                    message={s.doneTitle}
                    body={`${f.done.oneConfirmation ? s.doneBody(f.done.created, f.done.clientName) : s.doneBodyEach(f.done.created)}${
                        f.done.skipped > 0 ? ` ${s.doneSkipped(f.done.skipped)}` : ""
                    }`}
                    actions={
                        <>
                            <Button size="sm" variant="outline" onPress={f.reset}>
                                {s.bookAnother}
                            </Button>
                            <Button size="sm" onPress={onDone}>
                                {s.backToList}
                            </Button>
                        </>
                    }
                />
            </View>
        );
    }
    return (
        <View style={styles.screen}>
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                <Button size="sm" variant="link" icon="chevronLeft" onPress={onDone}>
                    {s.backToList}
                </Button>
                <Text style={styles.title}>{s.newTitle}</Text>
                <Text style={styles.muted}>{s.newSubtitle}</Text>
                <Text style={styles.label}>{s.client}</Text>
                <Choice
                    label={s.client}
                    options={f.clientOptions}
                    value={f.clientId}
                    onChange={f.setClientId}
                />
                {f.petName !== null ? <Text style={styles.muted}>{s.pet(f.petName)}</Text> : null}
                <Text style={styles.label}>{s.service}</Text>
                <Choice
                    label={s.service}
                    layout="cards"
                    options={f.serviceOptions}
                    value={f.itemId}
                    onChange={f.setItemId}
                />
                <Text style={styles.label}>{s.with}</Text>
                <Choice
                    label={s.with}
                    options={f.staffOptions}
                    value={f.staffId}
                    onChange={f.setStaffId}
                />
                <TextField
                    label={s.firstVisit}
                    type="date"
                    value={f.firstDay}
                    onChange={f.setFirstDay}
                />
                <Text style={styles.label}>{s.time}</Text>
                <Choice
                    label={s.time}
                    options={f.timeOptions}
                    value={f.time}
                    onChange={f.setTime}
                />
                <Text style={styles.label}>{s.repeats}</Text>
                <Choice
                    layout="segmented"
                    label={s.repeats}
                    options={FREQS}
                    value={f.frequency}
                    onChange={f.setFrequency}
                />
                <View style={styles.rowGap}>
                    <Text style={styles.soft}>{s.every}</Text>
                    <Stepper
                        label={s.every}
                        value={f.interval}
                        min={1}
                        max={12}
                        onChange={f.setInterval}
                    />
                    <Text style={styles.soft}>
                        {f.frequency === "week"
                            ? s.weeksUnit(f.interval)
                            : s.monthsUnit(f.interval)}
                    </Text>
                </View>
                <Text style={styles.label}>{s.ends}</Text>
                <Choice
                    layout="segmented"
                    label={s.ends}
                    options={ENDS}
                    value={f.end}
                    onChange={f.setEnd}
                />
                {f.end === "count" ? (
                    <View style={styles.rowGap}>
                        <Stepper
                            label={s.endCountSuffix}
                            value={f.count}
                            min={2}
                            max={60}
                            onChange={f.setCount}
                        />
                        <Text style={styles.soft}>{s.endCountSuffix}</Text>
                    </View>
                ) : (
                    <TextField
                        label={s.lastDate}
                        type="date"
                        value={f.until}
                        onChange={f.setUntil}
                    />
                )}
                <Text style={styles.muted}>{s.endNeeded}</Text>
                <Toggle
                    label={s.oneConfirmation}
                    hint={s.oneConfirmationHint}
                    value={f.oneConfirmation}
                    onChange={f.setOneConfirmation}
                />
                <Text style={styles.section}>{s.dates}</Text>
                {f.summary !== "" ? <Text style={styles.soft}>{f.summary}</Text> : null}
                {f.ready ? (
                    <View style={styles.list}>
                        <OccurrenceList
                            label={s.dates}
                            rows={f.occurrences.map(occurrenceRow)}
                            onAction={(key, action) => {
                                f.resolve(key, action === "shift" ? "shift" : "skip");
                            }}
                        />
                    </View>
                ) : (
                    <Text style={styles.muted}>{s.datesHint}</Text>
                )}
                {f.error !== null ? <Notice tone="danger">{f.error}</Notice> : null}
            </ScrollView>
            <View style={styles.foot}>
                <Text style={styles.value}>
                    {s.countsLine(f.counts.booked, f.counts.moved, f.counts.skipped)}
                </Text>
                {f.counts.open > 0 ? <Text style={styles.warn}>{s.resolveFirst}</Text> : null}
                <Button full busy={f.busy} disabled={!f.canSubmit} onPress={f.submit}>
                    {f.busy ? s.booking : s.book(f.counts.booked)}
                </Button>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    body: { padding: 16, paddingBottom: 32, gap: 12 },
    headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    title: { color: c.ink, fontSize: 20, fontWeight: "700" },
    muted: { color: c.muted, fontSize: 13 },
    soft: { color: c.inkSoft, fontSize: 14 },
    warn: { color: c.warnFg, fontSize: 12 },
    rowGap: { flexDirection: "row", alignItems: "center", gap: 10 },
    list: {
        backgroundColor: c.surface,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        overflow: "hidden",
        paddingHorizontal: 8,
    },
    card: {
        backgroundColor: c.surface,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        padding: 14,
        gap: 2,
    },
    label: { color: c.muted, fontSize: 12, fontWeight: "600", marginTop: 6 },
    value: { color: c.ink, fontSize: 15, fontWeight: "600" },
    section: {
        fontSize: 12,
        fontWeight: "700",
        color: c.muted,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginTop: 4,
    },
    empty: { padding: 16, fontSize: 14, color: c.muted, textAlign: "center" },
    actions: { flexDirection: "row", gap: 8 },
    sheet: { gap: 12, paddingBottom: 12 },
    sheetTitle: { color: c.ink, fontSize: 18, fontWeight: "700" },
    foot: {
        padding: 16,
        gap: 6,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: c.border,
        backgroundColor: c.surface,
    },
});
