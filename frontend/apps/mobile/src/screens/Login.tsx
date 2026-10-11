import { strings, useAuthForm, useRecoveryForm } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StatusBar } from "expo-status-bar";
import * as WebBrowser from "expo-web-browser";
import { type ReactNode, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
    Button,
    Checkbox,
    Choice,
    GoogleIcon,
    Icon,
    Lockup,
    Notice,
    TextField,
} from "@clientbridge/ui";

import { identity } from "../lib/api";

const c = theme.colors;
const a = strings.auth;
const CALLBACK = "clientbridge://auth/callback";

type Auth = ReturnType<typeof useAuthForm>;
type Recovery = ReturnType<typeof useRecoveryForm>;

async function openAuthSession(url: string): Promise<string | null> {
    const result = await WebBrowser.openAuthSessionAsync(url, CALLBACK);
    return result.type === "success" ? result.url : null;
}

function Messages({ error, notice }: { error: string | null; notice: string | null }) {
    return (
        <>
            {notice !== null ? (
                <View style={styles.error}>
                    <Notice tone="info" banner>
                        {notice}
                    </Notice>
                </View>
            ) : null}
            {error !== null ? (
                <View style={styles.error}>
                    <Notice tone="danger" banner>
                        {error}
                    </Notice>
                </View>
            ) : null}
        </>
    );
}

function Back({ onPress }: { onPress: () => void }) {
    return (
        <View style={styles.back}>
            <Button
                variant="link"
                icon={<Icon name="chevronLeft" size={16} color={c.accent} />}
                onPress={onPress}
            >
                {a.backToSignIn}
            </Button>
        </View>
    );
}

function Credentials({ auth, onForgot }: { auth: Auth; onForgot: () => void }) {
    const signup = auth.mode === "signup";
    return (
        <View>
            <Text style={styles.title}>{signup ? a.signUpTitle : a.signInTitle}</Text>
            <Text style={styles.subtitle}>{signup ? a.signUpSubtitle : a.signInSubtitle}</Text>
            {signup ? (
                <TextField
                    label={a.name}
                    value={auth.name}
                    onChange={auth.setName}
                    placeholder={a.namePlaceholder}
                    autoComplete="name"
                    size="lg"
                    surface="surface"
                    error={auth.fieldErrors.name}
                />
            ) : null}
            <TextField
                label={a.email}
                type="email"
                value={auth.email}
                onChange={auth.setEmail}
                placeholder={a.emailPlaceholder}
                autoComplete="email"
                size="lg"
                surface="surface"
                error={auth.fieldErrors.email}
            />
            <TextField
                label={signup ? a.newPassword : a.password}
                type={auth.reveal ? "text" : "password"}
                value={auth.password}
                onChange={auth.setPassword}
                onSubmit={auth.submit}
                placeholder={a.passwordPlaceholder}
                autoComplete={signup ? "new-password" : "current-password"}
                hint={signup ? a.passwordHint : undefined}
                size="lg"
                surface="surface"
                error={auth.fieldErrors.password}
            />
            <View style={styles.row}>
                <Checkbox label={a.showPassword} value={auth.reveal} onChange={auth.toggleReveal} />
                {signup ? null : (
                    <Button style={{ alignSelf: "center" }} variant="link" onPress={onForgot}>
                        {a.forgot}
                    </Button>
                )}
            </View>
            <Messages error={auth.error} notice={auth.notice} />
            <View style={styles.submit}>
                <Button size="lg" full onPress={auth.submit} busy={auth.busy}>
                    {signup ? a.createAccount : a.signIn}
                </Button>
            </View>
            <View style={styles.divider}>
                <View style={styles.line} />
                <Text style={styles.or}>{a.or}</Text>
                <View style={styles.line} />
            </View>
            <Button
                variant="outline"
                size="lg"
                full
                onPress={auth.google}
                icon={<GoogleIcon size={20} />}
            >
                {a.continueWithGoogle}
            </Button>
            {signup ? <Text style={styles.terms}>{a.terms}</Text> : null}
        </View>
    );
}

function CodeStep({
    title,
    body,
    label,
    code,
    setCode,
    error,
    notice,
    busy,
    submit,
    submitLabel,
    children,
}: {
    title: string;
    body: string;
    label: string;
    code: string;
    setCode: (v: string) => void;
    error: string | null;
    notice: string | null;
    busy: boolean;
    submit: () => void;
    submitLabel: string;
    children?: ReactNode;
}) {
    return (
        <View>
            <View style={styles.mailIcon}>
                <Icon name="mail" size={32} color={c.inkSoft} />
            </View>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{body}</Text>
            <TextField
                label={label}
                value={code}
                onChange={setCode}
                onSubmit={submit}
                placeholder={a.codePlaceholder}
                autoComplete="one-time-code"
                size="lg"
                surface="surface"
            />
            <Messages error={error} notice={notice} />
            <View style={styles.submit}>
                <Button size="lg" full onPress={submit} busy={busy}>
                    {submitLabel}
                </Button>
            </View>
            {children}
        </View>
    );
}

function SecondFactor({ auth }: { auth: Auth }) {
    const others = auth.mfaMethods.filter((m) => m !== auth.mfaMethod);
    return (
        <CodeStep
            title={a.mfaTitle}
            body={a.mfaSubtitle}
            label={auth.mfaMethod === "totp" ? a.mfaTotp : a.mfaLookup}
            code={auth.code}
            setCode={auth.setCode}
            error={auth.error ?? auth.fieldErrors.code ?? null}
            notice={null}
            busy={auth.busy}
            submit={auth.submit}
            submitLabel={a.confirm}
        >
            {others.length > 0 ? (
                <View style={styles.submit}>
                    <Choice
                        layout="chips"
                        options={others.map((m) => ({ key: m, label: a.mfaUse[m] }))}
                        onChange={auth.setMfaMethod}
                    />
                </View>
            ) : null}
            <View style={styles.submit}>
                <Button variant="link" onPress={auth.cancel}>
                    {a.notYou}
                </Button>
            </View>
        </CodeStep>
    );
}

function Verify({ auth }: { auth: Auth }) {
    return (
        <CodeStep
            title={a.verifyTitle}
            body={auth.email.trim() ? a.verifyBody(auth.email.trim()) : a.verifyBodyAnyEmail}
            label={a.code}
            code={auth.code}
            setCode={auth.setCode}
            error={auth.error ?? auth.fieldErrors.code ?? null}
            notice={null}
            busy={auth.busy}
            submit={auth.submit}
            submitLabel={a.verify}
        >
            <View style={styles.links}>
                <Button variant="link" onPress={auth.resend} disabled={auth.cooldown > 0}>
                    {auth.cooldown > 0 ? a.resendIn(auth.cooldown) : a.resendCode}
                </Button>
                <Button variant="link" onPress={auth.skipVerification}>
                    {a.skipForNow}
                </Button>
            </View>
        </CodeStep>
    );
}

function Recover({ recovery, onBack }: { recovery: Recovery; onBack: () => void }) {
    if (recovery.step === "code")
        return (
            <View>
                <Back onPress={onBack} />
                <CodeStep
                    title={a.resetCodeTitle}
                    body={a.resetCodeBody(recovery.email.trim())}
                    label={a.code}
                    code={recovery.code}
                    setCode={recovery.setCode}
                    error={recovery.error ?? recovery.fieldErrors.code ?? null}
                    notice={null}
                    busy={recovery.busy}
                    submit={recovery.submit}
                    submitLabel={a.checkCode}
                >
                    <View style={styles.links}>
                        <Button
                            variant="link"
                            onPress={recovery.resend}
                            disabled={recovery.cooldown > 0}
                        >
                            {recovery.cooldown > 0 ? a.resendIn(recovery.cooldown) : a.resendCode}
                        </Button>
                    </View>
                </CodeStep>
            </View>
        );
    const password = recovery.step === "password";
    return (
        <View>
            {password ? null : <Back onPress={onBack} />}
            <Text style={styles.title}>{password ? a.resetPasswordTitle : a.resetTitle}</Text>
            <Text style={styles.subtitle}>
                {password ? a.resetPasswordSubtitle : a.resetSubtitle}
            </Text>
            {password ? (
                <TextField
                    label={a.newPassword}
                    type="password"
                    value={recovery.password}
                    onChange={recovery.setPassword}
                    onSubmit={recovery.submit}
                    autoComplete="new-password"
                    hint={a.passwordHint}
                    size="lg"
                    surface="surface"
                    error={recovery.fieldErrors.password}
                />
            ) : (
                <TextField
                    label={a.email}
                    type="email"
                    value={recovery.email}
                    onChange={recovery.setEmail}
                    onSubmit={recovery.submit}
                    autoComplete="email"
                    size="lg"
                    surface="surface"
                    error={recovery.fieldErrors.email}
                />
            )}
            <Messages error={recovery.error} notice={null} />
            <View style={styles.submit}>
                <Button size="lg" full onPress={recovery.submit} busy={recovery.busy}>
                    {password ? a.savePassword : a.sendCode}
                </Button>
            </View>
        </View>
    );
}

function Recovering({
    email,
    onBack,
    onSuccess,
}: {
    email: string;
    onBack: () => void;
    onSuccess: (sessionToken?: string) => void;
}) {
    const recovery = useRecoveryForm(identity, onSuccess, { defaultEmail: email });
    return <Recover recovery={recovery} onBack={onBack} />;
}

export function LoginScreen({ onSuccess }: { onSuccess: (sessionToken?: string) => void }) {
    const [recovering, setRecovering] = useState(false);
    const auth = useAuthForm(identity, onSuccess, { openUrl: openAuthSession });
    const credentials = auth.mode === "signin" || auth.mode === "signup";
    const signup = auth.mode === "signup";

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
                    <View>
                        <Lockup
                            fontSize={19}
                            markColor={c.accent}
                            textColor={c.ink}
                            style={styles.brand}
                        />
                        {recovering ? (
                            <Recovering
                                email={auth.email}
                                onBack={() => {
                                    setRecovering(false);
                                }}
                                onSuccess={onSuccess}
                            />
                        ) : auth.mode === "mfa" ? (
                            <SecondFactor auth={auth} />
                        ) : auth.mode === "verify" ? (
                            <Verify auth={auth} />
                        ) : (
                            <Credentials
                                auth={auth}
                                onForgot={() => {
                                    setRecovering(true);
                                }}
                            />
                        )}
                    </View>
                    {credentials && !recovering ? (
                        <View style={styles.toggleRow}>
                            <Text style={styles.toggleText}>
                                {signup ? a.haveAccount : a.newToApp}
                            </Text>
                            <Button
                                style={{ alignSelf: "center" }}
                                variant="link"
                                onPress={() => {
                                    auth.setMode(signup ? "signin" : "signup");
                                }}
                            >
                                {signup ? a.signIn : a.createAnAccount}
                            </Button>
                        </View>
                    ) : null}
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    fill: { flex: 1 },
    content: {
        flexGrow: 1,
        justifyContent: "center",
        paddingHorizontal: 28,
        paddingVertical: 32,
    },
    brand: { marginBottom: 36 },
    title: { color: c.ink, fontSize: 30, fontWeight: "700", letterSpacing: -0.5 },
    subtitle: { color: c.muted, fontSize: 14.5, marginTop: 5, marginBottom: 26, lineHeight: 20 },
    divider: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 18 },
    line: { flex: 1, height: 1, backgroundColor: c.border },
    or: { color: c.muted, fontSize: 12 },
    row: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: 12,
    },
    error: { marginTop: 14 },
    submit: { marginTop: 18 },
    links: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: 14,
    },
    terms: { color: c.muted, fontSize: 12, textAlign: "center", marginTop: 14, lineHeight: 17 },
    mailIcon: { marginTop: 20, marginBottom: 12 },
    toggleRow: {
        flexDirection: "row",
        justifyContent: "center",
        alignItems: "center",
        gap: 5,
        paddingTop: 28,
    },
    toggleText: { color: c.muted, fontSize: 14 },
    back: { alignItems: "flex-start", marginBottom: 20 },
});
