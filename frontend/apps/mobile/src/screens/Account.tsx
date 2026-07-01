import { type AccountFields, useAccountForm } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
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

const c = theme.colors;

const TEXT_FIELDS: {
    key: keyof AccountFields;
    label: string;
    placeholder: string;
    keyboard?: "email-address";
}[] = [
    { key: "name", label: "Business name", placeholder: "Birch Bark Pet Care" },
    { key: "timezone", label: "Time zone", placeholder: "America/Toronto" },
    {
        key: "billing_email",
        label: "Billing email",
        placeholder: "you@example.com",
        keyboard: "email-address",
    },
    { key: "gst_hst_number", label: "GST/HST number", placeholder: "123456789RT0001" },
    { key: "qst_number", label: "QST number", placeholder: "1234567890TQ0001" },
];

const LOCALES: { code: string; label: string }[] = [
    { code: "en", label: "English" },
    { code: "fr", label: "Français" },
];

export function AccountScreen() {
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
                <Text style={styles.note}>Your business profile and tax registration.</Text>

                {TEXT_FIELDS.map((f) => (
                    <View key={f.key}>
                        <Text style={styles.label}>{f.label}</Text>
                        <TextInput
                            style={styles.input}
                            value={fields[f.key]}
                            onChangeText={(v) => {
                                form.set(f.key, v);
                            }}
                            placeholder={f.placeholder}
                            placeholderTextColor={c.muted}
                            keyboardType={f.keyboard ?? "default"}
                            autoCapitalize={f.key === "billing_email" ? "none" : "sentences"}
                        />
                    </View>
                ))}

                <Text style={styles.label}>Language</Text>
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

                {form.error !== null ? <Text style={styles.error}>{form.error}</Text> : null}
                {form.saved ? <Text style={styles.saved}>Saved.</Text> : null}

                <Pressable
                    style={({ pressed }) => [styles.submit, (form.busy || pressed) && styles.dim]}
                    onPress={form.submit}
                    disabled={form.busy}
                >
                    {form.busy ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <Text style={styles.submitText}>Save changes</Text>
                    )}
                </Pressable>
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
    input: {
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: theme.radius,
        paddingHorizontal: 13,
        paddingVertical: 13,
        color: c.ink,
        fontSize: 15,
        backgroundColor: c.surface,
    },
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
    submit: {
        backgroundColor: c.accent,
        borderRadius: theme.radius,
        paddingVertical: 15,
        alignItems: "center",
        marginTop: 22,
    },
    dim: { opacity: 0.7 },
    submitText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
