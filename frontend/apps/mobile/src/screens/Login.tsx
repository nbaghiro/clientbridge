import { theme } from "@clientbridge/tokens/theme";
import { StatusBar } from "expo-status-bar";
import { type ComponentProps, useState } from "react";
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
import { type TokenPair, setTokens } from "../lib/auth";

type Mode = "signin" | "signup";

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
    const [mode, setMode] = useState<Mode>("signin");
    const [name, setName] = useState("");
    const [email, setEmail] = useState("hannah@birchbarkpets.ca");
    const [password, setPassword] = useState("demo1234");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const submit = async (): Promise<void> => {
        setBusy(true);
        setError(null);
        try {
            const tokens =
                mode === "signin"
                    ? await api.post<TokenPair>("/auth/login", { email, password })
                    : await api.post<TokenPair>("/auth/register", { email, password, name });
            await setTokens(tokens);
            onSuccess();
        } catch {
            setError(
                mode === "signin"
                    ? "Invalid email or password"
                    : "Could not create that account — try another email",
            );
            setBusy(false);
        }
    };

    const onGoogle = (): void => {
        setError("Google sign-in isn’t configured in this build yet — use email & password.");
    };

    const flip = (): void => {
        setMode(mode === "signin" ? "signup" : "signin");
        setError(null);
    };

    const signin = mode === "signin";

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
                            {signin ? "Sign in" : "Create your account"}
                        </Text>
                        <Text style={styles.subtitle}>
                            {signin ? "Welcome back." : "Start running your practice in minutes."}
                        </Text>

                        {signin ? null : (
                            <Field
                                label="Name"
                                value={name}
                                onChangeText={setName}
                                placeholder="Hannah Bauer"
                                autoComplete="name"
                            />
                        )}
                        <Field
                            label="Email"
                            value={email}
                            onChangeText={setEmail}
                            placeholder="you@example.com"
                            autoCapitalize="none"
                            keyboardType="email-address"
                            autoComplete="email"
                        />
                        <Field
                            label="Password"
                            value={password}
                            onChangeText={setPassword}
                            placeholder="••••••••"
                            secureTextEntry
                            autoComplete={signin ? "current-password" : "new-password"}
                            onSubmitEditing={() => void submit()}
                        />

                        {error ? <Text style={styles.error}>{error}</Text> : null}

                        <Pressable
                            style={({ pressed }) => [
                                styles.submit,
                                (busy || pressed) && styles.dim,
                            ]}
                            onPress={() => void submit()}
                            disabled={busy}
                        >
                            {busy ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <Text style={styles.submitText}>
                                    {signin ? "Sign in" : "Create account"}
                                </Text>
                            )}
                        </Pressable>

                        <View style={styles.divider}>
                            <View style={styles.line} />
                            <Text style={styles.or}>or</Text>
                            <View style={styles.line} />
                        </View>

                        <Pressable style={styles.google} onPress={onGoogle}>
                            <GoogleIcon size={20} />
                            <Text style={styles.googleText}>Continue with Google</Text>
                        </Pressable>
                    </View>

                    <View style={styles.toggleRow}>
                        <Text style={styles.toggleText}>
                            {signin ? "New to Clientbridge?" : "Already have an account?"}
                        </Text>
                        <Pressable onPress={flip} hitSlop={8}>
                            <Text style={styles.toggleLink}>
                                {signin ? "Create an account" : "Sign in"}
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
