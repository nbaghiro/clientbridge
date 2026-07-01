import { strings, useLogin } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { StatusBar } from "expo-status-bar";
import { type ComponentProps } from "react";
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

import { GoogleIcon, Logo } from "../components/icons";
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
                        <View style={styles.brand}>
                            <Logo size={30} color={theme.colors.accent} />
                            <Text style={styles.wordmark}>Clientbridge</Text>
                        </View>

                        <Text style={styles.title}>
                            {signin ? strings.auth.signInTitle : strings.auth.signUpTitle}
                        </Text>
                        <Text style={styles.subtitle}>
                            {signin ? strings.auth.signInSubtitle : strings.auth.signUpSubtitle}
                        </Text>

                        {signin ? null : (
                            <Field
                                label={strings.auth.name}
                                value={login.name}
                                onChangeText={login.setName}
                                placeholder={strings.auth.namePlaceholder}
                                autoComplete="name"
                            />
                        )}
                        <Field
                            label={strings.auth.email}
                            value={login.email}
                            onChangeText={login.setEmail}
                            placeholder={strings.auth.emailPlaceholder}
                            autoCapitalize="none"
                            keyboardType="email-address"
                            autoComplete="email"
                        />
                        <Field
                            label={strings.auth.password}
                            value={login.password}
                            onChangeText={login.setPassword}
                            placeholder={strings.auth.passwordPlaceholder}
                            secureTextEntry
                            autoComplete={signin ? "current-password" : "new-password"}
                            onSubmitEditing={() => {
                                login.submit();
                            }}
                        />

                        {login.error ? <Text style={styles.error}>{login.error}</Text> : null}

                        <Pressable
                            style={({ pressed }) => [
                                styles.submit,
                                (login.busy || pressed) && styles.dim,
                            ]}
                            onPress={() => {
                                login.submit();
                            }}
                            disabled={login.busy}
                        >
                            {login.busy ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <Text style={styles.submitText}>
                                    {signin ? strings.auth.signIn : strings.auth.createAccount}
                                </Text>
                            )}
                        </Pressable>

                        <View style={styles.divider}>
                            <View style={styles.line} />
                            <Text style={styles.or}>{strings.auth.or}</Text>
                            <View style={styles.line} />
                        </View>

                        <Pressable style={styles.google} onPress={login.googleUnavailable}>
                            <GoogleIcon size={20} />
                            <Text style={styles.googleText}>{strings.auth.continueWithGoogle}</Text>
                        </Pressable>
                    </View>

                    <View style={styles.toggleRow}>
                        <Text style={styles.toggleText}>
                            {signin ? strings.auth.newToApp : strings.auth.haveAccount}
                        </Text>
                        <Pressable onPress={login.flip} hitSlop={8}>
                            <Text style={styles.toggleLink}>
                                {signin ? strings.auth.createAnAccount : strings.auth.signIn}
                            </Text>
                        </Pressable>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

function Field({ label, ...props }: { label: string } & ComponentProps<typeof TextInput>) {
    return (
        <View style={styles.field}>
            <Text style={styles.label}>{label}</Text>
            <TextInput style={styles.input} placeholderTextColor={theme.colors.muted} {...props} />
        </View>
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
    brand: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 36 },
    wordmark: { color: theme.colors.ink, fontSize: 19, fontWeight: "800", letterSpacing: -0.3 },
    title: { color: theme.colors.ink, fontSize: 30, fontWeight: "700", letterSpacing: -0.5 },
    subtitle: { color: theme.colors.muted, fontSize: 14.5, marginTop: 5, marginBottom: 26 },
    google: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: theme.radius,
        paddingVertical: 13,
        backgroundColor: theme.colors.surface,
    },
    googleText: { color: theme.colors.ink, fontSize: 15, fontWeight: "600" },
    divider: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 18 },
    line: { flex: 1, height: 1, backgroundColor: theme.colors.border },
    or: { color: theme.colors.muted, fontSize: 12 },
    field: { marginBottom: 14 },
    label: { color: theme.colors.inkSoft, fontSize: 13, fontWeight: "600", marginBottom: 6 },
    input: {
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: theme.radius,
        paddingHorizontal: 13,
        paddingVertical: 13,
        color: theme.colors.ink,
        fontSize: 15,
        backgroundColor: theme.colors.surface,
    },
    error: { color: theme.colors.danFg, fontSize: 13, marginBottom: 6 },
    submit: {
        backgroundColor: theme.colors.accent,
        borderRadius: theme.radius,
        paddingVertical: 15,
        alignItems: "center",
        marginTop: 10,
    },
    dim: { opacity: 0.7 },
    submitText: { color: "#fff", fontWeight: "700", fontSize: 15 },
    toggleRow: {
        flexDirection: "row",
        justifyContent: "center",
        gap: 5,
        paddingTop: 28,
    },
    toggleText: { color: theme.colors.muted, fontSize: 14 },
    toggleLink: { color: theme.colors.accent, fontSize: 14, fontWeight: "700" },
});
