import {
    PROVINCES,
    bookingHost,
    strings,
    subjectChoices,
    useOnboardingForm,
    useVerificationForm,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Choice, Field, Lockup, Logo, Notice, TextField } from "@clientbridge/ui";

import { api, identity } from "../lib/api";
import { bookUrl } from "../lib/config";

const c = theme.colors;
const a = strings.auth;

/** Onboarding needs a confirmed email; this sends a code to the account's address. */
function VerifyEmail() {
    const v = useVerificationForm(identity, {});
    if (v.verified) return <Notice tone="success">{a.verifyDone}</Notice>;
    return (
        <View style={styles.verify}>
            <TextField
                label={a.code}
                value={v.code}
                onChange={v.setCode}
                onSubmit={v.submit}
                placeholder={a.codePlaceholder}
                autoComplete="one-time-code"
            />
            {v.error !== null ? <Notice tone="danger">{v.error}</Notice> : null}
            <Button variant="outline" full onPress={v.submit} busy={v.busy}>
                {a.verify}
            </Button>
            <Button variant="link" onPress={v.resend} disabled={v.cooldown > 0}>
                {v.cooldown > 0 ? a.resendIn(v.cooldown) : a.resendCode}
            </Button>
        </View>
    );
}

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
                        prefix={strings.business.onboarding.slugPrefix(bookingHost(bookUrl))}
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
                    {form.taxSummary !== null ? (
                        <View style={styles.tax}>
                            <Text style={styles.taxTitle}>
                                {strings.business.onboarding.taxTitle(
                                    PROVINCES.find((p) => p.code === form.province)?.name ?? "",
                                )}
                                {": "}
                                {form.taxSummary}
                            </Text>
                            <Text style={styles.taxNote}>
                                {strings.business.onboarding.taxNone}
                            </Text>
                        </View>
                    ) : null}
                    <Field label={strings.subjects.choiceLabel} hint={strings.subjects.choiceHelp}>
                        <Choice
                            label={strings.subjects.choiceLabel}
                            layout="cards"
                            options={subjectChoices()}
                            value={form.subject}
                            onChange={form.setSubject}
                        />
                    </Field>

                    {form.error ? <Notice tone="danger">{form.error}</Notice> : null}
                    {form.needsVerification ? <VerifyEmail /> : null}

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
    verify: { gap: 10, marginTop: 12 },
    screen: { flex: 1, backgroundColor: c.bg },
    fill: { flex: 1 },
    center: { alignItems: "center", justifyContent: "center", gap: 14 },
    settingUp: { color: c.muted, fontSize: 14 },
    content: { paddingHorizontal: 28, paddingVertical: 32 },
    brand: { marginBottom: 28 },
    title: { color: c.ink, fontSize: 28, fontWeight: "700", letterSpacing: -0.5 },
    subtitle: { color: c.muted, fontSize: 14.5, marginTop: 5, marginBottom: 22 },
    submitGap: { marginTop: 22 },
    tax: {
        marginTop: 12,
        padding: 12,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
    },
    taxTitle: { color: c.ink, fontSize: 14, fontWeight: "600" },
    taxNote: { color: c.muted, fontSize: 12, marginTop: 2 },
    signOut: { alignItems: "center", paddingTop: 20 },
});
