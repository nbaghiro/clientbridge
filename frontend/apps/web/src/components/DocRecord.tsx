import {
    type InvoiceRecord,
    type PaymentRow,
    canManagePayments,
    formatMoney,
    printedEstimate,
    printedInvoice,
    strings,
    useEstimateActions,
    useEstimateRecord,
    useInvoiceActions,
    useInvoicePayments,
    useInvoiceRecord,
    useLetterhead,
    formatParts,
    BUSINESS_CURRENCY,
    kindWord,
    useSubjectKind,
    openTask,
    replaceTask,
} from "@clientbridge/app-core";
import {
    ActivityTimeline,
    Badge,
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
import { cssVar } from "@clientbridge/tokens";
import { useState } from "react";

import { DocumentPane, DocumentPreview } from "./DocumentPreview";
import { RecordPayment } from "./RecordPayment";
import { config } from "../config";
import { api, apiBaseUrl } from "../lib/api";
import { useRole } from "../lib/auth";
import { useOpenLink } from "../lib/links";

const s = strings.billing;

/** An invoice over the current page: its details, payments, actions and the printed copy. */
export function InvoicePanel({ id, onClose }: { id: string; onClose: () => void }) {
    const rec = useInvoiceRecord(id, config.payUrl);
    const act = useInvoiceActions(api);
    const role = useRole();
    const letterhead = useLetterhead(apiBaseUrl);
    const [recording, setRecording] = useState(false);
    const [previewing, setPreviewing] = useState(false);
    if (rec === null) return null;
    const sentAt =
        rec.row.issued_at === null
            ? s.doc.notSentYet
            : s.doc.attachedInvoice(rec.facts[1]?.value ?? "");

    const voidIt = (): void => {
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
            variant="drawer"
            framed={false}
            size="xl"
            onClose={() => {
                if (recording) setRecording(false);
                else if (previewing) setPreviewing(false);
                else onClose();
            }}
        >
            <div className="@container h-full">
                <div className="grid h-full min-h-0 grid-cols-1 bg-surface @4xl:grid-cols-[26rem_minmax(0,1fr)]">
                    <DetailView
                        variant="inline"
                        open
                        className="@4xl:border-r @4xl:border-line"
                        title={rec.title}
                        subtitle={rec.row.client_name ?? undefined}
                        status={{ status: rec.statusLabel, intent: rec.intent }}
                        onClose={onClose}
                        actions={
                            <>
                                <span className="@4xl:hidden">
                                    <Button
                                        variant="outline"
                                        icon="receipt"
                                        onPress={() => {
                                            setPreviewing(true);
                                        }}
                                    >
                                        {s.pdf}
                                    </Button>
                                </span>
                                {rec.canEdit ? (
                                    <Button
                                        variant="outline"
                                        icon="edit"
                                        onPress={() => {
                                            openTask({
                                                kind: "doc",
                                                doc: "invoice",
                                                id: rec.row.id,
                                            });
                                        }}
                                    >
                                        {s.edit}
                                    </Button>
                                ) : null}
                                {rec.canVoid ? (
                                    <Button variant="quiet" busy={act.busy} onPress={voidIt}>
                                        {s.void}
                                    </Button>
                                ) : null}
                                {rec.canRemind ? (
                                    <Button
                                        variant="outline"
                                        icon="bell"
                                        busy={act.busy}
                                        onPress={() => {
                                            act.remind(rec);
                                        }}
                                    >
                                        {s.remind}
                                    </Button>
                                ) : null}
                                {rec.canSend ? (
                                    <Button
                                        icon="send"
                                        busy={act.busy}
                                        onPress={() => {
                                            act.send(rec);
                                        }}
                                    >
                                        {s.sendInvoice}
                                    </Button>
                                ) : null}
                                {rec.canRecord ? (
                                    <Button
                                        icon="dollar"
                                        onPress={() => {
                                            setRecording(true);
                                        }}
                                    >
                                        {s.recordPayment}
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
                        <KeyValueList layout="stack" columns={2} rows={rec.facts} />
                        <div className="@4xl:hidden">
                            <DetailSection title={s.lines}>
                                <div className="divide-y divide-line-soft rounded-lg border border-line">
                                    {rec.lines.map((l) => (
                                        <div
                                            key={l.id}
                                            className="flex items-start justify-between gap-4 px-4 py-3"
                                        >
                                            <div className="min-w-0">
                                                <p className="text-sm text-ink">{l.description}</p>
                                                <p className="text-xs text-muted">
                                                    {rec.lineDetail(l)}
                                                </p>
                                            </div>
                                            <Money
                                                currency={BUSINESS_CURRENCY}
                                                cents={l.amountCents}
                                            />
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-3 rounded-lg bg-bg px-4 py-3">
                                    <DocTotals currency={BUSINESS_CURRENCY} lines={rec.totals} />
                                </div>
                            </DetailSection>
                        </div>
                        {rec.payUrl !== null ? (
                            <DetailSection title={s.payLink}>
                                <CopyField
                                    label={s.payLink}
                                    value={rec.payUrl}
                                    copyLabel={s.copyLink}
                                    copiedLabel={s.copied}
                                />
                            </DetailSection>
                        ) : null}
                        <PaymentsSection
                            invoiceId={rec.row.id}
                            rec={rec}
                            canRefund={canManagePayments(role)}
                        />
                        {rec.row.notes !== null ? (
                            <DetailSection title={s.notes}>
                                <p className="whitespace-pre-line text-sm text-ink-soft">
                                    {rec.row.notes}
                                </p>
                            </DetailSection>
                        ) : null}
                        <DetailSection title={s.history}>
                            <ActivityTimeline entries={rec.timeline} />
                        </DetailSection>
                    </DetailView>
                    <div className="min-h-0 @max-4xl:hidden">
                        <DocumentPane
                            businessName={letterhead.name}
                            doc={printedInvoice(rec, letterhead, cssVar("accent"))}
                            attached={sentAt}
                        />
                    </div>
                </div>
            </div>
            {recording ? (
                <RecordPayment
                    rec={rec}
                    onClose={() => {
                        setRecording(false);
                    }}
                />
            ) : null}
            {previewing ? (
                <DocumentPreview
                    businessName={letterhead.name}
                    doc={printedInvoice(rec, letterhead, cssVar("accent"))}
                    attached={sentAt}
                    onClose={() => {
                        setPreviewing(false);
                    }}
                />
            ) : null}
        </Modal>
    );
}

function PaymentsSection({
    invoiceId,
    rec,
    canRefund,
}: {
    invoiceId: string;
    rec: InvoiceRecord;
    canRefund: boolean;
}) {
    const all = useInvoicePayments(invoiceId);
    if (rec.payments.length === 0) return null;
    return (
        <DetailSection title={s.payments}>
            <div className="divide-y divide-line-soft rounded-lg border border-line">
                {rec.payments.map((p) => (
                    <PaymentLine key={p.id} view={p} all={all} canRefund={canRefund} />
                ))}
            </div>
        </DetailSection>
    );
}

function PaymentLine({
    view,
    all,
    canRefund,
}: {
    view: InvoiceRecord["payments"][number];
    all: PaymentRow[];
    canRefund: boolean;
}) {
    const openLink = useOpenLink();
    const row = all.find((p) => p.id === view.payment.id);
    const refundable = canRefund && !view.refund && row?.status === "succeeded";
    return (
        <div className="px-4 py-3 text-sm">
            <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{view.label}</p>
                    <p className="truncate text-xs text-muted">{view.detail}</p>
                </div>
                {view.refund ? <Badge label={s.refundBadge} intent="neutral" /> : null}
                <span className={`tabular-nums ${view.refund ? "text-danger" : "text-ink"}`}>
                    {view.refund ? "−" : ""}
                    {formatMoney(view.amountCents, BUSINESS_CURRENCY)}
                </span>
                {refundable ? (
                    <Button
                        variant="outline"
                        size="sm"
                        onPress={() => {
                            openLink("refunds", view.payment.id);
                        }}
                    >
                        {s.refund}
                    </Button>
                ) : null}
            </div>
        </div>
    );
}

/** An estimate over the current page; converting it opens the new invoice in its place. */
export function EstimatePanel({ id, onClose }: { id: string; onClose: () => void }) {
    const rec = useEstimateRecord(id, config.payUrl);
    const act = useEstimateActions(api);
    const kind = useSubjectKind();
    const openLink = useOpenLink();
    const letterhead = useLetterhead(apiBaseUrl);
    const [previewing, setPreviewing] = useState(false);
    if (rec === null) return null;

    const estimateDoc = printedEstimate(rec, letterhead, cssVar("accent"));
    const estimateSent =
        rec.row.number === null ? s.doc.notSentYet : s.doc.attachedEstimate(rec.validLabel);
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
            variant="drawer"
            framed={false}
            size="xl"
            onClose={() => {
                if (previewing) setPreviewing(false);
                else onClose();
            }}
        >
            <div className="@container h-full">
                <div className="grid h-full min-h-0 grid-cols-1 bg-surface @4xl:grid-cols-[26rem_minmax(0,1fr)]">
                    <DetailView
                        variant="inline"
                        open
                        className="@4xl:border-r @4xl:border-line"
                        title={rec.title}
                        subtitle={rec.row.client_name ?? undefined}
                        status={{ status: rec.statusLabel, intent: rec.intent }}
                        onClose={onClose}
                        actions={
                            <>
                                <span className="@4xl:hidden">
                                    <Button
                                        variant="outline"
                                        icon="receipt"
                                        onPress={() => {
                                            setPreviewing(true);
                                        }}
                                    >
                                        {s.pdf}
                                    </Button>
                                </span>
                                {rec.canEdit ? (
                                    <Button
                                        variant="outline"
                                        icon="edit"
                                        onPress={() => {
                                            openTask({
                                                kind: "doc",
                                                doc: "estimate",
                                                id: rec.row.id,
                                            });
                                        }}
                                    >
                                        {s.edit}
                                    </Button>
                                ) : null}
                                {rec.canMark ? (
                                    <>
                                        <Button
                                            variant="quiet"
                                            busy={act.busy}
                                            onPress={() => {
                                                act.decline(rec);
                                            }}
                                        >
                                            {s.markDeclined}
                                        </Button>
                                        <Button
                                            variant="outline"
                                            busy={act.busy}
                                            onPress={() => {
                                                act.accept(rec);
                                            }}
                                        >
                                            {s.markAccepted}
                                        </Button>
                                    </>
                                ) : null}
                                {rec.canSend ? (
                                    <Button
                                        icon="send"
                                        busy={act.busy}
                                        onPress={() => {
                                            act.send(rec);
                                        }}
                                    >
                                        {s.sendEstimate}
                                    </Button>
                                ) : null}
                                {rec.canBook ? (
                                    <Button
                                        variant="outline"
                                        icon="calendar"
                                        onPress={() => {
                                            openTask({ kind: "booking", estimateId: rec.row.id });
                                        }}
                                    >
                                        {s.bookVisit(kindWord(kind))}
                                    </Button>
                                ) : null}
                                {rec.canConvert ? (
                                    <Button busy={act.busy} onPress={convert}>
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
                                <p className="text-sm text-ink-soft">{rec.row.decline_reason}</p>
                            </DetailSection>
                        ) : null}
                        <div className="@4xl:hidden">
                            <DetailSection title={s.lines}>
                                <div className="divide-y divide-line-soft rounded-lg border border-line">
                                    {rec.lines.map((l) => (
                                        <div
                                            key={l.id}
                                            className="flex items-start justify-between gap-4 px-4 py-3"
                                        >
                                            <div className="min-w-0">
                                                <p
                                                    className={`text-sm ${l.optional && !l.selected ? "text-muted" : "text-ink"}`}
                                                >
                                                    {l.description}
                                                </p>
                                                <p className="text-xs text-muted">
                                                    {formatParts([rec.lineDetail(l), l.note])}
                                                </p>
                                            </div>
                                            <Money
                                                currency={BUSINESS_CURRENCY}
                                                cents={l.amountCents}
                                                tone={l.optional && !l.selected ? "muted" : "ink"}
                                            />
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-3 rounded-lg bg-bg px-4 py-3">
                                    <DocTotals currency={BUSINESS_CURRENCY} lines={rec.totals} />
                                </div>
                            </DetailSection>
                        </div>
                        {rec.acceptUrl !== null ? (
                            <DetailSection title={s.acceptLink}>
                                <CopyField
                                    label={s.acceptLink}
                                    value={rec.acceptUrl}
                                    copyLabel={s.copyLink}
                                    copiedLabel={s.copied}
                                />
                            </DetailSection>
                        ) : null}
                        {rec.row.notes !== null ? (
                            <DetailSection title={s.notes}>
                                <p className="whitespace-pre-line text-sm text-ink-soft">
                                    {rec.row.notes}
                                </p>
                            </DetailSection>
                        ) : null}
                        <DetailSection title={s.history}>
                            <ActivityTimeline entries={rec.timeline} />
                        </DetailSection>
                    </DetailView>
                    <div className="min-h-0 @max-4xl:hidden">
                        <DocumentPane
                            businessName={letterhead.name}
                            doc={estimateDoc}
                            attached={estimateSent}
                        />
                    </div>
                </div>
            </div>
            {previewing ? (
                <DocumentPreview
                    businessName={letterhead.name}
                    doc={estimateDoc}
                    attached={estimateSent}
                    onClose={() => {
                        setPreviewing(false);
                    }}
                />
            ) : null}
        </Modal>
    );
}
