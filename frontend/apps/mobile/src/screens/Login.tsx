import { strings, useLogin } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { StatusBar } from "expo-status-bar";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, GoogleIcon, Lockup, Notice, TextField } from "@clientbridge/ui";

import { api } from "../lib/api";
import { setTokens } from "../lib/auth";

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
    const login = useLogin(api, setTokens, onSuccess, {
        defaultEmail: "hannah@birchbarkpets.ca",
        defaultPassword: "demo1234",
    });

    const signin = login.mode === "signin";

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
                            markColor={theme.colors.accent}
                            textColor={theme.colors.ink}
                            style={styles.brand}
                        />

                        <Text style={styles.title}>
                            {signin ? strings.auth.signInTitle : strings.auth.signUpTitle}
                        </Text>
                        <Text style={styles.subtitle}>
                            {signin ? strings.auth.signInSubtitle : strings.auth.signUpSubtitle}
                        </Text>

                        {signin ? null : (
                            <TextField
                                label={strings.auth.name}
                                value={login.name}
                                onChange={login.setName}
                                placeholder={strings.auth.namePlaceholder}
                                autoComplete="name"
                                size="lg"
                                surface="surface"
                            />
                        )}
                        <TextField
                            label={strings.auth.email}
                            type="email"
                            value={login.email}
                            onChange={login.setEmail}
                            placeholder={strings.auth.emailPlaceholder}
                            autoComplete="email"
                            size="lg"
                            surface="surface"
                        />
                        <TextField
                            label={strings.auth.password}
                            type="password"
                            value={login.password}
                            onChange={login.setPassword}
                            placeholder={strings.auth.passwordPlaceholder}
                            autoComplete={signin ? "current-password" : "new-password"}
                            onSubmit={login.submit}
                            size="lg"
                            surface="surface"
                        />

                        {login.error ? <Notice tone="danger">{login.error}</Notice> : null}

                        <View style={styles.submitGap}>
                            <Button size="lg" full onPress={login.submit} busy={login.busy}>
                                {signin ? strings.auth.signIn : strings.auth.createAccount}
                            </Button>
                        </View>

                        <View style={styles.divider}>
                            <View style={styles.line} />
                            <Text style={styles.or}>{strings.auth.or}</Text>
                            <View style={styles.line} />
                        </View>

                        <Button
                            variant="outline"
                            size="lg"
                            full
                            onPress={login.googleUnavailable}
                            icon={<GoogleIcon size={20} />}
                        >
                            {strings.auth.continueWithGoogle}
                        </Button>
                    </View>

                    <View style={styles.toggleRow}>
                        <Text style={styles.toggleText}>
                            {signin ? strings.auth.newToApp : strings.auth.haveAccount}
                        </Text>
                        <Button variant="link" onPress={login.flip}>
                            {signin ? strings.auth.createAnAccount : strings.auth.signIn}
                        </Button>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    fill: { flex: 1 },
    content: {
        flexGrow: 1,
        justifyContent: "center",
        paddingHorizontal: 28,
        paddingVertical: 32,
    },
    brand: { marginBottom: 36 },
    title: { color: theme.colors.ink, fontSize: 30, fontWeight: "700", letterSpacing: -0.5 },
    subtitle: { color: theme.colors.muted, fontSize: 14.5, marginTop: 5, marginBottom: 26 },
    divider: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 18 },
    line: { flex: 1, height: 1, backgroundColor: theme.colors.border },
    or: { color: theme.colors.muted, fontSize: 12 },
    submitGap: { marginTop: 18 },
    toggleRow: {
        flexDirection: "row",
        justifyContent: "center",
        alignItems: "center",
        gap: 5,
        paddingTop: 28,
    },
    toggleText: { color: theme.colors.muted, fontSize: 14 },
});
