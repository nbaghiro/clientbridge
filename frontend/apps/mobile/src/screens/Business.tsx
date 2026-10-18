import {
    BUSINESS_TEXT_FIELDS,
    strings,
    timeZoneOptions,
    useBusinessForm,
    useDiscountSettings,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Loading, Notice, Panel, Select, TextField } from "@clientbridge/ui";

import { api } from "../lib/api";

const c = theme.colors;

export function Business({ footer }: { footer?: ReactNode }) {
    const form = useBusinessForm(api);
    const fields = form.fields;

    if (fields === null) {
        return <Loading />;
    }

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.fill}
        >
            <ScrollView
                style={styles.screen}
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
            >
                <Text style={styles.note}>{strings.business.subtitle}</Text>

                {BUSINESS_TEXT_FIELDS.map((f) => (
                    <TextField
                        key={f.key}
                        label={f.label}
                        type={f.key === "billing_email" ? "email" : "text"}
                        value={fields[f.key]}
                        onChange={(v) => {
                            form.set(f.key, v);
                        }}
                        placeholder={f.placeholder}
                        size="lg"
                        surface="surface"
                    />
                ))}
                <Select
                    label={strings.business.timezoneLabel}
                    value={fields.timezone}
                    options={timeZoneOptions(fields.timezone)}
                    onChange={(v) => {
                        form.set("timezone", v);
                    }}
                    size="lg"
                />

                {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
                {form.saved ? <Notice tone="success">{strings.common.saved}</Notice> : null}

                <View style={styles.submitGap}>
                    <Button size="lg" full onPress={form.submit} busy={form.busy}>
                        {strings.common.save}
                    </Button>
                </View>
                <DiscountSettings />
                {footer}
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    fill: { flex: 1 },
    screen: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16 },
    note: { color: c.muted, fontSize: 13, marginBottom: 6, lineHeight: 18 },
    submitGap: { marginTop: 22 },
});

function DiscountSettings() {
    const form = useDiscountSettings(api);
    return (
        <Panel title={strings.business.discountTitle}>
            <TextField
                label={strings.business.discountLimit}
                value={form.limit}
                onChange={form.setLimit}
                disabled={!form.ready || form.busy}
            />
            <Button onPress={form.saveLimit} busy={form.busy} disabled={!form.ready}>
                {strings.business.saveDiscount}
            </Button>
            <TextField
                label={strings.business.approvalPin}
                hint={strings.business.pinHint}
                type="password"
                maxLength={4}
                value={form.pin}
                onChange={form.setPin}
                disabled={form.busy}
                autoComplete="new-password"
            />
            <Button onPress={form.savePin} busy={form.busy} disabled={form.pin.length !== 4}>
                {strings.business.savePin}
            </Button>
            {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
            {form.saved ? <Notice tone="success">{strings.common.saved}</Notice> : null}
        </Panel>
    );
}
