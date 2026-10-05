import { ACCOUNT_TEXT_FIELDS, LOCALES, strings, useAccountForm } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import type { ReactNode } from "react";
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";

import { api } from "../lib/api";
import { ui } from "../ui/styles";

const c = theme.colors;

export function Account({ footer }: { footer?: ReactNode }) {
    const form = useAccountForm(api);
    const fields = form.fields;

    if (fields === null) {
        return <ActivityIndicator style={styles.loading} color={c.muted} />;
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
                <Text style={styles.note}>{strings.account.subtitle}</Text>

                {ACCOUNT_TEXT_FIELDS.map((f) => (
                    <View key={f.key}>
                        <Text style={styles.label}>{f.label}</Text>
                        <TextInput
                            style={ui.inputLarge}
                            value={fields[f.key]}
                            onChangeText={(v) => {
                                form.set(f.key, v);
                            }}
                            placeholder={f.placeholder}
                            placeholderTextColor={c.muted}
                            keyboardType={f.key === "billing_email" ? "email-address" : "default"}
                            autoCapitalize={f.key === "billing_email" ? "none" : "sentences"}
                        />
                    </View>
                ))}

                {LOCALES.length > 1 ? (
                    <>
                        <Text style={styles.label}>{strings.account.language}</Text>
                        <View style={styles.chipWrap}>
                            {LOCALES.map((l) => {
                                const on = fields.locale === l.code;
                                return (
                                    <Pressable
                                        key={l.code}
                                        style={[styles.chip, on && styles.chipOn]}
                                        onPress={() => {
                                            form.set("locale", l.code);
                                        }}
                                    >
                                        <Text style={[styles.chipText, on && styles.chipTextOn]}>
                                            {l.label}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                        </View>
                    </>
                ) : null}

                {form.error !== null ? <Text style={styles.error}>{form.error}</Text> : null}
                {form.saved ? <Text style={styles.saved}>{strings.common.saved}</Text> : null}

                <Pressable
                    style={({ pressed }) => [
                        ui.primaryLarge,
                        styles.submitGap,
                        (form.busy || pressed) && styles.dim,
                    ]}
                    onPress={form.submit}
                    disabled={form.busy}
                >
                    {form.busy ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <Text style={ui.primaryLargeText}>{strings.common.save}</Text>
                    )}
                </Pressable>
                {footer}
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    fill: { flex: 1 },
    screen: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16 },
    loading: { marginTop: 24 },
    note: { color: c.muted, fontSize: 13, marginBottom: 6, lineHeight: 18 },
    label: { color: c.inkSoft, fontSize: 13, fontWeight: "600", marginBottom: 6, marginTop: 14 },
    chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },
    chip: {
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: theme.radius,
        paddingHorizontal: 14,
        paddingVertical: 9,
        backgroundColor: c.surface,
    },
    chipOn: { backgroundColor: c.accent, borderColor: c.accent },
    chipText: { color: c.inkSoft, fontSize: 13, fontWeight: "700" },
    chipTextOn: { color: c.accentInk },
    error: { color: c.danFg, fontSize: 13, marginTop: 16 },
    saved: { color: c.success, fontSize: 13, marginTop: 16 },
    submitGap: { marginTop: 22 },
    dim: { opacity: 0.7 },
});
