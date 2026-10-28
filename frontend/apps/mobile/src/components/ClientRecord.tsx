import {
    type ClientNote,
    type SubjectRow,
    canManagePayments,
    formatDate,
    formatMoney,
    formatRelativeTime,
    formatTime,
    formatWeekday,
    savedCardLabel,
    subjectSummary,
    subjectTemperament,
    strings,
    useClientDirectory,
    useClientRecord,
    useNoteActions,
    visitPill,
    formatParts,
    formatList,
    BUSINESS_CURRENCY,
    useBusinessZone,
    usePeoplePhotos,
    useSubjectKind,
    openTask,
    replaceTask,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    ActionMenu,
    Avatar,
    Badge,
    Button,
    confirm,
    DetailSection,
    DetailView,
    KeyValueList,
    ListRow,
    LoadFailed,
    Modal,
    Notice,
    Panel,
    Skeleton,
    StatusPill,
} from "@clientbridge/ui";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";

import { ClientEditorSheet, NoteSheet, SubjectSheet } from "./ClientSheets";
import { ClientFormsSection } from "./TreatmentNotes";
import { api } from "../lib/api";
import { useRole, useViewer } from "../lib/auth";
import { useOpenLink } from "../lib/links";
import type { RootStackParamList } from "../navigation";

const c = theme.colors;
const r = strings.clients.record;

// What a record asks the screen around it to open: the client's editor, a pet or a note.
export type RecordAsk =
    | { kind: "client"; id: string | null }
    | { kind: "subject"; clientId: string; subject: SubjectRow | null }
    | { kind: "note"; clientId: string; subjects: readonly SubjectRow[] };

function NoteLine({ note, manager }: { note: ClientNote; manager: boolean }) {
    const zone = useBusinessZone();
    const actions = useNoteActions(api);
    const [menu, setMenu] = useState(false);
    const can = manager || note.mine;
    return (
        <View style={styles.note}>
            <ListRow
                density="compact"
                title={note.body}
                detail={formatParts([
                    strings.clients.history.by(
                        note.author,
                        formatRelativeTime(note.at.toISOString(), zone),
                    ),
                    note.subjectName,
                    note.pinned ? r.pinned : null,
                ])}
                label={note.body}
                onPress={
                    can
                        ? () => {
                              setMenu(true);
                          }
                        : undefined
                }
            />
            {actions.error !== null ? <Notice tone="danger">{actions.error}</Notice> : null}
            <ActionMenu
                open={menu}
                onClose={() => {
                    setMenu(false);
                }}
                items={[
                    {
                        key: "pin",
                        label: note.pinned
                            ? strings.clients.history.unpin
                            : strings.clients.history.pinNote,
                        hint: strings.clients.history.pinHint,
                        icon: "pushpin",
                    },
                    { key: "delete", label: strings.clients.history.deleteNote, icon: "trash" },
                ]}
                onSelect={(k) => {
                    setMenu(false);
                    if (k === "pin") {
                        actions.togglePin(note);
                        return;
                    }
                    confirm({
                        title: strings.clients.history.deleteNoteTitle,
                        message: strings.clients.history.deleteNoteBody,
                        confirmLabel: strings.clients.history.deleteNote,
                        destructive: true,
                    })
                        .then((ok) => {
                            if (ok) actions.remove(note);
                        })
                        .catch(() => undefined);
                }}
            />
        </View>
    );
}

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function RecordSheet({
    inline = false,
    visible,
    clientId,
    manager,
    onClose,
    onSheet,
}: {
    inline?: boolean;
    visible: boolean;
    clientId: string;
    manager: boolean;
    onClose: () => void;
    onSheet: (s: RecordAsk) => void;
}) {
    const photos = usePeoplePhotos();
    const zone = useBusinessZone();
    const kind = useSubjectKind();
    const viewer = useViewer();
    const { load, record } = useClientRecord(api, clientId, viewer?.staffId ?? null);
    const nav = useNavigation<Nav>();
    const open = useOpenLink();
    const variant = inline ? "inline" : "drawer";
    // Beside the list the record stays open while another screen is pushed over it.
    const leave = inline ? () => undefined : onClose;
    if (record === null) {
        return (
            <DetailView
                open={visible}
                variant={variant}
                title={strings.clients.title}
                onClose={onClose}
            >
                {load.state === "error" ? (
                    <LoadFailed
                        message={r.loadError}
                        onRetry={load.retry}
                        retrying={load.retrying}
                    />
                ) : load.state === "empty" ? (
                    <Text style={styles.muted}>{r.goneBody}</Text>
                ) : (
                    <Skeleton variant="stat" count={4} columns={2} label={r.loadingRecord} />
                )}
            </DetailView>
        );
    }
    const cl = record.client;
    const now = new Date();
    const push = (screen: "ClientHistory" | "ClientWallet"): void => {
        leave();
        nav.navigate(screen, { clientId: cl.id, name: cl.name });
    };
    return (
        <DetailView
            open={visible}
            variant={variant}
            title={cl.name}
            subtitle={formatParts([
                cl.phoneLabel,
                formatList(
                    record.subjects.map((x) => x.name),
                    "unit",
                ),
            ])}
            status={cl.archived ? { status: r.archived, intent: "warning" } : undefined}
            leading={<Avatar name={cl.name} src={photos.client(cl.id)} size="lg" />}
            onClose={onClose}
            actions={
                <View style={styles.actions}>
                    <Button
                        grow
                        onPress={() => {
                            leave();
                            openTask({ kind: "booking", clientId: cl.id });
                        }}
                    >
                        {r.book}
                    </Button>
                    <Button
                        grow
                        variant="outline"
                        onPress={() => {
                            leave();
                            open("message", cl.id);
                        }}
                    >
                        {r.message}
                    </Button>
                    <Button
                        variant="outline"
                        onPress={() => {
                            onSheet({ kind: "client", id: cl.id });
                        }}
                    >
                        {r.editShort}
                    </Button>
                </View>
            }
        >
            <View style={styles.overview}>
                {cl.phone !== null ? (
                    <View style={styles.actions}>
                        <Button
                            grow
                            size="sm"
                            variant="quiet"
                            icon="phone"
                            onPress={() => {
                                Linking.openURL(`tel:${cl.phone ?? ""}`).catch(() => undefined);
                            }}
                        >
                            {r.call}
                        </Button>
                        <Button
                            grow
                            size="sm"
                            variant="quiet"
                            icon="message"
                            onPress={() => {
                                Linking.openURL(`sms:${cl.phone ?? ""}`).catch(() => undefined);
                            }}
                        >
                            {r.text}
                        </Button>
                        <Button
                            grow
                            size="sm"
                            variant="quiet"
                            icon="history"
                            onPress={() => {
                                push("ClientHistory");
                            }}
                        >
                            {r.history}
                        </Button>
                    </View>
                ) : null}
                {record.textsStopped !== null ? (
                    <Notice tone="info" banner>
                        {record.textsStopped}
                    </Notice>
                ) : null}
                {cl.tags.length > 0 ? (
                    <View style={styles.tags}>
                        {cl.tags.map((tag) => (
                            <Badge key={tag} label={tag} intent="accent" />
                        ))}
                    </View>
                ) : null}
                <View style={styles.facts}>
                    <KeyValueList
                        layout="stack"
                        rows={[
                            ...(manager
                                ? [
                                      {
                                          label: r.lifetime,
                                          value: formatMoney(cl.lifetimeCents, BUSINESS_CURRENCY),
                                      },
                                      {
                                          label: r.balance,
                                          value:
                                              cl.balanceCents > 0
                                                  ? formatMoney(cl.balanceCents, BUSINESS_CURRENCY)
                                                  : r.settled,
                                          intent:
                                              cl.balanceCents > 0
                                                  ? ("warning" as const)
                                                  : undefined,
                                      },
                                  ]
                                : []),
                            { label: r.visits, value: String(record.visits) },
                            { label: r.since, value: formatDate(cl.since, zone) },
                        ]}
                    />
                </View>
            </View>
            {kind !== null ? (
                <DetailSection
                    title={strings.subjects.many(kind)}
                    action={
                        <Button
                            size="sm"
                            variant="link"
                            onPress={() => {
                                onSheet({ kind: "subject", clientId: cl.id, subject: null });
                            }}
                        >
                            {strings.subjects.add(kind)}
                        </Button>
                    }
                >
                    {record.subjects.length === 0 ? (
                        <Text style={styles.muted}>{strings.subjects.none(kind)}</Text>
                    ) : null}
                    {record.subjects.map((subject) => {
                        const temperament = subjectTemperament(kind, subject.attributes);
                        return (
                            <Panel flush key={subject.id} style={styles.rowCard}>
                                <ListRow
                                    density="compact"
                                    leading={<Avatar name={subject.name} size="sm" />}
                                    title={subject.name}
                                    detail={subjectSummary(kind, subject.attributes, zone)}
                                    meta={
                                        temperament !== null ? (
                                            <Badge
                                                label={temperament.label}
                                                intent={temperament.nervous ? "warning" : "neutral"}
                                            />
                                        ) : undefined
                                    }
                                    label={strings.subjects.editNamed(subject.name)}
                                    onPress={() => {
                                        onSheet({ kind: "subject", clientId: cl.id, subject });
                                    }}
                                />
                            </Panel>
                        );
                    })}
                    {record.subjects.length > 0 ? (
                        <Button
                            size="sm"
                            variant="link"
                            onPress={() => {
                                leave();
                                nav.navigate("ClientSubjects", {
                                    clientId: cl.id,
                                    name: cl.name,
                                    kind,
                                });
                            }}
                        >
                            {strings.subjects.many(kind)}
                        </Button>
                    ) : null}
                </DetailSection>
            ) : null}
            <DetailSection title={r.upcoming}>
                {record.upcoming.length === 0 ? (
                    <Text style={styles.muted}>{r.noUpcoming}</Text>
                ) : null}
                {record.upcoming.slice(0, 3).map((v) => {
                    const pill = visitPill(v, now);
                    return (
                        <Panel key={v.id} style={styles.card}>
                            <View
                                style={[styles.stripe, { backgroundColor: v.color ?? c.accent }]}
                            />
                            <View style={styles.rowMain}>
                                <Text style={styles.cardTitle} numberOfLines={1}>
                                    {v.service}
                                </Text>
                                <Text style={styles.rowSub}>
                                    {formatParts([
                                        formatWeekday(v.start, zone),
                                        formatDate(v.start, zone),
                                        formatTime(v.start, zone),
                                    ])}
                                </Text>
                            </View>
                            {pill !== null ? (
                                <StatusPill
                                    style={{ alignSelf: "center" }}
                                    status={pill.label}
                                    intent={pill.intent}
                                />
                            ) : null}
                        </Panel>
                    );
                })}
                {record.lastVisitAt !== null ? (
                    <Text style={styles.muted}>
                        {r.lastVisit(formatDate(record.lastVisitAt, zone))}
                    </Text>
                ) : null}
            </DetailSection>
            <DetailSection
                title={r.notes}
                action={
                    <Button
                        size="sm"
                        variant="link"
                        onPress={() => {
                            onSheet({ kind: "note", clientId: cl.id, subjects: record.subjects });
                        }}
                    >
                        {r.addNote}
                    </Button>
                }
            >
                {record.notes.length === 0 ? <Text style={styles.muted}>{r.noNotes}</Text> : null}
                {record.notes.map((note) => (
                    <NoteLine key={note.id} note={note} manager={manager} />
                ))}
            </DetailSection>
            <ClientFormsSection key={cl.id} clientId={cl.id} manager={manager} />
            {manager ? (
                <DetailSection
                    title={r.wallet}
                    action={
                        <Button
                            size="sm"
                            variant="link"
                            onPress={() => {
                                push("ClientWallet");
                            }}
                        >
                            {r.manageWallet}
                        </Button>
                    }
                >
                    <Panel flush style={styles.lines}>
                        {record.methods.length === 0 ? (
                            <Text style={styles.lineMuted}>{r.noCards}</Text>
                        ) : null}
                        {record.methods.map((m) => (
                            <View key={m.id} style={styles.line}>
                                <Text style={styles.lineText}>{savedCardLabel(m)}</Text>
                                {m.preferred === 1 ? (
                                    <Badge
                                        style={{ alignSelf: "center" }}
                                        label={strings.clients.wallet.default}
                                        intent="accent"
                                    />
                                ) : null}
                            </View>
                        ))}
                        {record.plans.map((plan) => (
                            <View key={plan.id} style={styles.line}>
                                <Text style={styles.lineText}>{plan.name}</Text>
                                <Text style={styles.rowSub}>{plan.detail}</Text>
                            </View>
                        ))}
                    </Panel>
                </DetailSection>
            ) : null}
        </DetailView>
    );
}

/** A client's record over the current screen, with the editor, pet and note sheets it opens. */
export function ClientRecordTask({ clientId, onClose }: { clientId: string; onClose: () => void }) {
    const manager = canManagePayments(useRole());
    const [ask, setAsk] = useState<RecordAsk | null>(null);
    return (
        <Modal
            flow
            framed={false}
            size="xl"
            onClose={() => {
                if (ask !== null) setAsk(null);
                else onClose();
            }}
        >
            <RecordSheet
                visible={ask === null}
                clientId={clientId}
                manager={manager}
                onClose={onClose}
                onSheet={setAsk}
            />
            <AskSheet
                ask={ask}
                onOpen={(id) => {
                    setAsk(null);
                    replaceTask({ kind: "clientRecord", clientId: id });
                }}
                onClose={() => {
                    setAsk(null);
                }}
            />
        </Modal>
    );
}

/** A new client over the current screen; saving opens their record in its place. */
export function ClientEditorTask({ onClose }: { onClose: () => void }) {
    return (
        <Modal flow framed={false} size="xl" onClose={onClose}>
            <AskSheet
                ask={{ kind: "client", id: null }}
                onOpen={(id) => {
                    replaceTask({ kind: "clientRecord", clientId: id });
                }}
                onClose={onClose}
            />
        </Modal>
    );
}

/** The sheet a record asked for, shared by the Clients screen and the record task. */
export function AskSheet({
    ask,
    onOpen,
    onClose,
}: {
    ask: RecordAsk | null;
    onOpen: (id: string) => void;
    onClose: () => void;
}) {
    const directory = useClientDirectory();
    if (ask?.kind === "client")
        return (
            <ClientEditorSheet
                key={ask.id ?? "new"}
                directory={directory.all}
                clientId={ask.id}
                onOpen={onOpen}
                onClose={onClose}
            />
        );
    if (ask?.kind === "subject")
        return (
            <SubjectSheet
                key={ask.subject?.id ?? "new"}
                clientId={ask.clientId}
                subject={ask.subject}
                onClose={onClose}
            />
        );
    if (ask?.kind === "note")
        return <NoteSheet clientId={ask.clientId} subjects={ask.subjects} onClose={onClose} />;
    return null;
}

const styles = StyleSheet.create({
    rowMain: { flex: 1, minWidth: 0 },
    rowSub: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 13, marginTop: 2 },
    actions: { flexDirection: "row", gap: 8 },
    overview: { gap: 12 },
    tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    facts: {
        backgroundColor: c.bg,
        borderRadius: theme.radius,
        borderWidth: theme.borderWidth,
        borderColor: c.border,
        padding: 14,
        marginBottom: 6,
    },
    muted: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 13, marginTop: 4 },
    rowCard: { marginBottom: 8 },
    card: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
    cardTitle: { color: c.ink, fontFamily: theme.fonts.ui, fontSize: 15, fontWeight: "600" },
    stripe: { width: 4, alignSelf: "stretch", borderRadius: 2 },
    note: {
        backgroundColor: c.warnBg,
        borderRadius: theme.radius,
        marginBottom: 8,
        overflow: "hidden",
    },
    lines: { paddingHorizontal: 12 },
    line: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 8,
        paddingVertical: 11,
        borderBottomColor: c.borderSoft,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    lineMuted: { color: c.muted, paddingVertical: 11 },
    lineText: { color: c.ink, fontFamily: theme.fonts.ui, fontSize: 15 },
});
