import { apiUrl as apiBaseUrl } from "../lib/config";
import {
    canManagePayments,
    type EstimateRecord,
    type EstimateSegment,
    type InvoiceRecord,
    type InvoiceSegment,
    docDraft,
    formatMoney,
    printedEstimate,
    printedInvoice,
    printedReceipt,
    strings,
    useEstimateActions,
    useEstimateDesk,
    useEstimateRecord,
    useEstimates,
    useInvoiceActions,
    useInvoiceDesk,
    useInvoiceRecord,
    useInvoices,
    useLetterhead,
    useLines,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { useEffect, useState } from "react";
import { Share, StyleSheet, Text, View } from "react-native";
import {
    ActionMenu,
    ActivityTimeline,
    Avatar,
    Button,
    CopyField,
    DetailSection,
    DetailView,
    DocTotals,
    KeyValueList,
    ListPage,
    Money,
    Notice,
    Stat,
    StatusPill,
    Tabs,
    confirm,
} from "@clientbridge/ui";

import { DocEditor } from "../components/DocEditor";
import { DocumentPreview } from "../components/DocumentPreview";
import { InteracRequest } from "../components/InteracRequest";
import { RecordPayment } from "../components/RecordPayment";
import { api } from "../lib/api";
import { useRole } from "../lib/auth";
import { payUrl } from "../lib/config";
import { useOpenLink } from "../lib/links";

const c = theme.colors;
const s = strings.billing;

type DocKind = "invoices" | "estimates";
type Composing = { kind: "invoice" | "estimate"; id: string | null } | null;

const share = (url: string): void => {
    Share.share({ message: url }).catch(() => undefined);
};

export function Invoices({
    createToken,
    openId: openParam,
}: {
    createToken?: number | undefined;
    openId?: string | undefined;
}) {
    const [doc, setDoc] = useState<DocKind>("invoices");
    const [composing, setComposing] = useState<Composing>(null);
    const [openId, setOpenId] = useState<string | null>(openParam ?? null);
    useEffect(() => {
        if (createToken !== undefined) setComposing({ kind: "invoice", id: null });
    }, [createToken]);
    useEffect(() => {
        if (openParam !== undefined) setOpenId(openParam);
    }, [openParam]);

    return (
        <View style={styles.screen}>
            <Tabs<DocKind>
                variant="pill"
                label={s.invoices}
                items={[
                    { key: "invoices", label: s.invoices },
                    { key: "estimates", label: s.estimates },
                ]}
                active={doc}
                onSelect={(k) => {
                    setDoc(k);
                    setOpenId(null);
                }}
            />
            {doc === "invoices" ? (
                <InvoiceDeskView
                    openId={openId}
                    setOpenId={setOpenId}
                    compose={(id) => {
                        setComposing({ kind: "invoice", id });
                    }}
                />
            ) : (
                <EstimateDeskView
                    openId={openId}
                    setOpenId={setOpenId}
                    compose={(id) => {
                        setComposing({ kind: "estimate", id });
                    }}
                    openInvoice={(id) => {
                        setDoc("invoices");
                        setOpenId(id);
                    }}
                />
            )}
            {composing !== null ? (
                <Composer
                    composing={composing}
                    onClose={() => {
                        setComposing(null);
                    }}
                />
            ) : null}
        </View>
    );
}

function Composer({
    composing,
    onClose,
}: {
    composing: NonNullable<Composing>;
    onClose: () => void;
}) {
    const invoices = useInvoices();
    const estimates = useEstimates();
    const lines = useLines(composing.id ?? "");
    if (composing.id === null) return <DocEditor kind={composing.kind} onClose={onClose} />;
    const row =
        composing.kind === "invoice"
            ? invoices.find((r) => r.id === composing.id)
            : estimates.find((r) => r.id === composing.id);
    if (row === undefined) return null;
    return <DocEditor kind={composing.kind} draft={docDraft(row, lines)} onClose={onClose} />;
}

function InvoiceDeskView({
    openId,
    setOpenId,
    compose,
}: {
    openId: string | null;
    setOpenId: (id: string | null) => void;
    compose: (id: string | null) => void;
}) {
    const desk = useInvoiceDesk();
    const ready = desk.load.state === "ready";
    return (
        <View style={styles.screen}>
            <ListPage<(typeof desk.rows)[number], InvoiceSegment>
                summary={desk.summary}
                action={{
                    label: s.newInvoice,
                    onPress: () => {
                        compose(null);
                    },
                }}
                segments={{ items: desk.segments, active: desk.segment, onSelect: desk.setSegment }}
                search={{ value: desk.q, onChange: desk.setQ, placeholder: s.search }}
                banner={
                    desk.nothingYet || desk.load.state === "error" ? undefined : (
                        <View style={styles.stats}>
                            <View style={styles.stat}>
                                <Stat
                                    label={s.statOutstanding}
                                    cents={ready ? desk.stats.outstandingCents : null}
                                    hint={
                                        ready
                                            ? s.statOutstandingHint(desk.stats.outstandingCount)
                                            : undefined
                                    }
                                />
                            </View>
                            <View style={styles.stat}>
                                <Stat
                                    label={s.statOverdue}
                                    cents={ready ? desk.stats.overdueCents : null}
                                    tone={desk.stats.overdueCents > 0 ? "danger" : "ink"}
                                    hint={
                                        ready
                                            ? s.statOverdueHint(desk.stats.overdueCount)
                                            : undefined
                                    }
                                />
                            </View>
                        </View>
                    )
                }
                rows={desk.rows}
                rowKey={(r) => r.row.id}
                onRowPress={(r) => {
                    setOpenId(r.row.id);
                }}
                state={
                    desk.load.state === "loading"
                        ? "loading"
                        : desk.load.state === "error"
                          ? "error"
                          : undefined
                }
                onRetry={desk.load.retry}
                empty={
                    desk.nothingYet
                        ? {
                              message: s.emptyInvoicesTitle,
                              body: s.emptyInvoicesBody,
                              icon: "invoices",
                              variant: "card",
                              actions: (
                                  <Button
                                      icon="plus"
                                      onPress={() => {
                                          compose(null);
                                      }}
                                  >
                                      {s.newInvoice}
                                  </Button>
                              ),
                          }
                        : desk.emptyMessage
                }
                renderRow={(r) => (
                    <View style={styles.row}>
                        <Avatar name={r.row.client_name ?? ""} size="sm" />
                        <View style={styles.rowMain}>
                            <Text style={styles.rowName} numberOfLines={1}>
                                {r.row.client_name}
                            </Text>
                            <Text style={[styles.rowSub, r.late && styles.late]} numberOfLines={1}>
                                {[r.number, r.dueLabel].filter(Boolean).join(" · ")}
                            </Text>
                        </View>
                        <View style={styles.rowRight}>
                            <Money
                                cents={
                                    (r.row.balance_cents ?? 0) > 0
                                        ? r.row.balance_cents
                                        : r.row.total_cents
                                }
                                strong
                                tone={r.late ? "danger" : "ink"}
                            />
                            <StatusPill status={r.statusLabel} intent={r.intent} asWritten />
                        </View>
                    </View>
                )}
            />
            {openId !== null ? (
                <InvoicePanel
                    id={openId}
                    onClose={() => {
                        setOpenId(null);
                    }}
                    onEdit={compose}
                />
            ) : null}
        </View>
    );
}

type Overlay = "record" | "pdf" | "menu" | "interac" | null;

function InvoicePanel({
    id,
    onClose,
    onEdit,
}: {
    id: string;
    onClose: () => void;
    onEdit: (id: string) => void;
}) {
    const rec = useInvoiceRecord(api, id, payUrl);
    const act = useInvoiceActions(api);
    const letterhead = useLetterhead(apiBaseUrl);
    const estimates = useEstimates();
    const estimateId = estimates.find((e) => e.converted_invoice_id === id)?.id ?? null;
    const estimate = useEstimateRecord(api, estimateId, payUrl);
    const [overlay, setOverlay] = useState<Overlay>(null);
    const openLink = useOpenLink();
    const canRefund = canManagePayments(useRole());
    if (rec === null) return null;
    const closeOverlay = (): void => {
        setOverlay(null);
    };

    if (overlay === "record") return <RecordPayment rec={rec} onClose={closeOverlay} />;
    if (overlay === "interac") return <InteracRequest invoice={rec.row} onClose={closeOverlay} />;
    if (overlay === "pdf")
        return (
            <DocumentPreview
                initial="invoice"
                shareUrl={rec.payUrl}
                docs={previewDocs(rec, estimate, letterhead)}
                onClose={closeOverlay}
            />
        );

    const menu = [
        { key: "pdf", label: s.pdf, icon: "receipt" as const },
        ...(rec.canRecord
            ? [{ key: "interac", label: strings.payments.interac.open, icon: "send" as const }]
            : []),
        ...(rec.canRemind ? [{ key: "remind", label: s.remind, icon: "bell" as const }] : []),
        ...(rec.canSend ? [{ key: "send", label: s.sendInvoice, icon: "send" as const }] : []),
        ...(rec.canEdit ? [{ key: "edit", label: s.edit, icon: "edit" as const }] : []),
        ...(rec.canVoid ? [{ key: "void", label: s.void, icon: "trash" as const }] : []),
    ];
    const pick = (key: string): void => {
        setOverlay(null);
        if (key === "pdf") setOverlay("pdf");
        else if (key === "interac") setOverlay("interac");
        else if (key === "remind") act.remind(rec);
        else if (key === "send") act.send(rec);
        else if (key === "edit") onEdit(rec.row.id);
        else if (key === "void")
            confirm({
                title:
                    rec.row.number === null
                        ? s.voidDraftConfirmTitle
                        : s.voidConfirmTitle(rec.row.number),
                message: s.voidConfirmBody,
                confirmLabel: s.void,
                destructive: true,
            })
                .then((ok) => {
                    if (ok) act.voidIt(rec);
                })
                .catch(() => undefined);
    };

    return (
        <>
            <DetailView
                open
                title={rec.title}
                subtitle={rec.row.client_name ?? undefined}
                status={{ status: rec.statusLabel, intent: rec.intent }}
                onClose={onClose}
                actions={
                    <>
                        <Button
                            variant="outline"
                            icon="more"
                            onPress={() => {
                                setOverlay("menu");
                            }}
                        >
                            {strings.navigation.more}
                        </Button>
                        {rec.canRecord ? (
                            <Button
                                grow
                                icon="dollar"
                                onPress={() => {
                                    setOverlay("record");
                                }}
                            >
                                {s.recordPayment}
                            </Button>
                        ) : rec.canSend ? (
                            <Button
                                grow
                                icon="send"
                                busy={act.busy}
                                onPress={() => {
                                    act.send(rec);
                                }}
                            >
                                {s.sendInvoice}
                            </Button>
                        ) : null}
                    </>
                }
            >
                {act.notice !== null ? (
                    <Notice tone="success" banner>
                        {act.notice}
                    </Notice>
                ) : null}
                {act.error !== null ? (
                    <Notice tone="danger" banner>
                        {act.error}
                    </Notice>
                ) : null}
                <KeyValueList layout="stack" columns={3} rows={rec.facts} />
                <DetailSection title={s.lines}>
                    {rec.lines.map((l) => (
                        <View key={l.id} style={styles.line}>
                            <View style={styles.rowMain}>
                                <Text style={styles.lineName}>{l.description}</Text>
                                <Text style={styles.rowSub}>{rec.lineDetail(l)}</Text>
                            </View>
                            <Money cents={l.amountCents} />
                        </View>
                    ))}
                    <View style={styles.totals}>
                        <DocTotals lines={rec.totals} density="compact" />
                    </View>
                </DetailSection>
                {rec.payUrl !== null ? (
                    <DetailSection title={s.payLink}>
                        <CopyField
                            label={s.payLink}
                            value={rec.payUrl}
                            copyLabel={s.doc.share}
                            onCopy={() => {
                                if (rec.payUrl !== null) share(rec.payUrl);
                            }}
                        />
                    </DetailSection>
                ) : null}
                {rec.payments.length > 0 ? (
                    <DetailSection title={s.payments}>
                        {rec.payments.map((p) => (
                            <View key={p.id} style={styles.line}>
                                <View style={styles.rowMain}>
                                    <Text style={styles.lineName}>{p.label}</Text>
                                    <Text style={styles.rowSub}>{p.detail}</Text>
                                </View>
                                <Money
                                    cents={p.refund ? -p.amountCents : p.amountCents}
                                    tone={p.refund ? "danger" : "ink"}
                                />
                                {canRefund && !p.refund && !p.pending ? (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onPress={() => {
                                            openLink("refunds", p.id);
                                        }}
                                    >
                                        {s.refund}
                                    </Button>
                                ) : null}
                            </View>
                        ))}
                    </DetailSection>
                ) : null}
                <DetailSection title={s.history}>
                    <ActivityTimeline entries={rec.timeline} />
                </DetailSection>
            </DetailView>
            <ActionMenu
                open={overlay === "menu"}
                onClose={closeOverlay}
                title={rec.title}
                items={menu}
                onSelect={pick}
            />
        </>
    );
}

function previewDocs(
    rec: InvoiceRecord,
    estimate: EstimateRecord | null,
    letterhead: ReturnType<typeof useLetterhead>,
): {
    kind: "invoice" | "estimate" | "receipt";
    doc: ReturnType<typeof printedReceipt>;
    missing: string;
}[] {
    const paid = rec.payments.find((x) => !x.refund && !x.pending);
    return [
        { kind: "invoice", doc: printedInvoice(rec, letterhead, c.accent), missing: "" },
        {
            kind: "estimate",
            doc: estimate === null ? null : printedEstimate(estimate, letterhead, c.accent),
            missing: s.doc.noEstimate,
        },
        {
            kind: "receipt",
            doc: paid === undefined ? null : printedReceipt(rec, paid.id, letterhead, c.accent),
            missing: s.doc.noReceipt,
        },
    ];
}

function EstimateDeskView({
    openId,
    setOpenId,
    compose,
    openInvoice,
}: {
    openId: string | null;
    setOpenId: (id: string | null) => void;
    compose: (id: string | null) => void;
    openInvoice: (id: string) => void;
}) {
    const desk = useEstimateDesk();
    return (
        <View style={styles.screen}>
            <ListPage<(typeof desk.rows)[number], EstimateSegment>
                summary={desk.summary}
                action={{
                    label: s.newEstimate,
                    onPress: () => {
                        compose(null);
                    },
                }}
                segments={{ items: desk.segments, active: desk.segment, onSelect: desk.setSegment }}
                search={{ value: desk.q, onChange: desk.setQ, placeholder: s.search }}
                rows={desk.rows}
                rowKey={(r) => r.row.id}
                onRowPress={(r) => {
                    setOpenId(r.row.id);
                }}
                state={
                    desk.load.state === "loading"
                        ? "loading"
                        : desk.load.state === "error"
                          ? "error"
                          : undefined
                }
                onRetry={desk.load.retry}
                empty={
                    desk.nothingYet
                        ? {
                              message: s.emptyEstimatesTitle,
                              body: s.emptyEstimatesBody,
                              icon: "receipt",
                              variant: "card",
                              actions: (
                                  <Button
                                      icon="plus"
                                      onPress={() => {
                                          compose(null);
                                      }}
                                  >
                                      {s.newEstimate}
                                  </Button>
                              ),
                          }
                        : desk.emptyMessage
                }
                renderRow={(r) => (
                    <View style={styles.row}>
                        <Avatar name={r.row.client_name ?? ""} size="sm" />
                        <View style={styles.rowMain}>
                            <Text style={styles.rowName} numberOfLines={1}>
                                {r.row.client_name}
                            </Text>
                            <Text style={styles.rowSub} numberOfLines={1}>
                                {[r.number, r.validLabel].filter(Boolean).join(" · ")}
                            </Text>
                        </View>
                        <View style={styles.rowRight}>
                            <Money cents={r.row.total_cents} strong />
                            <StatusPill status={r.statusLabel} intent={r.intent} asWritten />
                        </View>
                    </View>
                )}
            />
            {openId !== null ? (
                <EstimatePanel
                    id={openId}
                    onClose={() => {
                        setOpenId(null);
                    }}
                    onEdit={compose}
                    openInvoice={openInvoice}
                />
            ) : null}
        </View>
    );
}

function EstimatePanel({
    id,
    onClose,
    onEdit,
    openInvoice,
}: {
    id: string;
    onClose: () => void;
    onEdit: (id: string) => void;
    openInvoice: (id: string) => void;
}) {
    const rec = useEstimateRecord(api, id, payUrl);
    const act = useEstimateActions(api);
    const letterhead = useLetterhead(apiBaseUrl);
    const [overlay, setOverlay] = useState<"pdf" | "menu" | null>(null);
    if (rec === null) return null;
    if (overlay === "pdf")
        return (
            <DocumentPreview
                initial="estimate"
                shareUrl={rec.acceptUrl}
                docs={[
                    {
                        kind: "estimate",
                        doc: printedEstimate(rec, letterhead, c.accent),
                        missing: "",
                    },
                ]}
                onClose={() => {
                    setOverlay(null);
                }}
            />
        );
    const menu = [
        { key: "pdf", label: s.pdf, icon: "receipt" as const },
        ...(rec.canEdit ? [{ key: "edit", label: s.edit, icon: "edit" as const }] : []),
        ...(rec.canMark
            ? [
                  { key: "accept", label: s.markAccepted, icon: "check" as const },
                  { key: "decline", label: s.markDeclined, icon: "x" as const },
              ]
            : []),
    ];
    const pick = (key: string): void => {
        setOverlay(null);
        if (key === "pdf") setOverlay("pdf");
        else if (key === "edit") onEdit(rec.row.id);
        else if (key === "accept") act.accept(rec);
        else if (key === "decline") act.decline(rec);
    };
    const convert = (): void => {
        confirm({ title: s.convertTitle, message: s.convertBody, confirmLabel: s.convert })
            .then((ok) => {
                if (ok) act.convert(rec, openInvoice);
            })
            .catch(() => undefined);
    };

    return (
        <>
            <DetailView
                open
                title={rec.title}
                subtitle={rec.row.client_name ?? undefined}
                status={{ status: rec.statusLabel, intent: rec.intent }}
                onClose={onClose}
                actions={
                    <>
                        <Button
                            variant="outline"
                            icon="more"
                            onPress={() => {
                                setOverlay("menu");
                            }}
                        >
                            {strings.navigation.more}
                        </Button>
                        {rec.canSend ? (
                            <Button
                                grow
                                icon="send"
                                busy={act.busy}
                                onPress={() => {
                                    act.send(rec);
                                }}
                            >
                                {s.sendEstimate}
                            </Button>
                        ) : rec.canConvert ? (
                            <Button grow busy={act.busy} onPress={convert}>
                                {s.convert}
                            </Button>
                        ) : null}
                    </>
                }
            >
                {act.notice !== null ? (
                    <Notice tone="success" banner>
                        {act.notice}
                    </Notice>
                ) : null}
                {act.error !== null ? (
                    <Notice tone="danger" banner>
                        {act.error}
                    </Notice>
                ) : null}
                <KeyValueList
                    layout="stack"
                    columns={2}
                    rows={[
                        { label: s.total, value: formatMoney(rec.row.total_cents) },
                        { label: s.colValid, value: rec.validLabel },
                    ]}
                />
                {rec.row.decline_reason !== null ? (
                    <DetailSection title={s.declineReason}>
                        <Text style={styles.rowSub}>{rec.row.decline_reason}</Text>
                    </DetailSection>
                ) : null}
                <DetailSection title={s.lines}>
                    {rec.lines.map((l) => (
                        <View key={l.id} style={styles.line}>
                            <View style={styles.rowMain}>
                                <Text
                                    style={[
                                        styles.lineName,
                                        l.optional && !l.selected && styles.muted,
                                    ]}
                                >
                                    {l.description}
                                </Text>
                                <Text style={styles.rowSub}>
                                    {[rec.lineDetail(l), l.note].filter(Boolean).join(" · ")}
                                </Text>
                            </View>
                            <Money
                                cents={l.amountCents}
                                tone={l.optional && !l.selected ? "muted" : "ink"}
                            />
                        </View>
                    ))}
                    <View style={styles.totals}>
                        <DocTotals lines={rec.totals} density="compact" />
                    </View>
                </DetailSection>
                {rec.acceptUrl !== null ? (
                    <DetailSection title={s.acceptLink}>
                        <CopyField
                            label={s.acceptLink}
                            value={rec.acceptUrl}
                            copyLabel={s.doc.share}
                            onCopy={() => {
                                if (rec.acceptUrl !== null) share(rec.acceptUrl);
                            }}
                        />
                    </DetailSection>
                ) : null}
                <DetailSection title={s.history}>
                    <ActivityTimeline entries={rec.timeline} />
                </DetailSection>
            </DetailView>
            <ActionMenu
                open={overlay === "menu"}
                onClose={() => {
                    setOverlay(null);
                }}
                title={rec.title}
                items={menu}
                onSelect={pick}
            />
        </>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    stats: { flexDirection: "row", gap: 10 },
    stat: { flex: 1 },
    row: { flexDirection: "row", alignItems: "center", gap: 12 },
    rowMain: { flex: 1, minWidth: 0 },
    rowName: { fontSize: 16, fontWeight: "600", color: c.ink },
    rowSub: { fontSize: 13, color: c.muted, marginTop: 2 },
    late: { color: c.danFg },
    rowRight: { alignItems: "flex-end", gap: 4 },
    line: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: c.borderSoft,
    },
    lineName: { fontSize: 15, color: c.ink },
    muted: { color: c.muted },
    totals: { marginTop: 10, borderRadius: 10, backgroundColor: c.bg, padding: 12 },
});
