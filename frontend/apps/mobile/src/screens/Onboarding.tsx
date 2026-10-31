import {
    PROVINCES,
    pageDomain,
    industryOptions,
    strings,
    useOnboardingForm,
    useVerificationForm,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StatusBar } from "expo-status-bar";
import { type ReactNode, useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
    Button,
    Choice,
    Field,
    Lockup,
    Logo,
    Notice,
    Panel,
    Select,
    TextField,
} from "@clientbridge/ui";

import { api, identity } from "../lib/api";
import { pageUrl } from "../lib/config";

const c = theme.colors;
const a = strings.auth;

function Start({
    title,
    subtitle,
    onSignOut,
    children,
}: {
    title: string;
    subtitle: string;
    onSignOut: () => void;
    children: ReactNode;
}) {
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
                    <Text style={styles.title}>{title}</Text>
                    <Text style={styles.subtitle}>{subtitle}</Text>
                    {children}
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

/** A signed-in account confirms its email here before it can create a business or join one. */
export function ConfirmEmailScreen({
    flowId,
    onConfirmed,
    onSignOut,
}: {
    /** The verification flow sign-up already mailed a code for. */
    flowId: string | null;
    onConfirmed: () => void;
    onSignOut: () => void;
}) {
    const v = useVerificationForm(identity, {
        ...(flowId ? { flowId } : {}),
        ...(__DEV__ ? { devApi: api.forBusiness(null) } : {}),
    });
    useEffect(() => {
        if (v.verified) onConfirmed();
    }, [v.verified]);
    return (
        <Start
            title={a.verifyTitle}
            subtitle={v.email ? a.verifyBody(v.email) : a.verifyBodyAnyEmail}
            onSignOut={onSignOut}
        >
            <TextField
                label={a.code}
                value={v.code}
                onChange={v.setCode}
                onSubmit={v.submit}
                placeholder={a.codePlaceholder}
                autoComplete="one-time-code"
                size="lg"
                surface="surface"
            />
            {v.error ? <Notice tone="danger">{v.error}</Notice> : null}
            <View style={styles.submitGap}>
                <Button size="lg" full onPress={v.submit} busy={v.busy}>
                    {a.verify}
                </Button>
            </View>
            <View style={styles.signOut}>
                <Button variant="link" onPress={v.resend} disabled={v.cooldown > 0}>
                    {v.cooldown > 0 ? a.resendIn(v.cooldown) : a.resendCode}
                </Button>
            </View>
        </Start>
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
        <Start
            title={strings.business.onboarding.title}
            subtitle={strings.business.onboarding.subtitleMobile}
            onSignOut={onSignOut}
        >
            <TextField
                label={strings.business.onboarding.businessName}
                value={form.name}
                onChange={form.setName}
                size="lg"
                surface="surface"
            />
            <TextField
                label={strings.business.onboarding.webAddress}
                suffix={strings.business.onboarding.slugSuffix(pageDomain(pageUrl))}
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
                <Panel style={styles.tax}>
                    <Text style={styles.taxTitle}>
                        {strings.business.onboarding.taxTitle(
                            PROVINCES.find((p) => p.code === form.province)?.name ?? "",
                        )}
                        {": "}
                        {form.taxSummary}
                    </Text>
                    <Text style={styles.taxNote}>{strings.business.onboarding.taxNone}</Text>
                </Panel>
            ) : null}
            <Select
                label={strings.business.onboarding.industryLabel}
                hint={strings.business.onboarding.industryHint}
                value={form.industry ?? undefined}
                placeholder={strings.business.onboarding.industryPlaceholder}
                options={industryOptions()}
                onChange={form.setIndustry}
                size="lg"
                surface="surface"
            />

            {form.error ? <Notice tone="danger">{form.error}</Notice> : null}

            <View style={styles.submitGap}>
                <Button size="lg" full onPress={form.submit} busy={form.busy}>
                    {strings.business.onboarding.createBusiness}
                </Button>
            </View>
        </Start>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    fill: { flex: 1 },
    center: { alignItems: "center", justifyContent: "center", gap: 14 },
    settingUp: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 14 },
    content: { paddingHorizontal: 28, paddingVertical: 32 },
    brand: { marginBottom: 28 },
    title: {
        color: c.ink,
        fontFamily: theme.fonts.ui,
        fontSize: theme.type.page,
        fontWeight: "700",
        letterSpacing: -0.4,
    },
    subtitle: {
        color: c.muted,
        fontFamily: theme.fonts.ui,
        fontSize: 14.5,
        marginTop: 5,
        marginBottom: 22,
    },
    submitGap: { marginTop: 22 },
    tax: { marginTop: 12 },
    taxTitle: { color: c.ink, fontFamily: theme.fonts.ui, fontSize: 14, fontWeight: "600" },
    taxNote: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 12, marginTop: 2 },
    signOut: { flexDirection: "row", justifyContent: "center", paddingTop: 20 },
});
