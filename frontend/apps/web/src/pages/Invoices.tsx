import {
    type EstimateRecord,
    type EstimateSegment,
    type InvoiceRecord,
    type InvoiceSegment,
    type PaymentRow,
    canManagePayments,
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
    useInvoicePayments,
    useInvoiceRecord,
    useInvoices,
    useLetterhead,
    useLines,
    formatParts,
    BUSINESS_CURRENCY,
    kindWord,
    usePeoplePhotos,
    useSubjectKind,
} from "@clientbridge/app-core";
import {
    ActivityTimeline,
    Avatar,
    Badge,
    Button,
    Choice,
    CopyField,
    DetailSection,
    DetailView,
    Modal,
    DocTotals,
    KeyValueList,
    ListPage,
    ListRow,
    Money,
    Notice,
    Stat,
    StatusPill,
    confirm,
} from "@clientbridge/ui";
import { cssVar } from "@clientbridge/tokens";
import { type ReactNode, useState } from "react";
import { useNavigate } from "react-router-dom";

import { DocEditor } from "../components/DocEditor";
import { DocumentPreview, type PreviewDoc } from "../components/DocumentPreview";
import { RecordPayment } from "../components/RecordPayment";
import { config } from "../config";
import { api, apiBaseUrl } from "../lib/api";
import { useRole } from "../lib/auth";
import { linkPath, useLinkIntent, useOpenLink } from "../lib/links";

const s = strings.billing;
const GRID =
    "grid grid-cols-[4.5rem_minmax(0,2.2fr)_5.5rem_minmax(0,1.4fr)_6.5rem_6.5rem] items-center gap-4";
const EST_GRID =
    "grid grid-cols-[4.5rem_minmax(0,2.2fr)_minmax(0,1.6fr)_6.5rem] items-center gap-4";

type DocKind = "invoices" | "estimates";
type Composing = { kind: "invoice" | "estimate"; id: string | null } | null;

export function Invoices() {
    const [composing, setComposing] = useState<Composing>(null);
    const [openId, setOpenId] = useState<string | null>(null);
    const params = useLinkIntent({
        onCreate: () => {
            setComposing({
                kind: params.get("doc") === "estimates" ? "estimate" : "invoice",
                id: null,
            });
        },
        onOpen: setOpenId,
    });
    const [doc, setDoc] = useState<DocKind>(
        params.get("doc") === "estimates" ? "estimates" : "invoices",
    );

    const switcher = (
        <Choice<DocKind>
            layout="segmented"
            label={s.invoices}
            options={[
                { key: "invoices", label: s.invoices },
                { key: "estimates", label: s.estimates },
            ]}
            value={doc}
            onChange={(k) => {
                setDoc(k);
                setOpenId(null);
            }}
        />
    );

    return (
        <div>
            {doc === "invoices" ? (
                <InvoiceDeskView
                    switcher={switcher}
                    openId={openId}
                    setOpenId={setOpenId}
                    compose={(id) => {
                        setComposing({ kind: "invoice", id });
                    }}
                />
            ) : (
                <EstimateDeskView
                    switcher={switcher}
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
        </div>
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

// The tab's one row of controls: which documents, how many, and the way to start a new one.
function DeskBar({
    switcher,
    summary,
    action,
}: {
    switcher: ReactNode;
    summary: string | undefined;
    action: ReactNode;
}) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-3">
            {switcher}
            <div className="flex items-center gap-4">
                {summary !== undefined ? <p className="text-sm text-muted">{summary}</p> : null}
                {action}
            </div>
        </div>
    );
}

function InvoiceDeskView({
    switcher,
    openId,
    setOpenId,
    compose,
}: {
    switcher: ReactNode;
    openId: string | null;
    setOpenId: (id: string | null) => void;
    compose: (id: string | null) => void;
}) {
    const photos = usePeoplePhotos();
    const desk = useInvoiceDesk();
    const { stats } = desk;
    const ready = desk.load.state === "ready";
    const figure = (cents: number): { cents: number | null; currency: string } => ({
        cents: ready ? cents : null,
        currency: BUSINESS_CURRENCY,
    });

    return (
        <div className="@container space-y-6">
            <DeskBar
                switcher={switcher}
                summary={desk.summary}
                action={
                    desk.nothingYet ? null : (
                        <Button
                            size="sm"
                            icon="plus"
                            onPress={() => {
                                compose(null);
                            }}
                        >
                            {s.newInvoice}
                        </Button>
                    )
                }
            />
            {desk.load.state === "error" || desk.nothingYet ? undefined : (
                <div className="grid grid-cols-2 gap-3 @4xl:grid-cols-4">
                    <Stat
                        label={s.statOutstanding}
                        {...figure(stats.outstandingCents)}
                        hint={ready ? s.statOutstandingHint(stats.outstandingCount) : undefined}
                    />
                    <Stat
                        label={s.statOverdue}
                        {...figure(stats.overdueCents)}
                        tone={stats.overdueCents > 0 ? "danger" : "ink"}
                        hint={ready ? s.statOverdueHint(stats.overdueCount) : undefined}
                    />
                    <Stat
                        label={s.statPaid}
                        {...figure(stats.paid30Cents)}
                        tone="success"
                        hint={ready ? s.statPaidHint(stats.paid30Count) : undefined}
                    />
                    <Stat
                        label={s.statDrafts}
                        {...figure(stats.draftCents)}
                        hint={ready ? s.statDraftsHint(stats.draftCount) : undefined}
                    />
                </div>
            )}
            <ListPage<(typeof desk.rows)[number], InvoiceSegment>
                segments={
                    desk.nothingYet
                        ? undefined
                        : { items: desk.segments, active: desk.segment, onSelect: desk.setSegment }
                }
                search={
                    desk.nothingYet
                        ? undefined
                        : { value: desk.q, onChange: desk.setQ, placeholder: s.search }
                }
                head={
                    desk.nothingYet ? undefined : (
                        <div className={GRID}>
                            <span>{s.colNumber}</span>
                            <span>{s.colClient}</span>
                            <span>{s.colIssued}</span>
                            <span>{s.colStatus}</span>
                            <span className="text-right">{s.colTotal}</span>
                            <span className="text-right">{s.colBalance}</span>
                        </div>
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
                    <div className={GRID}>
                        <span className="font-medium tabular-nums text-ink">{r.number}</span>
                        <span className="flex min-w-0 items-center gap-3">
                            <Avatar
                                name={r.row.client_name ?? ""}
                                src={photos.client(r.row.client_id)}
                                size="sm"
                            />
                            <span className="truncate font-medium text-ink">
                                {r.row.client_name}
                            </span>
                        </span>
                        <span className="text-ink-soft">{r.issuedLabel}</span>
                        <span className="flex min-w-0 flex-col items-start gap-1">
                            <StatusPill status={r.statusLabel} intent={r.intent} />
                            <span
                                className={`truncate text-xs ${r.late ? "font-medium text-danger" : "text-muted"}`}
                            >
                                {r.dueLabel}
                            </span>
                        </span>
                        <span className="text-right">
                            <Money currency={BUSINESS_CURRENCY} cents={r.totalCents} tone="muted" />
                        </span>
                        <span className="text-right">
                            {(r.row.balance_cents ?? 0) > 0 && r.status !== "void" ? (
                                <Money
                                    currency={BUSINESS_CURRENCY}
                                    cents={r.row.balance_cents}
                                    strong
                                    tone={r.late ? "danger" : "ink"}
                                />
                            ) : (
                                <span className="text-muted">{s.dash}</span>
                            )}
                        </span>
                    </div>
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
        </div>
    );
}

function InvoicePanel({
    id,
    onClose,
    onEdit,
}: {
    id: string;
    onClose: () => void;
    onEdit: (id: string) => void;
}) {
    const rec = useInvoiceRecord(id, config.payUrl);
    const act = useInvoiceActions(api);
    const role = useRole();
    const letterhead = useLetterhead(apiBaseUrl);
    const estimates = useEstimates();
    const estimateId = estimates.find((e) => e.converted_invoice_id === id)?.id ?? null;
    const estimate = useEstimateRecord(estimateId, config.payUrl);
    const [recording, setRecording] = useState(false);
    const [previewing, setPreviewing] = useState(false);
    if (rec === null) return null;

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
            flow
            framed={false}
            size={previewing ? "xl" : "lg"}
            onClose={() => {
                if (recording) setRecording(false);
                else if (previewing) setPreviewing(false);
                else onClose();
            }}
        >
            <DetailView
                open={!(recording || previewing)}
                title={rec.title}
                subtitle={rec.row.client_name ?? undefined}
                status={{ status: rec.statusLabel, intent: rec.intent }}
                onClose={onClose}
                actions={
                    <>
                        <Button
                            variant="outline"
                            icon="receipt"
                            onPress={() => {
                                setPreviewing(true);
                            }}
                        >
                            {s.pdf}
                        </Button>
                        {rec.canEdit ? (
                            <Button
                                variant="outline"
                                icon="edit"
                                onPress={() => {
                                    onEdit(rec.row.id);
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
                <KeyValueList layout="stack" columns={3} rows={rec.facts} />
                <DetailSection title={s.lines}>
                    <div className="divide-y divide-line-soft rounded-lg border border-line">
                        {rec.lines.map((l) => (
                            <div
                                key={l.id}
                                className="flex items-start justify-between gap-4 px-4 py-3"
                            >
                                <div className="min-w-0">
                                    <p className="text-sm text-ink">{l.description}</p>
                                    <p className="text-xs text-muted">{rec.lineDetail(l)}</p>
                                </div>
                                <Money currency={BUSINESS_CURRENCY} cents={l.amountCents} />
                            </div>
                        ))}
                    </div>
                    <div className="mt-3 rounded-lg bg-bg px-4 py-3">
                        <DocTotals currency={BUSINESS_CURRENCY} lines={rec.totals} />
                    </div>
                </DetailSection>
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
                        <p className="whitespace-pre-line text-sm text-ink-soft">{rec.row.notes}</p>
                    </DetailSection>
                ) : null}
                <DetailSection title={s.history}>
                    <ActivityTimeline entries={rec.timeline} />
                </DetailSection>
            </DetailView>
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
                    initial="invoice"
                    docs={invoicePreviewDocs(rec, estimate, letterhead)}
                    onClose={() => {
                        setPreviewing(false);
                    }}
                />
            ) : null}
        </Modal>
    );
}

function invoicePreviewDocs(
    rec: InvoiceRecord,
    estimate: EstimateRecord | null,
    letterhead: ReturnType<typeof useLetterhead>,
): PreviewDoc[] {
    const color = cssVar("accent");
    const d = s.doc;
    const paid = rec.payments.find((x) => !x.refund && !x.pending);
    const sentAt =
        rec.row.issued_at === null ? d.notSentYet : d.attachedInvoice(rec.facts[1]?.value ?? "");
    return [
        {
            kind: "invoice",
            doc: printedInvoice(rec, letterhead, color),
            missing: "",
            attached: sentAt,
            facts: rec.facts.slice(1),
        },
        {
            kind: "estimate",
            doc: estimate === null ? null : printedEstimate(estimate, letterhead, color),
            missing: d.noEstimate,
            attached: estimate === null ? "" : d.attachedEstimate(estimate.validLabel),
            facts: estimate === null ? [] : [{ label: s.colValid, value: estimate.validLabel }],
        },
        {
            kind: "receipt",
            doc: paid === undefined ? null : printedReceipt(rec, paid.id, letterhead, color),
            missing: d.noReceipt,
            attached: paid === undefined ? "" : d.attachedReceipt(paid.detail),
            facts:
                paid === undefined
                    ? []
                    : [
                          {
                              label: paid.label,
                              value: formatMoney(paid.amountCents, BUSINESS_CURRENCY),
                          },
                      ],
        },
    ];
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

function EstimateDeskView({
    switcher,
    openId,
    setOpenId,
    compose,
    openInvoice,
}: {
    switcher: ReactNode;
    openId: string | null;
    setOpenId: (id: string | null) => void;
    compose: (id: string | null) => void;
    openInvoice: (id: string) => void;
}) {
    const photos = usePeoplePhotos();
    const desk = useEstimateDesk();
    return (
        <div>
            <DeskBar
                switcher={switcher}
                summary={desk.summary}
                action={
                    desk.nothingYet ? null : (
                        <Button
                            size="sm"
                            icon="plus"
                            onPress={() => {
                                compose(null);
                            }}
                        >
                            {s.newEstimate}
                        </Button>
                    )
                }
            />
            <ListPage<(typeof desk.rows)[number], EstimateSegment>
                segments={
                    desk.nothingYet
                        ? undefined
                        : { items: desk.segments, active: desk.segment, onSelect: desk.setSegment }
                }
                search={
                    desk.nothingYet
                        ? undefined
                        : { value: desk.q, onChange: desk.setQ, placeholder: s.search }
                }
                head={
                    desk.nothingYet ? undefined : (
                        <div className={EST_GRID}>
                            <span>{s.colNumber}</span>
                            <span>{s.colClient}</span>
                            <span>{s.colStatus}</span>
                            <span className="text-right">{s.colTotal}</span>
                        </div>
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
                    <div className={EST_GRID}>
                        <span className="font-medium tabular-nums text-ink">{r.number}</span>
                        <span className="flex min-w-0 items-center gap-3">
                            <Avatar
                                name={r.row.client_name ?? ""}
                                src={photos.client(r.row.client_id)}
                                size="sm"
                            />
                            <span className="truncate font-medium text-ink">
                                {r.row.client_name}
                            </span>
                        </span>
                        <span className="flex min-w-0 flex-col items-start gap-1">
                            <StatusPill status={r.statusLabel} intent={r.intent} />
                            <span className="truncate text-xs text-muted">{r.validLabel}</span>
                        </span>
                        <span className="text-right">
                            <Money currency={BUSINESS_CURRENCY} cents={r.row.total_cents} />
                        </span>
                    </div>
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
        </div>
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
    const rec = useEstimateRecord(id, config.payUrl);
    const act = useEstimateActions(api);
    const navigate = useNavigate();
    const kind = useSubjectKind();
    const openLink = useOpenLink();
    const letterhead = useLetterhead(apiBaseUrl);
    const [previewing, setPreviewing] = useState(false);
    if (rec === null) return null;

    const convert = (): void => {
        confirm({ title: s.convertTitle, message: s.convertBody, confirmLabel: s.convert })
            .then((ok) => {
                if (ok) act.convert(rec, openInvoice);
            })
            .catch(() => undefined);
    };

    return (
        <Modal
            flow
            framed={false}
            size={previewing ? "xl" : "lg"}
            onClose={() => {
                if (previewing) setPreviewing(false);
                else onClose();
            }}
        >
            <DetailView
                open={!previewing}
                title={rec.title}
                subtitle={rec.row.client_name ?? undefined}
                status={{ status: rec.statusLabel, intent: rec.intent }}
                onClose={onClose}
                actions={
                    <>
                        <Button
                            variant="outline"
                            icon="receipt"
                            onPress={() => {
                                setPreviewing(true);
                            }}
                        >
                            {s.pdf}
                        </Button>
                        {rec.canEdit ? (
                            <Button
                                variant="outline"
                                icon="edit"
                                onPress={() => {
                                    onEdit(rec.row.id);
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
                                    const done = navigate(
                                        `${linkPath("booking")}&estimate=${encodeURIComponent(rec.row.id)}`,
                                    );
                                    if (done) done.catch(() => undefined);
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
                    </DetailSection>
                ) : null}
                {rec.row.decline_reason !== null ? (
                    <DetailSection title={s.declineReason}>
                        <p className="text-sm text-ink-soft">{rec.row.decline_reason}</p>
                    </DetailSection>
                ) : null}
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
                        <p className="whitespace-pre-line text-sm text-ink-soft">{rec.row.notes}</p>
                    </DetailSection>
                ) : null}
                <DetailSection title={s.history}>
                    <ActivityTimeline entries={rec.timeline} />
                </DetailSection>
            </DetailView>
            {previewing ? (
                <DocumentPreview
                    businessName={letterhead.name}
                    initial="estimate"
                    docs={[
                        {
                            kind: "estimate",
                            doc: printedEstimate(rec, letterhead, cssVar("accent")),
                            missing: "",
                            attached:
                                rec.row.number === null
                                    ? s.doc.notSentYet
                                    : s.doc.attachedEstimate(rec.validLabel),
                            facts: [{ label: s.colValid, value: rec.validLabel }],
                        },
                    ]}
                    onClose={() => {
                        setPreviewing(false);
                    }}
                />
            ) : null}
        </Modal>
    );
}
