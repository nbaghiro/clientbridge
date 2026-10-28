import { apiUrl as apiBaseUrl } from "../lib/config";
import {
    canManagePayments,
    formatMoney,
    printedEstimate,
    printedInvoice,
    strings,
    useEstimateActions,
    useEstimateRecord,
    useInvoiceActions,
    useInvoiceRecord,
    useLetterhead,
    formatParts,
    BUSINESS_CURRENCY,
    kindWord,
    useSubjectKind,
    openTask,
    replaceTask,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { useState } from "react";
import { Share, StyleSheet, Text, View } from "react-native";
import {
    ActionMenu,
    ActivityTimeline,
    Button,
    CopyField,
    DetailSection,
    DetailView,
    Modal,
    DocTotals,
    KeyValueList,
    ListRow,
    Money,
    Notice,
    confirm,
} from "@clientbridge/ui";

import { DocumentPreview } from "./DocumentPreview";
import { RecordPayment } from "./RecordPayment";
import { api } from "../lib/api";
import { useRole } from "../lib/auth";
import { payUrl } from "../lib/config";
import { useOpenLink } from "../lib/links";

const c = theme.colors;
const s = strings.billing;

const share = (url: string): void => {
    Share.share({ message: url }).catch(() => undefined);
};

type Overlay = "record" | "pdf" | "menu" | null;

/** An invoice over the current screen: its details, payments, actions and the printed copy. */
export function InvoicePanel({ id, onClose }: { id: string; onClose: () => void }) {
    const rec = useInvoiceRecord(id, payUrl);
    const act = useInvoiceActions(api);
    const letterhead = useLetterhead(apiBaseUrl);
    const [overlay, setOverlay] = useState<Overlay>(null);
    const openLink = useOpenLink();
    const canRefund = canManagePayments(useRole());
    if (rec === null) return null;
    const closeOverlay = (): void => {
        setOverlay(null);
    };

    const menu = [
        { key: "pdf", label: s.pdf, icon: "receipt" as const },
        ...(rec.canRemind ? [{ key: "remind", label: s.remind, icon: "bell" as const }] : []),
        ...(rec.canSend ? [{ key: "send", label: s.sendInvoice, icon: "send" as const }] : []),
        ...(rec.canEdit ? [{ key: "edit", label: s.edit, icon: "edit" as const }] : []),
        ...(rec.canVoid ? [{ key: "void", label: s.void, icon: "trash" as const }] : []),
    ];
    const pick = (key: string): void => {
        setOverlay(null);
        if (key === "pdf") setOverlay("pdf");
        else if (key === "remind") act.remind(rec);
        else if (key === "send") act.send(rec);
        else if (key === "edit") openTask({ kind: "doc", doc: "invoice", id: rec.row.id });
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
        <Modal
            flow
            framed={false}
            size="xl"
            onClose={() => {
                if (overlay !== null) closeOverlay();
                else onClose();
            }}
        >
            <DetailView
                open={overlay === null || overlay === "menu"}
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
                {rec.settling !== null ? (
                    <Notice tone="info" banner>
                        {rec.settling === "arriving" ? s.settling : s.settlingLate}
                    </Notice>
                ) : null}
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
                            <Money currency={BUSINESS_CURRENCY} cents={l.amountCents} />
                        </View>
                    ))}
                    <View style={styles.totals}>
                        <DocTotals
                            currency={BUSINESS_CURRENCY}
                            lines={rec.totals}
                            density="compact"
                        />
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
                                    currency={BUSINESS_CURRENCY}
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
            {overlay === "record" ? <RecordPayment rec={rec} onClose={closeOverlay} /> : null}
            {overlay === "pdf" ? (
                <DocumentPreview
                    shareUrl={rec.payUrl}
                    doc={printedInvoice(rec, letterhead, c.accent)}
                    onClose={closeOverlay}
                />
            ) : null}
        </Modal>
    );
}

/** An estimate over the current screen; converting it opens the new invoice in its place. */
export function EstimatePanel({ id, onClose }: { id: string; onClose: () => void }) {
    const rec = useEstimateRecord(id, payUrl);
    const act = useEstimateActions(api);
    const letterhead = useLetterhead(apiBaseUrl);
    const kind = useSubjectKind();
    const openLink = useOpenLink();
    const [overlay, setOverlay] = useState<"pdf" | "menu" | null>(null);
    if (rec === null) return null;
    const menu = [
        { key: "pdf", label: s.pdf, icon: "receipt" as const },
        ...(rec.canEdit ? [{ key: "edit", label: s.edit, icon: "edit" as const }] : []),
        ...(rec.canMark
            ? [
                  { key: "accept", label: s.markAccepted, icon: "check" as const },
                  { key: "decline", label: s.markDeclined, icon: "x" as const },
              ]
            : []),
        ...(rec.canBook
            ? [{ key: "book", label: s.bookVisit(kindWord(kind)), icon: "calendar" as const }]
            : []),
    ];
    const pick = (key: string): void => {
        setOverlay(null);
        if (key === "pdf") setOverlay("pdf");
        else if (key === "edit") openTask({ kind: "doc", doc: "estimate", id: rec.row.id });
        else if (key === "accept") act.accept(rec);
        else if (key === "decline") act.decline(rec);
        else if (key === "book") openTask({ kind: "booking", estimateId: rec.row.id });
    };
    const convert = (): void => {
        confirm({ title: s.convertTitle, message: s.convertBody, confirmLabel: s.convert })
            .then((ok) => {
                if (ok)
                    act.convert(rec, (invoiceId) => {
                        replaceTask({ kind: "record", type: "invoice", id: invoiceId });
                    });
            })
            .catch(() => undefined);
    };

    return (
        <Modal
            flow
            framed={false}
            size="xl"
            onClose={() => {
                if (overlay !== null) setOverlay(null);
                else onClose();
            }}
        >
            <DetailView
                open={overlay !== "pdf"}
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
                        {
                            label: s.total,
                            value: formatMoney(rec.row.total_cents, BUSINESS_CURRENCY),
                        },
                        { label: s.colValid, value: rec.validLabel },
                    ]}
                />
                {rec.booked !== null ? (
                    <DetailSection title={s.bookedVisit(kindWord(kind))}>
                        <ListRow
                            icon="calendar"
                            title={rec.booked.when}
                            detail={s.bookedVisitHint}
                            onPress={() => {
                                if (rec.booked !== null) openLink("booking", rec.booked.id);
                            }}
                        />
                        {rec.convertNote !== null ? (
                            <Notice tone="info">{rec.convertNote}</Notice>
                        ) : null}
                    </DetailSection>
                ) : null}
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
                                    {formatParts([rec.lineDetail(l), l.note])}
                                </Text>
                            </View>
                            <Money
                                currency={BUSINESS_CURRENCY}
                                cents={l.amountCents}
                                tone={l.optional && !l.selected ? "muted" : "ink"}
                            />
                        </View>
                    ))}
                    <View style={styles.totals}>
                        <DocTotals
                            currency={BUSINESS_CURRENCY}
                            lines={rec.totals}
                            density="compact"
                        />
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
            {overlay === "pdf" ? (
                <DocumentPreview
                    shareUrl={rec.acceptUrl}
                    doc={printedEstimate(rec, letterhead, c.accent)}
                    onClose={() => {
                        setOverlay(null);
                    }}
                />
            ) : null}
        </Modal>
    );
}

const styles = StyleSheet.create({
    rowMain: { flex: 1, minWidth: 0 },
    rowSub: { fontFamily: theme.fonts.ui, fontSize: 13, color: c.muted, marginTop: 2 },
    line: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: c.borderSoft,
    },
    lineName: { fontFamily: theme.fonts.ui, fontSize: 15, color: c.ink },
    muted: { color: c.muted },
    totals: { marginTop: 10, borderRadius: 10, backgroundColor: c.bg, padding: 12 },
});
