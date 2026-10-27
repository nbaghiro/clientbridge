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
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, Text } from "react-native";
import {
    ActivityTimeline,
    Button,
    Choice,
    DetailSection,
    DetailView,
    DocTotals,
    Field,
    KeyValueList,
    LoadFailed,
    Notice,
    Skeleton,
    TextField,
    Toggle,
    confirm,
    ui,
} from "@clientbridge/ui";

import { api } from "../lib/api";

const s = strings.refunds;

export function RefundComposer({
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
    const canAct = form.issued === null && form.blocked === null && form.preview.error === null;
    return (
        <DetailView
            open
            title={p.client_name ?? summary.subject}
            subtitle={formatParts([summary.subject, summary.method, summary.when])}
            status={{ status: summary.stateLabel, intent: summary.intent }}
            onClose={onClose}
            actions={
                canAct ? (
                    <Button
                        grow
                        variant="danger"
                        busy={form.busy}
                        disabled={!form.valid || form.preview.isLoading}
                        onPress={ask}
                    >
                        {form.busy ? s.refunding : form.submitLabel}
                    </Button>
                ) : undefined
            }
        >
            <KeyValueList
                layout="stack"
                columns={2}
                rows={[
                    { label: s.paid, value: formatMoney(p.amount_cents, BUSINESS_CURRENCY) },
                    {
                        label: s.refundedSoFar,
                        value: formatMoney(p.refunded_cents, BUSINESS_CURRENCY),
                    },
                    {
                        label: s.leftToRefund,
                        value: formatMoney(summary.leftCents, BUSINESS_CURRENCY),
                    },
                    { label: s.stripeFee, value: formatMoney(p.fee_cents, BUSINESS_CURRENCY) },
                ]}
            />
            {form.issued !== null ? (
                <Notice tone="success" banner>
                    {form.issued}
                </Notice>
            ) : form.preview.error !== null ? (
                <LoadFailed
                    message={s.previewError}
                    onRetry={() => {
                        form.preview.refresh().catch(() => undefined);
                    }}
                />
            ) : form.blocked !== null ? (
                <Notice tone="info" banner>
                    {form.blocked}
                </Notice>
            ) : (
                <DetailSection title={s.creditNote}>
                    {form.wholeOnly ? <Notice tone="info">{s.wholeOnly}</Notice> : null}
                    {form.byHand ? <Notice tone="info">{s.byHandNote}</Notice> : null}
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
                    <Field label={s.reason}>
                        <Choice
                            options={form.reasons}
                            value={form.reason}
                            onChange={form.setReason}
                        />
                    </Field>
                    <Text style={styles.caption}>{s.reverses}</Text>
                    {form.preview.isLoading && form.lines.length === 0 ? (
                        <Skeleton variant="line" count={3} label={s.previewLoading} />
                    ) : (
                        <DocTotals
                            currency={BUSINESS_CURRENCY}
                            lines={form.lines}
                            density="compact"
                        />
                    )}
                    {form.feeNote !== null ? <Text style={ui.note}>{form.feeNote}</Text> : null}
                    <Toggle label={s.notify} value={form.notify} onChange={form.setNotify} />
                    {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
                </DetailSection>
            )}
            <DetailSection title={s.history}>
                <ActivityTimeline entries={form.history} />
            </DetailSection>
        </DetailView>
    );
}

/** A refund over the current screen, for the payment a button named. */
export function RefundTask({ paymentId, onClose }: { paymentId: string; onClose: () => void }) {
    const desk = useRefundDesk(paymentId);
    if (desk.selected === null) return null;
    return (
        <RefundComposer
            key={`${desk.selected.payment.id}:${String(desk.selected.payment.refunded_cents)}`}
            summary={desk.selected}
            refunds={desk.refunds}
            onClose={onClose}
        />
    );
}

const styles = StyleSheet.create({
    caption: {
        fontFamily: theme.fonts.ui,
        fontSize: 12,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
});
