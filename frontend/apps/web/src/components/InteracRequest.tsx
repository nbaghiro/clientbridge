import {
    type InvoiceRow,
    strings,
    useInteracRequestForm,
    useLetterhead,
} from "@clientbridge/app-core";
import {
    ActivityTimeline,
    Button,
    Choice,
    Field,
    KeyValueList,
    MessageBubble,
    Modal,
    Notice,
    Panel,
    TextField,
} from "@clientbridge/ui";

import { config } from "../config";
import { api } from "../lib/api";

const t = strings.payments.interac;

/** Request an e-Transfer from an invoice: amount, channel, expiry and the message the client gets. */
export function InteracRequest({ invoice, onClose }: { invoice: InvoiceRow; onClose: () => void }) {
    const letterhead = useLetterhead();
    const form = useInteracRequestForm(
        api,
        invoice,
        { name: letterhead.name, email: letterhead.email },
        config.payUrl,
    );

    return (
        <Modal open size="xl" onClose={onClose}>
            <div className="space-y-6">
                <div>
                    <h2 className="font-display text-xl font-bold text-ink">{t.title}</h2>
                    <p className="mt-0.5 text-sm text-muted">{form.title}</p>
                </div>
                <div className="rounded-lg border border-line bg-surface px-5 py-4">
                    <KeyValueList layout="stack" columns={4} rows={form.facts} />
                </div>
                <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                    <Panel title={t.newRequest}>
                        {form.sent !== null ? (
                            <div className="space-y-4">
                                <Notice tone="success" banner>
                                    {form.sent}
                                </Notice>
                                <div className="flex justify-end">
                                    <Button variant="quiet" onPress={onClose}>
                                        {strings.common.close}
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <TextField
                                    label={t.amount}
                                    hint={form.amountHint}
                                    type="number"
                                    prefix="$"
                                    width="full"
                                    value={form.amount}
                                    onChange={form.setAmount}
                                />
                                <div className="grid gap-4 xl:grid-cols-2">
                                    <Field label={t.sendBy} hint={form.to}>
                                        <Choice
                                            layout="segmented"
                                            label={t.sendBy}
                                            options={form.channels}
                                            value={form.channel}
                                            onChange={form.setChannel}
                                        />
                                    </Field>
                                    <Field label={t.expiresIn}>
                                        <Choice
                                            layout="segmented"
                                            label={t.expiresIn}
                                            options={form.expiries}
                                            value={form.expiry}
                                            onChange={form.setExpiry}
                                        />
                                    </Field>
                                </div>
                                <Field label={t.preview}>
                                    <div className="rounded-md border border-line bg-bg p-3">
                                        <MessageBubble
                                            body={form.preview}
                                            direction="out"
                                            width="full"
                                        />
                                    </div>
                                </Field>
                                {form.replaces !== null ? (
                                    <Notice tone="info">{form.replaces}</Notice>
                                ) : null}
                                {form.error !== null ? (
                                    <Notice tone="danger">{form.error}</Notice>
                                ) : null}
                                <div className="flex justify-end gap-2">
                                    <Button variant="quiet" onPress={onClose}>
                                        {strings.common.cancel}
                                    </Button>
                                    <Button busy={form.busy} onPress={form.submit}>
                                        {form.busy ? t.sending : t.send}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </Panel>
                    <Panel title={t.requests}>
                        {form.history.length === 0 ? (
                            <p className="text-sm text-muted">{t.noRequests}</p>
                        ) : (
                            <ActivityTimeline entries={form.history} />
                        )}
                        <p className="mt-4 text-xs text-muted">{t.inboxLater}</p>
                    </Panel>
                </div>
            </div>
        </Modal>
    );
}
