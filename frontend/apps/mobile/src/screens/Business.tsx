import {
    BUSINESS_TEXT_FIELDS,
    strings,
    subjectChoices,
    timeZoneOptions,
    useBusinessForm,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import {
    Button,
    Choice,
    confirm,
    Field,
    Loading,
    Notice,
    Select,
    TextField,
} from "@clientbridge/ui";

import { api } from "../lib/api";

const c = theme.colors;

export function Business({ footer }: { footer?: ReactNode }) {
    const form = useBusinessForm(api);
    const fields = form.fields;
    const save = (): void => {
        if (form.subjectChange === null) {
            form.submit();
            return;
        }
        confirm({
            title: strings.subjects.changeTitle,
            message: form.subjectChange,
            confirmLabel: strings.subjects.changeConfirm,
        })
            .then((ok) => {
                if (ok) form.submit();
            })
            .catch(() => undefined);
    };

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
                <Field label={strings.subjects.choiceLabel} hint={strings.subjects.choiceHelp}>
                    <Choice
                        label={strings.subjects.choiceLabel}
                        layout="cards"
                        options={subjectChoices()}
                        value={form.subject}
                        onChange={form.setSubject}
                    />
                </Field>

                {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
                {form.saved ? <Notice tone="success">{strings.common.saved}</Notice> : null}

                <View style={styles.submitGap}>
                    <Button size="lg" full onPress={save} busy={form.busy}>
                        {strings.common.save}
                    </Button>
                </View>
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
