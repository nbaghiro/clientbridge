import {
    type ClassRoster,
    strings,
    useClassBoard,
    formatParts,
    kindWord,
    useSubjectKind,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Avatar,
    Button,
    Choice,
    Empty,
    Icon,
    ListRow,
    LoadFailed,
    Meter,
    Modal,
    Notice,
    SearchField,
    Skeleton,
    Tabs,
    TextField,
} from "@clientbridge/ui";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { ProgramBoard } from "../components/ProgramBoard";
import { ProgramForm } from "../components/ProgramForm";
import { RosterAttendee } from "../components/RosterAttendee";
import { api } from "../lib/api";
import { useOpenLink } from "../lib/links";

const c = theme.colors;
const s = strings.classes;

type ClassView = "sessions" | "programs";

/** Upcoming class sessions with their seats, and the selected session's roster at the door. */
export function ClassesScreen() {
    const board = useClassBoard(api);
    const openLink = useOpenLink();
    const roster = board.roster;
    const [messaging, setMessaging] = useState(false);
    const [body, setBody] = useState("");
    const [sent, setSent] = useState<string | null>(null);
    const [view, setView] = useState<ClassView>("sessions");
    const [scheduling, setScheduling] = useState(false);
    const [scheduled, setScheduled] = useState<string | null>(null);
    return (
        <ScrollView
            style={styles.screen}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
        >
            <Text style={styles.subtitle}>{s.subtitle}</Text>
            <Tabs
                variant="pill"
                inset={false}
                label={s.title}
                items={[
                    { key: "sessions", label: s.sessionsTab },
                    { key: "programs", label: strings.programs.tab },
                ]}
                active={view}
                onSelect={setView}
            />
            {scheduling ? (
                <ProgramForm
                    onClose={() => {
                        setScheduling(false);
                    }}
                    onDone={(name) => {
                        setScheduling(false);
                        setScheduled(strings.programs.created(name));
                    }}
                />
            ) : null}
            {sent !== null ? <Notice tone="success">{sent}</Notice> : null}
            {view === "programs" ? (
                <ProgramBoard
                    notice={scheduled}
                    onSchedule={() => {
                        setScheduled(null);
                        setScheduling(true);
                    }}
                />
            ) : board.load.state === "loading" ? (
                <Skeleton variant="row" count={4} label={s.loading} />
            ) : board.load.state === "error" ? (
                <LoadFailed
                    message={s.loadError}
                    onRetry={board.load.retry}
                    retrying={board.load.retrying}
                />
            ) : board.sessions.length === 0 ? (
                <Empty
                    variant="card"
                    icon="users"
                    message={s.emptyClasses}
                    body={s.emptyClassesBody}
                    actions={
                        <Button
                            size="sm"
                            onPress={() => {
                                openLink("catalog");
                            }}
                        >
                            {strings.pos.desk.addCatalog}
                        </Button>
                    }
                />
            ) : (
                <>
                    <Choice
                        layout="cards"
                        label={s.upcoming}
                        options={board.sessions.map((x) => ({
                            key: x.slotId,
                            label: formatParts([x.day, x.name]),
                            hint: formatParts([x.time, x.seatsLabel]),
                        }))}
                        value={board.selected}
                        onChange={board.select}
                    />
                    {roster !== null ? (
                        <>
                            <Button
                                size="sm"
                                variant="outline"
                                icon="message"
                                onPress={() => {
                                    setSent(null);
                                    setMessaging(true);
                                }}
                            >
                                {s.messageClass}
                            </Button>
                            <RosterBody roster={roster} />
                        </>
                    ) : null}
                </>
            )}
            {messaging && roster !== null ? (
                <Modal
                    onClose={() => {
                        setMessaging(false);
                    }}
                >
                    <View style={styles.sheet}>
                        <Text style={styles.sheetTitle}>
                            {s.messageClassTitle(roster.session.name, roster.session.when)}
                        </Text>
                        <Text style={styles.muted}>
                            {s.messageClassHint(roster.session.booked)}
                        </Text>
                        <TextField
                            label={s.messageClassLabel}
                            multiline
                            rows={4}
                            value={body}
                            onChange={setBody}
                            placeholder={s.messageClassPlaceholder}
                        />
                        {board.messageError !== null ? (
                            <Notice tone="danger">{board.messageError}</Notice>
                        ) : null}
                        <Button
                            full
                            busy={board.messaging}
                            disabled={body.trim() === ""}
                            onPress={() => {
                                board.messageClass(body, (n) => {
                                    setBody("");
                                    setSent(s.messageSent(n));
                                    setMessaging(false);
                                });
                            }}
                        >
                            {s.messageClassSend}
                        </Button>
                        <Button
                            full
                            variant="quiet"
                            onPress={() => {
                                setMessaging(false);
                            }}
                        >
                            {s.messageClassCancel}
                        </Button>
                    </View>
                </Modal>
            ) : null}
        </ScrollView>
    );
}

function RosterBody({ roster }: { roster: ClassRoster }) {
    const kind = useSubjectKind();
    const x = roster.session;
    return (
        <View style={styles.gap}>
            <View style={styles.card}>
                <View style={styles.headRow}>
                    <Icon name="users" size={24} color={c.inkSoft} />
                    <View style={styles.flex}>
                        <Text style={styles.className}>{x.name}</Text>
                        <Text style={styles.muted}>{s.with(x.when, x.staffName)}</Text>
                    </View>
                </View>
                <View style={styles.meterBig}>
                    <Meter
                        units
                        labelPosition="below"
                        value={x.booked}
                        max={x.capacity}
                        overflow={x.waitlist}
                        intent={x.full ? "warning" : "accent"}
                        label={formatParts([
                            s.seatsBooked(x.booked, x.capacity),
                            s.checkedIn(x.checkedIn, x.booked),
                        ])}
                    />
                </View>
            </View>
            {roster.programNote !== null ? (
                <Text style={styles.muted}>{roster.programNote}</Text>
            ) : (
                <SearchField
                    value={roster.query}
                    onChange={roster.setQuery}
                    placeholder={s.addPlaceholder(kindWord(kind))}
                />
            )}
            {roster.matches.length > 0 ? (
                <View style={styles.list}>
                    {roster.matches.map((m) => (
                        <ListRow
                            key={m.key}
                            title={m.title}
                            leading={<Avatar name={m.avatar} size="sm" />}
                            meta={x.full ? s.waitlist : s.add}
                            onPress={() => {
                                roster.add(m.key);
                            }}
                        />
                    ))}
                </View>
            ) : null}
            {roster.notice !== null ? (
                <Notice tone="info" banner>
                    {roster.notice}
                </Notice>
            ) : null}
            {roster.error !== null ? <Notice tone="danger">{roster.error}</Notice> : null}

            <View style={styles.sectionRow}>
                <Text style={styles.section}>{s.roster}</Text>
                {roster.started ? (
                    <Button
                        style={{ alignSelf: "center" }}
                        size="sm"
                        variant="link"
                        busy={roster.busy}
                        onPress={roster.checkInAll}
                    >
                        {s.checkInAll}
                    </Button>
                ) : null}
            </View>
            {!roster.started ? <Text style={styles.muted}>{s.startsLater}</Text> : null}
            <View style={styles.list}>
                {roster.attendees.length === 0 ? (
                    <Text style={styles.empty}>{s.emptyRoster}</Text>
                ) : null}
                {roster.attendees.map((a, i) => (
                    <RosterAttendee
                        key={a.key}
                        a={a}
                        started={roster.started}
                        actions={roster}
                        first={i === 0}
                    />
                ))}
            </View>

            {roster.programNote !== null ? null : (
                <>
                    <Text style={styles.section}>{s.waitlist}</Text>
                    <View style={styles.list}>
                        {roster.waitlist.length === 0 ? (
                            <Text style={styles.empty}>{s.emptyWaitlist}</Text>
                        ) : null}
                        {roster.waitlist.map((w, i) => (
                            <View key={w.key} style={[styles.row, i > 0 && styles.divider]}>
                                <Text style={styles.pos}>{i + 1}</Text>
                                <Avatar name={w.subjectName} size="sm" />
                                <View style={styles.flex}>
                                    <Text style={styles.subject}>{w.subjectName}</Text>
                                    <Text style={styles.muted}>{w.clientName}</Text>
                                </View>
                                <Button
                                    style={{ alignSelf: "center" }}
                                    size="sm"
                                    variant="outline"
                                    onPress={() => {
                                        roster.promote(w.key);
                                    }}
                                >
                                    {s.promote}
                                </Button>
                            </View>
                        ))}
                    </View>
                </>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    body: { padding: 16, paddingBottom: 32, gap: 12 },
    subtitle: { color: c.muted, fontSize: 13 },
    gap: { gap: 12 },
    card: {
        backgroundColor: c.surface,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        padding: 14,
        gap: 12,
    },
    headRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    flex: { flex: 1, minWidth: 0 },
    className: { color: c.ink, fontSize: 17, fontWeight: "700" },
    muted: { color: c.muted, fontSize: 13 },
    meterBig: {},
    list: {
        backgroundColor: c.surface,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        overflow: "hidden",
    },
    sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    section: {
        fontSize: 12,
        fontWeight: "700",
        color: c.muted,
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
    empty: { padding: 16, fontSize: 14, color: c.muted, textAlign: "center" },
    row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    pos: { width: 16, textAlign: "right", color: c.muted, fontSize: 12 },
    subject: { color: c.ink, fontSize: 15, fontWeight: "600" },
    badges: { flexDirection: "row", gap: 6, marginTop: 4 },
    actions: { flexDirection: "row", alignItems: "center", gap: 6 },
    sheet: { gap: 12 },
    sheetTitle: { color: c.ink, fontSize: 18, fontWeight: "700" },
});
