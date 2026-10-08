import { strings, useAuthForm } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StatusBar } from "expo-status-bar";
import {
    KeyboardAvoidingView,
    Linking,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Checkbox, GoogleIcon, Icon, Lockup, Notice, TextField } from "@clientbridge/ui";

import { api } from "../lib/api";
import { setTokens } from "../lib/auth";

const c = theme.colors;
const a = strings.auth;

type Auth = ReturnType<typeof useAuthForm>;

function Credentials({ auth }: { auth: Auth }) {
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
                    <Button
                        variant="link"
                        onPress={() => {
                            auth.setMode("reset");
                        }}
                    >
                        {a.forgot}
                    </Button>
                )}
            </View>
            {auth.error !== null ? (
                <View style={styles.error}>
                    <Notice tone="danger" banner>
                        {auth.attemptsLeft === null
                            ? auth.error
                            : `${auth.error}\n${a.attemptsLeft(auth.attemptsLeft)}`}
                    </Notice>
                </View>
            ) : null}
            <View style={styles.submit}>
                <Button
                    size="lg"
                    full
                    onPress={auth.submit}
                    busy={auth.busy}
                    disabled={auth.locked && !signup}
                >
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
                onPress={auth.googleUnavailable}
                icon={<GoogleIcon size={20} />}
            >
                {a.continueWithGoogle}
            </Button>
            {signup ? <Text style={styles.terms}>{a.terms}</Text> : null}
        </View>
    );
}

function EmailStep({ auth }: { auth: Auth }) {
    return (
        <View>
            <View style={styles.back}>
                <Button
                    variant="link"
                    icon={<Icon name="chevronLeft" size={16} color={c.accent} />}
                    onPress={() => {
                        auth.setMode("signin");
                    }}
                >
                    {a.backToSignIn}
                </Button>
            </View>
            {auth.mode === "sent" ? (
                <View>
                    <View style={styles.mailIcon}>
                        <Icon name="mail" size={24} color={c.accent} />
                    </View>
                    <Text style={styles.title}>{a.sentTitle}</Text>
                    <Text style={styles.body}>{a.sentBody(auth.email.trim())}</Text>
                    {auth.error !== null ? <Notice tone="danger">{auth.error}</Notice> : null}
                    <View style={styles.submit}>
                        <Button
                            size="lg"
                            full
                            onPress={() => {
                                Linking.openURL("message:").catch(() => undefined);
                            }}
                        >
                            {a.openMail}
                        </Button>
                    </View>
                    <View style={styles.submit}>
                        <Button
                            variant="outline"
                            size="lg"
                            full
                            onPress={auth.resend}
                            busy={auth.busy}
                            disabled={auth.cooldown > 0}
                        >
                            {auth.cooldown > 0 ? a.resendIn(auth.cooldown) : a.resend}
                        </Button>
                    </View>
                </View>
            ) : (
                <View>
                    <Text style={styles.title}>{a.resetTitle}</Text>
                    <Text style={styles.subtitle}>{a.resetSubtitle}</Text>
                    <TextField
                        label={a.email}
                        type="email"
                        value={auth.email}
                        onChange={auth.setEmail}
                        onSubmit={auth.submit}
                        autoComplete="email"
                        size="lg"
                        surface="surface"
                        error={auth.fieldErrors.email}
                    />
                    {auth.error !== null ? <Notice tone="danger">{auth.error}</Notice> : null}
                    <View style={styles.submit}>
                        <Button size="lg" full onPress={auth.submit} busy={auth.busy}>
                            {a.sendLink}
                        </Button>
                    </View>
                </View>
            )}
        </View>
    );
}

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
    const auth = useAuthForm(api, setTokens, onSuccess);
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
                        {credentials ? <Credentials auth={auth} /> : <EmailStep auth={auth} />}
                    </View>
                    {credentials ? (
                        <View style={styles.toggleRow}>
                            <Text style={styles.toggleText}>
                                {signup ? a.haveAccount : a.newToApp}
                            </Text>
                            <Button
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
    body: { color: c.inkSoft, fontSize: 15, marginTop: 8, lineHeight: 22 },
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
    terms: { color: c.muted, fontSize: 12, textAlign: "center", marginTop: 14, lineHeight: 17 },
    mailIcon: {
        width: 52,
        height: 52,
        borderRadius: 26,
        backgroundColor: c.accentWeak,
        alignItems: "center",
        justifyContent: "center",
        marginTop: 20,
        marginBottom: 16,
    },
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
