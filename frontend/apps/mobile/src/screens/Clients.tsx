import {
    type ClientListRow,
    type ClientNote,
    type ClientSegment,
    type SubjectRow,
    canManagePayments,
    formatDate,
    formatMoney,
    formatRelativeTime,
    formatTime,
    formatWeekday,
    nextVisitLabel,
    petSummary,
    savedCardLabel,
    strings,
    useClientDirectory,
    useClientRecord,
    useClientSelection,
    useNoteActions,
    visitPill,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    ActionMenu,
    Avatar,
    Badge,
    Button,
    Checkbox,
    confirm,
    DetailSection,
    DetailView,
    Modal,
    KeyValueList,
    ListPage,
    ListRow,
    LoadFailed,
    Notice,
    Skeleton,
    StatusPill,
} from "@clientbridge/ui";
import { type RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
    ClientEditorSheet,
    MergeSheet,
    NoteSheet,
    PetSheet,
    TagSheet,
} from "../components/ClientSheets";
import { api } from "../lib/api";
import { useRole, useViewer } from "../lib/auth";
import { useOpenLink } from "../lib/links";
import type { RootStackParamList, TabParamList } from "../navigation";

const c = theme.colors;
const r = strings.clients.record;
const t = strings.clients.tidy;

type Sheet =
    | { kind: "client"; id: string | null }
    | { kind: "pet"; clientId: string; pet: SubjectRow | null }
    | { kind: "note"; clientId: string; pets: readonly SubjectRow[] }
    | { kind: "merge"; a: ClientListRow; b: ClientListRow }
    | { kind: "tags" };

export function ClientsScreen() {
    const dir = useClientDirectory();
    const manager = canManagePayments(useRole());
    const [openId, setOpenId] = useState<string | null>(null);
    const [sheet, setSheet] = useState<Sheet | null>(null);
    const [selecting, setSelecting] = useState(false);
    const [merged, setMerged] = useState<string | null>(null);
    const sel = useClientSelection(api, dir.all);
    const params = useRoute<RouteProp<TabParamList, "Clients">>().params;
    useEffect(() => {
        if (params?.create !== undefined) setSheet({ kind: "client", id: null });
    }, [params?.create]);
    useEffect(() => {
        if (params?.open !== undefined) setOpenId(params.open);
    }, [params?.open]);
    const n = sel.selected.length;
    const askArchive = (): void => {
        confirm({
            title: t.archiveTitle(n),
            message: t.archiveBody,
            confirmLabel: t.archiveConfirm,
            destructive: true,
        })
            .then((ok) => {
                if (ok) sel.archive();
            })
            .catch(() => undefined);
    };
    const notice = merged !== null ? t.merged(merged) : sel.done;

    return (
        <SafeAreaView style={styles.screen} edges={["top"]}>
            <ListPage<ClientListRow, ClientSegment>
                title={selecting && n > 0 ? t.selected(n) : strings.clients.title}
                summary={
                    dir.load.hasData && !selecting
                        ? strings.clients.edit.listSummary(dir.counts.active, dir.counts.archived)
                        : undefined
                }
                accessory={
                    <View style={styles.accessory}>
                        {dir.load.ready ? (
                            <Button
                                style={{ alignSelf: "center" }}
                                size="sm"
                                variant={selecting ? "outline" : "quiet"}
                                onPress={() => {
                                    setSelecting(!selecting);
                                    sel.clear();
                                }}
                            >
                                {selecting ? strings.common.done : t.select}
                            </Button>
                        ) : null}
                    </View>
                }
                action={
                    selecting
                        ? undefined
                        : {
                              label: strings.clients.addShort,
                              onPress: () => {
                                  setSheet({ kind: "client", id: null });
                              },
                          }
                }
                segments={
                    dir.load.ready && !selecting
                        ? {
                              items: [
                                  {
                                      key: "active",
                                      label: strings.clients.edit.segmentActive(dir.counts.active),
                                  },
                                  {
                                      key: "archived",
                                      label: strings.clients.edit.segmentArchived(
                                          dir.counts.archived,
                                      ),
                                  },
                              ],
                              active: dir.segment,
                              onSelect: dir.setSegment,
                          }
                        : undefined
                }
                search={
                    dir.load.ready
                        ? { value: dir.q, onChange: dir.setQ, placeholder: r.searchPlaceholder }
                        : undefined
                }
                banner={
                    notice !== null ? (
                        <Notice tone="success" banner>
                            {notice}
                        </Notice>
                    ) : undefined
                }
                state={
                    dir.load.state === "loading" || dir.load.state === "error"
                        ? dir.load.state
                        : undefined
                }
                onRetry={dir.load.retry}
                rows={dir.rows}
                rowKey={(cl) => cl.id}
                onRowPress={(cl) => {
                    setMerged(null);
                    if (selecting) sel.toggle(cl.id);
                    else setOpenId(cl.id);
                }}
                empty={
                    dir.load.state === "empty"
                        ? { icon: "clients", message: r.emptyTitle, body: r.emptyBody }
                        : dir.segment === "archived" && dir.q === ""
                          ? strings.clients.edit.emptyArchived
                          : strings.clients.emptySearch
                }
                renderRow={(cl) => (
                    <View style={styles.row}>
                        {selecting ? (
                            <Checkbox
                                label={cl.name}
                                hideLabel
                                value={sel.isSelected(cl.id)}
                                onChange={() => {
                                    sel.toggle(cl.id);
                                }}
                            />
                        ) : null}
                        <Avatar name={cl.name} />
                        <View style={styles.rowMain}>
                            <Text style={styles.rowName} numberOfLines={1}>
                                {cl.name}
                            </Text>
                            <Text style={styles.rowSub} numberOfLines={1}>
                                {selecting
                                    ? [cl.phoneLabel, cl.tags.join(", ")]
                                          .filter(Boolean)
                                          .join(" · ")
                                    : [cl.pets, cl.next === null ? null : nextVisitLabel(cl.next)]
                                          .filter(Boolean)
                                          .join(" · ") || cl.phoneLabel}
                            </Text>
                        </View>
                        {manager && !selecting && cl.balanceCents > 0 ? (
                            <Text style={styles.due}>{formatMoney(cl.balanceCents)}</Text>
                        ) : null}
                    </View>
                )}
            />
            {selecting && n > 0 ? (
                <View style={styles.bar}>
                    <Button
                        grow
                        variant="outline"
                        icon="tag"
                        onPress={() => {
                            setSheet({ kind: "tags" });
                        }}
                    >
                        {t.tag}
                    </Button>
                    {manager ? (
                        <>
                            <Button
                                grow
                                variant="outline"
                                icon="copy"
                                disabled={!sel.canMerge}
                                label={sel.canMerge ? t.mergeSelected : t.mergeNeedsTwo}
                                onPress={() => {
                                    const [a, b] = sel.selected.map((id) =>
                                        dir.all.find((x) => x.id === id),
                                    );
                                    if (a !== undefined && b !== undefined)
                                        setSheet({ kind: "merge", a, b });
                                }}
                            >
                                {t.mergeSelected}
                            </Button>
                            <Button
                                grow
                                variant="outline"
                                icon="box"
                                busy={sel.archiving}
                                onPress={askArchive}
                            >
                                {t.archive}
                            </Button>
                        </>
                    ) : null}
                </View>
            ) : null}
            {sel.error !== null ? (
                <View style={styles.error}>
                    <Notice tone="danger">{sel.error}</Notice>
                </View>
            ) : null}

            <Modal
                flow
                framed={false}
                size="xl"
                open={openId !== null || sheet !== null}
                onClose={() => {
                    if (sheet !== null) setSheet(null);
                    else setOpenId(null);
                }}
            >
                {openId !== null ? (
                    <RecordSheet
                        visible={sheet === null}
                        clientId={openId}
                        manager={manager}
                        onClose={() => {
                            setOpenId(null);
                        }}
                        onSheet={setSheet}
                    />
                ) : null}
                {sheet?.kind === "client" ? (
                    <ClientEditorSheet
                        key={sheet.id ?? "new"}
                        directory={dir.all}
                        clientId={sheet.id}
                        onOpen={(id) => {
                            setSheet(null);
                            setOpenId(id);
                        }}
                        onClose={() => {
                            setSheet(null);
                        }}
                    />
                ) : null}
                {sheet?.kind === "pet" ? (
                    <PetSheet
                        key={sheet.pet?.id ?? "new"}
                        clientId={sheet.clientId}
                        pet={sheet.pet}
                        onClose={() => {
                            setSheet(null);
                        }}
                    />
                ) : null}
                {sheet?.kind === "note" ? (
                    <NoteSheet
                        clientId={sheet.clientId}
                        pets={sheet.pets}
                        onClose={() => {
                            setSheet(null);
                        }}
                    />
                ) : null}
                {sheet?.kind === "merge" ? (
                    <MergeSheet
                        a={sheet.a}
                        b={sheet.b}
                        onClose={() => {
                            setSheet(null);
                        }}
                        onMerged={(name) => {
                            setSheet(null);
                            sel.clear();
                            setSelecting(false);
                            setMerged(name);
                        }}
                    />
                ) : null}
                {sheet?.kind === "tags" && n > 0 ? (
                    <TagSheet
                        sel={sel}
                        onClose={() => {
                            setSheet(null);
                        }}
                    />
                ) : null}
            </Modal>
        </SafeAreaView>
    );
}

function NoteLine({ note, manager }: { note: ClientNote; manager: boolean }) {
    const actions = useNoteActions(api);
    const [menu, setMenu] = useState(false);
    const can = manager || note.mine;
    return (
        <View style={styles.note}>
            <ListRow
                density="compact"
                title={note.body}
                detail={[
                    strings.clients.history.by(
                        note.author,
                        formatRelativeTime(note.at.toISOString()),
                    ),
                    note.pet,
                    note.pinned ? r.pinned : null,
                ]
                    .filter((x) => x !== null)
                    .join(" · ")}
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

function RecordSheet({
    visible,
    clientId,
    manager,
    onClose,
    onSheet,
}: {
    visible: boolean;
    clientId: string;
    manager: boolean;
    onClose: () => void;
    onSheet: (s: Sheet) => void;
}) {
    const viewer = useViewer();
    const { load, record } = useClientRecord(clientId, viewer?.staffId ?? null);
    const nav = useNavigation<Nav>();
    const open = useOpenLink();
    if (record === null) {
        return (
            <DetailView open={visible} title={strings.clients.title} onClose={onClose}>
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
    const push = (screen: "ClientHistory" | "ClientPets" | "ClientWallet"): void => {
        onClose();
        nav.navigate(screen, { clientId: cl.id, name: cl.name });
    };
    return (
        <DetailView
            open={visible}
            title={cl.name}
            subtitle={[cl.phoneLabel, record.pets.map((pet) => pet.name).join(", ")]
                .filter(Boolean)
                .join(" · ")}
            status={cl.archived ? { status: r.archived, intent: "warning" } : undefined}
            leading={<Avatar name={cl.name} size="lg" />}
            onClose={onClose}
            actions={
                <View style={styles.actions}>
                    <Button
                        grow
                        onPress={() => {
                            onClose();
                            open("booking");
                        }}
                    >
                        {r.book}
                    </Button>
                    <Button
                        grow
                        variant="outline"
                        onPress={() => {
                            onClose();
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
                                      { label: r.lifetime, value: formatMoney(cl.lifetimeCents) },
                                      {
                                          label: r.balance,
                                          value:
                                              cl.balanceCents > 0
                                                  ? formatMoney(cl.balanceCents)
                                                  : r.settled,
                                          intent:
                                              cl.balanceCents > 0
                                                  ? ("warning" as const)
                                                  : undefined,
                                      },
                                  ]
                                : []),
                            { label: r.visits, value: String(record.visits) },
                            { label: r.since, value: formatDate(cl.since) },
                        ]}
                    />
                </View>
            </View>
            <DetailSection
                title={r.pets}
                action={
                    <Button
                        size="sm"
                        variant="link"
                        onPress={() => {
                            onSheet({ kind: "pet", clientId: cl.id, pet: null });
                        }}
                    >
                        {r.addPet}
                    </Button>
                }
            >
                {record.pets.length === 0 ? <Text style={styles.muted}>{r.noPets}</Text> : null}
                {record.pets.map((pet) => (
                    <View key={pet.id} style={styles.rowCard}>
                        <ListRow
                            density="compact"
                            leading={<Avatar name={pet.name} size="sm" />}
                            title={pet.name}
                            detail={petSummary(pet)}
                            meta={
                                typeof pet.attributes.temperament === "string" ? (
                                    <Badge
                                        label={pet.attributes.temperament}
                                        intent={
                                            pet.attributes.temperament === "anxious" ||
                                            pet.attributes.temperament === "reactive"
                                                ? "warning"
                                                : "neutral"
                                        }
                                    />
                                ) : undefined
                            }
                            label={r.editPetNamed(pet.name)}
                            onPress={() => {
                                onSheet({ kind: "pet", clientId: cl.id, pet });
                            }}
                        />
                    </View>
                ))}
                {record.pets.length > 0 ? (
                    <Button
                        size="sm"
                        variant="link"
                        onPress={() => {
                            push("ClientPets");
                        }}
                    >
                        {strings.clients.pets.pets}
                    </Button>
                ) : null}
            </DetailSection>
            <DetailSection title={r.upcoming}>
                {record.upcoming.length === 0 ? (
                    <Text style={styles.muted}>{r.noUpcoming}</Text>
                ) : null}
                {record.upcoming.slice(0, 3).map((v) => {
                    const pill = visitPill(v, now);
                    return (
                        <View key={v.id} style={styles.card}>
                            <View
                                style={[styles.stripe, { backgroundColor: v.color ?? c.accent }]}
                            />
                            <View style={styles.rowMain}>
                                <Text style={styles.cardTitle} numberOfLines={1}>
                                    {v.service}
                                </Text>
                                <Text style={styles.rowSub}>
                                    {formatWeekday(v.start)} · {formatDate(v.start)} ·{" "}
                                    {formatTime(v.start)}
                                </Text>
                            </View>
                            {pill !== null ? (
                                <StatusPill
                                    style={{ alignSelf: "center" }}
                                    status={pill.label}
                                    intent={pill.intent}
                                    asWritten
                                />
                            ) : null}
                        </View>
                    );
                })}
                {record.lastVisit !== null ? (
                    <Text style={styles.muted}>
                        {r.lastVisit(formatDate(record.lastVisit.start))}
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
                            onSheet({ kind: "note", clientId: cl.id, pets: record.pets });
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
                    <View style={styles.lines}>
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
                    </View>
                </DetailSection>
            ) : null}
        </DetailView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    accessory: { flexDirection: "row", alignItems: "center", gap: 6 },
    row: { flexDirection: "row", alignItems: "center", gap: 12 },
    rowMain: { flex: 1, minWidth: 0 },
    rowName: { color: c.ink, fontSize: 16, fontWeight: "600" },
    rowSub: { color: c.muted, fontSize: 13, marginTop: 2 },
    due: { color: c.danFg, fontSize: 14, fontWeight: "600" },
    bar: {
        flexDirection: "row",
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: c.surface,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: c.border,
    },
    error: { paddingHorizontal: 16, paddingBottom: 8 },
    actions: { flexDirection: "row", gap: 8 },
    overview: { gap: 12 },
    tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    facts: {
        backgroundColor: c.bg,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        padding: 14,
        marginBottom: 6,
    },
    muted: { color: c.muted, fontSize: 13, marginTop: 4 },
    rowCard: {
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
        marginBottom: 8,
        overflow: "hidden",
    },
    card: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
        marginBottom: 8,
    },
    cardTitle: { color: c.ink, fontSize: 15, fontWeight: "600" },
    stripe: { width: 4, alignSelf: "stretch", borderRadius: 2 },
    note: {
        backgroundColor: c.warnBg,
        borderRadius: theme.radius,
        marginBottom: 8,
        overflow: "hidden",
    },
    lines: {
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
        paddingHorizontal: 12,
    },
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
    lineText: { color: c.ink, fontSize: 15 },
});
