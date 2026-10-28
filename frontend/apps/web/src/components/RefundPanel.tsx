import {
    type RefundRow,
    type RefundSummary,
    formatMoney,
    strings,
    useRefundComposer,
    useRefundDesk,
    formatParts,
    BUSINESS_CURRENCY,
    currencyAffix,
} from "@clientbridge/app-core";
import {
    ActivityTimeline,
    Button,
    Choice,
    DetailSection,
    DocTotals,
    Field,
    Icon,
    KeyValueList,
    Notice,
    Select,
    Skeleton,
    TextField,
    Toggle,
    confirm,
    LoadFailed,
} from "@clientbridge/ui";

import { api } from "../lib/api";
import { DeskPanel } from "./Desk";

const s = strings.refunds;

export function RefundPanel({
    summary,
    refunds,
    onClose,
}: {
    summary: RefundSummary;
    refunds: readonly RefundRow[];
    onClose: () => void;
}) {
    const form = useRefundComposer(api, summary, refunds);
    const p = summary.payment;
    const ask = (): void => {
        confirm({
            title: form.confirmTitle,
            message: form.confirmBody,
            confirmLabel: form.submitLabel,
            destructive: true,
        })
            .then((ok) => {
                if (ok) form.submit();
            })
            .catch(() => undefined);
    };

    return (
        <DeskPanel
            title={p.client_name ?? summary.subject}
            subtitle={formatParts([summary.subject, summary.method, summary.when])}
            status={{ status: summary.stateLabel, intent: summary.intent }}
            onClose={onClose}
        >
            <div className="space-y-6">
                <div className="rounded-md border border-line bg-bg px-4 py-3">
                    <KeyValueList
                        layout="stack"
                        columns={2}
                        rows={[
                            {
                                label: s.paid,
                                value: formatMoney(p.amount_cents, BUSINESS_CURRENCY),
                            },
                            {
                                label: s.refundedSoFar,
                                value: formatMoney(p.refunded_cents, BUSINESS_CURRENCY),
                                intent: p.refunded_cents > 0 ? "warning" : undefined,
                            },
                            {
                                label: s.leftToRefund,
                                value: formatMoney(summary.leftCents, BUSINESS_CURRENCY),
                            },
                            {
                                label: s.stripeFee,
                                value: formatMoney(p.fee_cents, BUSINESS_CURRENCY),
                            },
                        ]}
                    />
                </div>
                <DetailSection title={s.creditNote}>
                    <RefundForm form={form} onSubmit={ask} />
                </DetailSection>
                <DetailSection title={s.history}>
                    <ActivityTimeline entries={form.history} />
                </DetailSection>
            </div>
        </DeskPanel>
    );
}

function RefundForm({
    form,
    onSubmit,
}: {
    form: ReturnType<typeof useRefundComposer>;
    onSubmit: () => void;
}) {
    if (form.issued !== null) {
        return (
            <div className="flex items-start gap-3 rounded-md bg-ok-bg px-4 py-3 text-sm text-ok-fg">
                <Icon name="checkCircle" size={20} />
                <p className="font-medium">{form.issued}</p>
            </div>
        );
    }
    if (form.preview.error !== null)
        return (
            <LoadFailed
                message={s.previewError}
                onRetry={() => {
                    form.preview.refresh().catch(() => undefined);
                }}
            />
        );
    if (form.blocked !== null) {
        return (
            <Notice tone="info" banner>
                {form.blocked}
            </Notice>
        );
    }
    return (
        <div className="space-y-4">
            {form.wholeOnly ? (
                <Notice tone="info" banner>
                    {s.wholeOnly}
                </Notice>
            ) : null}
            {form.byHand ? (
                <Notice tone="info" banner>
                    {s.byHandNote}
                </Notice>
            ) : null}
            <div className="grid gap-4 xl:grid-cols-2">
                <Field label={s.howMuch}>
                    <Choice
                        layout="segmented"
                        label={s.howMuch}
                        options={form.modes}
                        value={form.mode}
                        onChange={form.setMode}
                    />
                </Field>
                {form.mode === "part" ? (
                    <TextField
                        label={s.amount}
                        type="number"
                        {...currencyAffix(BUSINESS_CURRENCY)}
                        value={form.amount}
                        onChange={form.setAmount}
                        placeholder={form.amountPlaceholder}
                    />
                ) : null}
            </div>
            <Select
                label={s.reason}
                value={form.reason}
                options={form.reasons}
                onChange={form.setReason}
            />
            <div className="rounded-md border border-line bg-bg px-4 py-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                    {s.reverses}
                </p>
                {form.preview.isLoading && form.lines.length === 0 ? (
                    <Skeleton variant="line" count={3} label={s.previewLoading} />
                ) : (
                    <DocTotals currency={BUSINESS_CURRENCY} lines={form.lines} density="compact" />
                )}
                {form.feeNote !== null ? (
                    <p className="mt-2 text-xs text-muted">{form.feeNote}</p>
                ) : null}
            </div>
            <Toggle label={s.notify} value={form.notify} onChange={form.setNotify} />
            {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
            <div className="flex justify-end">
                <Button
                    variant="danger"
                    busy={form.busy}
                    disabled={!form.valid || form.preview.isLoading}
                    onPress={onSubmit}
                >
                    {form.busy ? s.refunding : form.submitLabel}
                </Button>
            </div>
        </div>
    );
}

/** A refund over the current page, for the payment a button named. */
export function Refund({ paymentId, onClose }: { paymentId: string; onClose: () => void }) {
    const desk = useRefundDesk(paymentId);
    if (desk.selected === null) return null;
    return (
        <RefundPanel
            key={`${desk.selected.payment.id}:${String(desk.selected.payment.refunded_cents)}`}
            summary={desk.selected}
            refunds={desk.refunds}
            onClose={onClose}
        />
    );
}
