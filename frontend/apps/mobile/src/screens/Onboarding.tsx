import { PROVINCES, strings, useOnboardingForm } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Choice, Field, Lockup, Logo, Notice, TextField } from "@clientbridge/ui";

import { api } from "../lib/api";

const c = theme.colors;

export function OnboardingScreen({ onSignOut }: { onSignOut: () => void }) {
    const [submitted, setSubmitted] = useState(false);
    const form = useOnboardingForm(api, () => {
        setSubmitted(true);
    });

    if (submitted) {
        return (
            <SafeAreaView style={[styles.screen, styles.center]}>
                <Logo height={32} color={c.accent} />
                <Text style={styles.settingUp}>{strings.business.onboarding.settingUp}</Text>
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
                    <Lockup
                        fontSize={18}
                        markColor={c.accent}
                        textColor={c.ink}
                        style={styles.brand}
                    />

                    <Text style={styles.title}>{strings.business.onboarding.title}</Text>
                    <Text style={styles.subtitle}>
                        {strings.business.onboarding.subtitleMobile}
                    </Text>

                    <TextField
                        label={strings.business.onboarding.businessName}
                        value={form.name}
                        onChange={form.setName}
                        placeholder={strings.business.onboarding.businessNamePlaceholder}
                        size="lg"
                        surface="surface"
                    />
                    <TextField
                        label={strings.business.onboarding.webAddress}
                        prefix={strings.business.onboarding.slugPrefix}
                        type="url"
                        value={form.slug}
                        onChange={form.setSlug}
                        placeholder={strings.business.onboarding.slugPlaceholder}
                        size="lg"
                        surface="surface"
                    />
                    <Field label={strings.business.onboarding.province}>
                        <Choice
                            label={strings.business.onboarding.province}
                            options={PROVINCES.map((p) => ({ key: p.code, label: p.code }))}
                            value={form.province}
                            onChange={form.setProvince}
                        />
                    </Field>

                    {form.error ? <Notice tone="danger">{form.error}</Notice> : null}

                    <View style={styles.submitGap}>
                        <Button size="lg" full onPress={form.submit} busy={form.busy}>
                            {strings.business.onboarding.createBusiness}
                        </Button>
                    </View>

                    <View style={styles.signOut}>
                        <Button variant="quiet" onPress={onSignOut}>
                            {strings.business.onboarding.notYouSignOut}
                        </Button>
                    </View>
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
    brand: { marginBottom: 28 },
    title: { color: c.ink, fontSize: 28, fontWeight: "700", letterSpacing: -0.5 },
    subtitle: { color: c.muted, fontSize: 14.5, marginTop: 5, marginBottom: 22 },
    submitGap: { marginTop: 22 },
    signOut: { alignItems: "center", paddingTop: 20 },
});
