import { PROVINCES, strings, useOnboardingForm } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";

import { Logo } from "../components/icons";
import { api } from "../lib/api";

const c = theme.colors;

/** Create-your-business step shown to an authed user with no business yet (right after sign-up). On
 *  success the new business syncs down and the app's gate routes through into the tabs. */
export function OnboardingScreen({ onSignOut }: { onSignOut: () => void }) {
    const [submitted, setSubmitted] = useState(false);
    const form = useOnboardingForm(api, () => {
        setSubmitted(true);
    });

    if (submitted) {
        return (
            <SafeAreaView style={[styles.screen, styles.center]}>
                <Logo size={30} color={c.accent} />
                <Text style={styles.settingUp}>{strings.onboarding.settingUp}</Text>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.screen}>
            <StatusBar style="dark" />
            <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : undefined}
                style={styles.fill}
            >
                <ScrollView
                    contentContainerStyle={styles.content}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                >
                    <View style={styles.brand}>
                        <Logo size={28} color={c.accent} />
                        <Text style={styles.wordmark}>Clientbridge</Text>
                    </View>

                    <Text style={styles.title}>{strings.onboarding.title}</Text>
                    <Text style={styles.subtitle}>{strings.onboarding.subtitleMobile}</Text>

                    <Text style={styles.label}>{strings.onboarding.businessName}</Text>
                    <TextInput
                        style={styles.input}
                        value={form.name}
                        onChangeText={form.setName}
                        placeholder={strings.onboarding.businessNamePlaceholder}
                        placeholderTextColor={c.muted}
                    />

                    <Text style={styles.label}>{strings.onboarding.webAddress}</Text>
                    <View style={styles.slugRow}>
                        <Text style={styles.slugPrefix}>{strings.onboarding.slugPrefix}</Text>
                        <TextInput
                            style={styles.slugInput}
                            value={form.slug}
                            onChangeText={form.setSlug}
                            placeholder={strings.onboarding.slugPlaceholder}
                            placeholderTextColor={c.muted}
                            autoCapitalize="none"
                        />
                    </View>

                    <Text style={styles.label}>{strings.onboarding.province}</Text>
                    <View style={styles.chipWrap}>
                        {PROVINCES.map((p) => {
                            const on = form.province === p.code;
                            return (
                                <Pressable
                                    key={p.code}
                                    style={[styles.chip, on && styles.chipOn]}
                                    onPress={() => {
                                        form.setProvince(p.code);
                                    }}
                                >
                                    <Text style={[styles.chipText, on && styles.chipTextOn]}>
                                        {p.code}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>

                    {form.error ? <Text style={styles.error}>{form.error}</Text> : null}

                    <Pressable
                        style={({ pressed }) => [
                            styles.submit,
                            (form.busy || pressed) && styles.dim,
                        ]}
                        onPress={form.submit}
                        disabled={form.busy}
                    >
                        {form.busy ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <Text style={styles.submitText}>
                                {strings.onboarding.createBusiness}
                            </Text>
                        )}
                    </Pressable>

                    <Pressable style={styles.signOut} onPress={onSignOut} hitSlop={8}>
                        <Text style={styles.signOutText}>{strings.onboarding.notYouSignOut}</Text>
                    </Pressable>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    fill: { flex: 1 },
    center: { alignItems: "center", justifyContent: "center", gap: 14 },
    settingUp: { color: c.muted, fontSize: 14 },
    content: { paddingHorizontal: 28, paddingVertical: 32 },
    brand: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 28 },
    wordmark: { color: c.ink, fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },
    title: { color: c.ink, fontSize: 28, fontWeight: "700", letterSpacing: -0.5 },
    subtitle: { color: c.muted, fontSize: 14.5, marginTop: 5, marginBottom: 22 },
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
    slugRow: {
        flexDirection: "row",
        alignItems: "center",
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: theme.radius,
        backgroundColor: c.surface,
        paddingLeft: 13,
    },
    slugPrefix: { color: c.muted, fontSize: 15 },
    slugInput: { flex: 1, paddingHorizontal: 2, paddingVertical: 13, color: c.ink, fontSize: 15 },
    chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: {
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: theme.radius,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: c.surface,
    },
    chipOn: { backgroundColor: c.accent, borderColor: c.accent },
    chipText: { color: c.inkSoft, fontSize: 13, fontWeight: "700" },
    chipTextOn: { color: c.accentInk },
    error: { color: c.danFg, fontSize: 13, marginTop: 14 },
    submit: {
        backgroundColor: c.accent,
        borderRadius: theme.radius,
        paddingVertical: 15,
        alignItems: "center",
        marginTop: 22,
    },
    dim: { opacity: 0.7 },
    submitText: { color: "#fff", fontWeight: "700", fontSize: 15 },
    signOut: { alignItems: "center", paddingTop: 20 },
    signOutText: { color: c.muted, fontSize: 14, fontWeight: "600" },
});
