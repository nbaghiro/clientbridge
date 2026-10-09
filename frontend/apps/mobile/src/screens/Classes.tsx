import { type ClassRoster, type RosterEntry, strings, useClassBoard } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Avatar,
    Badge,
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
    StatusPill,
    TextField,
} from "@clientbridge/ui";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";

const c = theme.colors;
const s = strings.classes;

/** Upcoming class sessions with their seats, and the selected session's roster at the door. */
export function ClassesScreen() {
    const board = useClassBoard(api);
    const roster = board.roster;
    const [messaging, setMessaging] = useState(false);
    const [body, setBody] = useState("");
    const [sent, setSent] = useState<string | null>(null);
    return (
        <ScrollView
            style={styles.screen}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
        >
            <Text style={styles.subtitle}>{s.subtitle}</Text>
            {sent !== null ? <Notice tone="success">{sent}</Notice> : null}
            {board.load.state === "loading" ? (
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
                />
            ) : (
                <>
                    <Choice
                        layout="cards"
                        label={s.upcoming}
                        options={board.sessions.map((x) => ({
                            key: x.slotId,
                            label: `${x.day} · ${x.name}`,
                            hint: `${x.time} · ${x.seatsLabel}`,
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
    const x = roster.session;
    return (
        <View style={styles.gap}>
            <View style={styles.card}>
                <View style={styles.headRow}>
                    <Icon name="users" size={24} color={c.inkSoft} />
                    <View style={styles.flex}>
                        <Text style={styles.className}>{x.name}</Text>
                        <Text
                            style={styles.muted}
                        >{`${x.when} · ${s.with(x.staffName, x.roomName)}`}</Text>
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
                        label={`${s.seatsBooked(x.booked, x.capacity)} · ${s.checkedIn(x.checkedIn, x.booked)}`}
                    />
                </View>
            </View>
            <SearchField
                value={roster.query}
                onChange={roster.setQuery}
                placeholder={s.addPlaceholder}
            />
            {roster.matches.length > 0 ? (
                <View style={styles.list}>
                    {roster.matches.map((m) => (
                        <ListRow
                            key={m.clientId}
                            title={m.pet === "" ? m.name : `${m.pet} · ${m.name}`}
                            leading={<Avatar name={m.pet === "" ? m.name : m.pet} size="sm" />}
                            meta={x.full ? s.waitlist : s.add}
                            onPress={() => {
                                roster.add(m.clientId);
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
                    <Attendee key={a.key} a={a} roster={roster} first={i === 0} />
                ))}
            </View>

            <Text style={styles.section}>{s.waitlist}</Text>
            <View style={styles.list}>
                {roster.waitlist.length === 0 ? (
                    <Text style={styles.empty}>{s.emptyWaitlist}</Text>
                ) : null}
                {roster.waitlist.map((w, i) => (
                    <View key={w.key} style={[styles.row, i > 0 && styles.divider]}>
                        <Text style={styles.pos}>{i + 1}</Text>
                        <Avatar name={w.petName} size="sm" />
                        <View style={styles.flex}>
                            <Text style={styles.pet}>{w.petName}</Text>
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
        </View>
    );
}

function Attendee({ a, roster, first }: { a: RosterEntry; roster: ClassRoster; first: boolean }) {
    return (
        <View style={[styles.row, !first && styles.divider]}>
            <Avatar name={a.petName} size="sm" />
            <View style={styles.flex}>
                <Text style={styles.pet} numberOfLines={1}>
                    {a.petName}
                    {a.petName !== a.clientName ? (
                        <Text style={styles.muted}>{` · ${a.clientName}`}</Text>
                    ) : null}
                </Text>
                <View style={styles.badges}>
                    {a.note !== null ? <Badge label={a.note} intent="warning" /> : null}
                    {a.paid ? null : <Badge label={s.unpaid} intent="danger" />}
                </View>
            </View>
            {a.status === "confirmed" && roster.started ? (
                <View style={styles.actions}>
                    <Button
                        style={{ alignSelf: "center" }}
                        size="sm"
                        variant="quiet"
                        onPress={() => {
                            roster.noShow(a.key);
                        }}
                    >
                        {s.noShow}
                    </Button>
                    <Button
                        style={{ alignSelf: "center" }}
                        size="sm"
                        onPress={() => {
                            roster.checkIn(a.key);
                        }}
                    >
                        {s.checkIn}
                    </Button>
                </View>
            ) : (
                <View style={styles.actions}>
                    <StatusPill
                        style={{ alignSelf: "center" }}
                        status={a.statusLabel}
                        intent={a.intent}
                        asWritten
                    />
                    {a.status === "checked_in" || a.status === "no_show" ? (
                        <Button
                            style={{ alignSelf: "center" }}
                            size="sm"
                            variant="link"
                            onPress={() => {
                                roster.undo(a.key);
                            }}
                        >
                            {s.undo}
                        </Button>
                    ) : null}
                </View>
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
    pet: { color: c.ink, fontSize: 15, fontWeight: "600" },
    badges: { flexDirection: "row", gap: 6, marginTop: 4 },
    actions: { flexDirection: "row", alignItems: "center", gap: 6 },
    sheet: { gap: 12 },
    sheetTitle: { color: c.ink, fontSize: 18, fontWeight: "700" },
});
