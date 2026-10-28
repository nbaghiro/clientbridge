import {
    type ClientListRow,
    type ClientSegment,
    canManagePayments,
    formatMoney,
    kindWord,
    nextVisitLabel,
    strings,
    useClientDirectory,
    useClientSelection,
    formatParts,
    formatList,
    BUSINESS_CURRENCY,
    useBusinessZone,
    usePeoplePhotos,
    useSubjectKind,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Avatar,
    Backdrop,
    Button,
    Checkbox,
    confirm,
    ListPage,
    Modal,
    Notice,
    useTabletLayout,
    Choice,
    PageHeader,
    SearchField,
} from "@clientbridge/ui";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { MergeSheet, TagSheet } from "../components/ClientSheets";
import { AskSheet, type RecordAsk, ClientRecordView } from "../components/ClientRecord";
import { api } from "../lib/api";
import { useRole } from "../lib/auth";

const c = theme.colors;
const r = strings.clients.record;
const t = strings.clients.tidy;

type Sheet = RecordAsk | { kind: "merge"; a: ClientListRow; b: ClientListRow } | { kind: "tags" };

export function ClientsScreen() {
    const photos = usePeoplePhotos();
    const zone = useBusinessZone();
    const kind = useSubjectKind();
    const dir = useClientDirectory();
    const manager = canManagePayments(useRole());
    const [openId, setOpenId] = useState<string | null>(null);
    const [sheet, setSheet] = useState<Sheet | null>(null);
    const [selecting, setSelecting] = useState(false);
    const [merged, setMerged] = useState<string | null>(null);
    const sel = useClientSelection(api, dir.all);
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
    const nothingYet = dir.load.state === "empty";
    const tablet = useTabletLayout();
    const closeRecord = (): void => {
        setOpenId(null);
    };

    const list = (
        <>
            <ListPage<ClientListRow, ClientSegment>
                title={
                    tablet ? undefined : selecting && n > 0 ? t.selected(n) : strings.clients.title
                }
                summary={
                    tablet
                        ? undefined
                        : dir.load.hasData && !selecting && !nothingYet
                          ? strings.clients.edit.listSummary(dir.counts.active, dir.counts.archived)
                          : undefined
                }
                accessory={
                    tablet ? undefined : (
                        <View style={styles.accessory}>
                            {dir.load.ready && !nothingYet ? (
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
                    )
                }
                action={
                    tablet
                        ? undefined
                        : selecting || nothingYet
                          ? undefined
                          : {
                                label: strings.clients.addShort,
                                onPress: () => {
                                    setSheet({ kind: "client", id: null });
                                },
                            }
                }
                segments={
                    tablet
                        ? undefined
                        : dir.load.ready && !selecting && !nothingYet
                          ? {
                                items: [
                                    {
                                        key: "active",
                                        label: strings.clients.edit.segmentActive(
                                            dir.counts.active,
                                        ),
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
                    tablet
                        ? undefined
                        : dir.load.ready && !nothingYet
                          ? {
                                value: dir.q,
                                onChange: dir.setQ,
                                placeholder: r.searchPlaceholder(kindWord(kind)),
                            }
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
                    nothingYet
                        ? {
                              icon: "clients",
                              message: r.emptyTitle,
                              body: r.emptyBody,
                              actions: (
                                  <Button
                                      size="sm"
                                      icon="plus"
                                      onPress={() => {
                                          setSheet({ kind: "client", id: null });
                                      }}
                                  >
                                      {strings.clients.add}
                                  </Button>
                              ),
                          }
                        : dir.segment === "archived" && dir.q === ""
                          ? strings.clients.edit.emptyArchived
                          : strings.clients.emptySearch
                }
                renderRow={(cl) =>
                    tablet && !selecting ? (
                        <View style={styles.tableRow}>
                            <View style={[styles.row, styles.colClient]}>
                                <Avatar name={cl.name} src={photos.client(cl.id)} />
                                <View style={styles.rowMain}>
                                    <Text style={styles.rowName} numberOfLines={1}>
                                        {cl.name}
                                    </Text>
                                    <Text style={styles.rowSub} numberOfLines={1}>
                                        {cl.phoneLabel || strings.clients.dash}
                                    </Text>
                                </View>
                            </View>
                            {kind !== null ? (
                                <Text style={[styles.cell, styles.colWide]} numberOfLines={1}>
                                    {cl.subjects}
                                </Text>
                            ) : null}
                            <Text style={[styles.cell, styles.colWide]} numberOfLines={1}>
                                {cl.next === null
                                    ? strings.clients.dash
                                    : nextVisitLabel(cl.next, zone)}
                            </Text>
                            {manager ? (
                                <Text style={[styles.cell, styles.colMoney]} numberOfLines={1}>
                                    {cl.balanceCents > 0
                                        ? formatMoney(cl.balanceCents, BUSINESS_CURRENCY)
                                        : strings.clients.dash}
                                </Text>
                            ) : null}
                        </View>
                    ) : (
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
                            <Avatar name={cl.name} src={photos.client(cl.id)} />
                            <View style={styles.rowMain}>
                                <Text style={styles.rowName} numberOfLines={1}>
                                    {cl.name}
                                </Text>
                                <Text style={styles.rowSub} numberOfLines={1}>
                                    {selecting
                                        ? formatParts([cl.phoneLabel, formatList(cl.tags, "unit")])
                                        : formatParts([
                                              kind === null ? null : cl.subjects,
                                              cl.next === null
                                                  ? null
                                                  : nextVisitLabel(cl.next, zone),
                                          ]) || cl.phoneLabel}
                                </Text>
                            </View>
                            {manager && !selecting && cl.balanceCents > 0 ? (
                                <Text style={styles.due}>
                                    {formatMoney(cl.balanceCents, BUSINESS_CURRENCY)}
                                </Text>
                            ) : null}
                        </View>
                    )
                }
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
        </>
    );

    return (
        <SafeAreaView style={styles.screen} edges={["top"]}>
            <Backdrop />
            {tablet ? (
                <>
                    <PageHeader
                        style={styles.tabletHead}
                        title={selecting && n > 0 ? t.selected(n) : strings.clients.title}
                        subtitle={
                            dir.load.hasData && !selecting && !nothingYet
                                ? strings.clients.edit.listSummary(
                                      dir.counts.active,
                                      dir.counts.archived,
                                  )
                                : undefined
                        }
                        actions={
                            dir.load.ready && !nothingYet ? (
                                <>
                                    <Button
                                        style={{ alignSelf: "center" }}
                                        size="sm"
                                        icon="check"
                                        variant={selecting ? "outline" : "quiet"}
                                        onPress={() => {
                                            setSelecting(!selecting);
                                            sel.clear();
                                        }}
                                    >
                                        {selecting ? strings.common.done : t.select}
                                    </Button>
                                    {selecting ? null : (
                                        <Button
                                            style={{ alignSelf: "center" }}
                                            size="sm"
                                            icon="plus"
                                            onPress={() => {
                                                setSheet({ kind: "client", id: null });
                                            }}
                                        >
                                            {strings.clients.add}
                                        </Button>
                                    )}
                                </>
                            ) : undefined
                        }
                    />
                    {dir.load.ready && !nothingYet ? (
                        <View style={styles.toolbar}>
                            <Choice
                                layout="segmented"
                                label={strings.clients.title}
                                value={dir.segment}
                                onChange={dir.setSegment}
                                options={[
                                    {
                                        key: "active",
                                        label: strings.clients.edit.segmentActive(
                                            dir.counts.active,
                                        ),
                                    },
                                    {
                                        key: "archived",
                                        label: strings.clients.edit.segmentArchived(
                                            dir.counts.archived,
                                        ),
                                    },
                                ]}
                            />
                            <SearchField
                                style={styles.search}
                                value={dir.q}
                                onChange={dir.setQ}
                                placeholder={r.searchPlaceholder(kindWord(kind))}
                            />
                        </View>
                    ) : null}
                    <View style={styles.tabletRow}>
                        <View style={styles.tableCard}>
                            {selecting ? null : (
                                <View style={styles.tableHead}>
                                    <Text style={[styles.headCell, styles.colClient]}>
                                        {r.colClient}
                                    </Text>
                                    {kind !== null ? (
                                        <Text style={[styles.headCell, styles.colWide]}>
                                            {strings.subjects.many(kind)}
                                        </Text>
                                    ) : null}
                                    <Text style={[styles.headCell, styles.colWide]}>
                                        {r.colNext}
                                    </Text>
                                    {manager ? (
                                        <Text style={[styles.headCell, styles.colMoney]}>
                                            {r.colBalance}
                                        </Text>
                                    ) : null}
                                </View>
                            )}
                            {list}
                        </View>
                        {openId !== null ? (
                            <View style={styles.recordCard}>
                                <ClientRecordView
                                    key={openId}
                                    inline
                                    visible
                                    clientId={openId}
                                    manager={manager}
                                    onClose={closeRecord}
                                    onSheet={setSheet}
                                />
                            </View>
                        ) : null}
                    </View>
                </>
            ) : (
                list
            )}

            <Modal
                flow
                framed={false}
                size="xl"
                open={sheet !== null || (!tablet && openId !== null)}
                onClose={() => {
                    if (sheet !== null) setSheet(null);
                    else setOpenId(null);
                }}
            >
                {openId !== null && !tablet ? (
                    <ClientRecordView
                        visible={sheet === null}
                        clientId={openId}
                        manager={manager}
                        onClose={closeRecord}
                        onSheet={setSheet}
                    />
                ) : null}
                <AskSheet
                    ask={
                        sheet?.kind === "client" ||
                        sheet?.kind === "subject" ||
                        sheet?.kind === "note"
                            ? sheet
                            : null
                    }
                    onOpen={(id) => {
                        setSheet(null);
                        setOpenId(id);
                    }}
                    onClose={() => {
                        setSheet(null);
                    }}
                />
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

const card = {
    backgroundColor: c.surface,
    borderRadius: theme.radius,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    overflow: "hidden",
} as const;

const styles = StyleSheet.create({
    // A tablet follows the web's Clients page: header and filters above a table, the record beside it.
    tabletHead: { paddingHorizontal: 20, paddingTop: 8 },
    toolbar: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    search: { width: 340 },
    tabletRow: { flex: 1, flexDirection: "row", gap: 16, paddingHorizontal: 16, paddingBottom: 16 },
    tableCard: { ...card, flex: 1, minWidth: 0 },
    recordCard: { ...card, width: theme.layout.side },
    tableHead: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: c.border,
    },
    headCell: {
        color: c.muted,
        fontFamily: theme.fonts.ui,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 0.5,
        textTransform: "uppercase",
    },
    tableRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    colClient: { flex: 2.2, minWidth: 0 },
    colWide: { flex: 1.2, minWidth: 0 },
    colMoney: { width: 96, textAlign: "right" },
    cell: { color: c.inkSoft, fontFamily: theme.fonts.ui, fontSize: 14 },
    screen: { flex: 1 },
    accessory: { flexDirection: "row", alignItems: "center", gap: 6 },
    row: { flexDirection: "row", alignItems: "center", gap: 12 },
    rowMain: { flex: 1, minWidth: 0 },
    rowName: { color: c.ink, fontFamily: theme.fonts.ui, fontSize: 16, fontWeight: "600" },
    rowSub: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 13, marginTop: 2 },
    due: { color: c.danFg, fontFamily: theme.fonts.ui, fontSize: 14, fontWeight: "600" },
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
});
