import { apiUrl as apiBaseUrl } from "../lib/config";
import {
    type InvoiceRow,
    strings,
    useInteracRequestForm,
    useLetterhead,
} from "@clientbridge/app-core";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
    ActivityTimeline,
    Button,
    Choice,
    DetailSection,
    Field,
    KeyValueList,
    MessageBubble,
    Modal,
    Notice,
    PageHeader,
    TextField,
    ui,
} from "@clientbridge/ui";

import { api } from "../lib/api";
import { payUrl } from "../lib/config";

const t = strings.payments.interac;

/** Request an e-Transfer from an invoice, as a sheet: amount, channel, expiry and the message. */
export function InteracRequest({ invoice, onClose }: { invoice: InvoiceRow; onClose: () => void }) {
    const letterhead = useLetterhead(apiBaseUrl);
    const form = useInteracRequestForm(
        api,
        invoice,
        { name: letterhead.name, email: letterhead.email },
        payUrl,
    );

    return (
        <Modal open size="xl" onClose={onClose}>
            <ScrollView contentContainerStyle={styles.body}>
                <PageHeader title={t.title} subtitle={form.title} />
                <KeyValueList layout="stack" columns={2} rows={form.facts} />
                {form.sent !== null ? (
                    <Notice tone="success" banner>
                        {form.sent}
                    </Notice>
                ) : (
                    <>
                        <TextField
                            label={t.amount}
                            hint={form.amountHint}
                            type="number"
                            prefix="$"
                            value={form.amount}
                            onChange={form.setAmount}
                        />
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
                        <Field label={t.preview}>
                            <MessageBubble body={form.preview} direction="out" width="full" />
                        </Field>
                        {form.replaces !== null ? (
                            <Notice tone="info">{form.replaces}</Notice>
                        ) : null}
                        {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
                    </>
                )}
                <DetailSection title={t.requests}>
                    {form.history.length === 0 ? (
                        <Text style={ui.note}>{t.noRequests}</Text>
                    ) : (
                        <ActivityTimeline entries={form.history} />
                    )}
                    <Text style={ui.note}>{t.inboxLater}</Text>
                </DetailSection>
                <View style={ui.actions}>
                    <Button variant="quiet" onPress={onClose}>
                        {form.sent !== null ? strings.common.close : strings.common.cancel}
                    </Button>
                    {form.sent === null ? (
                        <Button busy={form.busy} onPress={form.submit}>
                            {form.busy ? t.sending : t.send}
                        </Button>
                    ) : null}
                </View>
            </ScrollView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    body: { gap: 14, paddingBottom: 24 },
});
