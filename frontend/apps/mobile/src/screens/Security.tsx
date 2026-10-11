import { strings, useSecuritySettings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { Button, Loading, Notice, TextField } from "@clientbridge/ui";
import type { ReactNode } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";

import { identity } from "../lib/api";
import { getSession } from "../lib/auth";

const c = theme.colors;
const a = strings.auth;

const settingsOptions = {
    sessionToken: async () => (await getSession())?.session_token,
};

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
    return (
        <View style={styles.card}>
            <Text style={styles.cardTitle}>{title}</Text>
            {hint ? <Text style={styles.muted}>{hint}</Text> : null}
            {children}
        </View>
    );
}

/** Account, password, authenticator app and backup codes; security keys stay on the web. */
export function SecurityScreen() {
    const s = useSecuritySettings(identity, settingsOptions);

    if (!s.ready && s.error === null) return <Loading label={a.securityTitle} />;

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
            {s.notice !== null ? (
                <Notice tone="success" banner>
                    {s.notice}
                </Notice>
            ) : null}
            {s.error !== null ? (
                <Notice tone="danger" banner>
                    {s.error}
                </Notice>
            ) : null}

            {s.reauth ? (
                <Card title={a.securityReauthTitle} hint={a.securityReauthBody}>
                    <TextField
                        label={a.password}
                        type="password"
                        value={s.reauthPassword}
                        onChange={s.setReauthPassword}
                        onSubmit={s.confirmReauth}
                        autoComplete="current-password"
                    />
                    <Button busy={s.busy} onPress={s.confirmReauth}>
                        {a.confirm}
                    </Button>
                </Card>
            ) : null}

            <Card title={a.securityAccount} hint={a.securityEmailHint}>
                <TextField label={a.name} value={s.name} onChange={s.setName} autoComplete="name" />
                <TextField
                    label={a.email}
                    type="email"
                    value={s.email}
                    onChange={s.setEmail}
                    autoComplete="email"
                />
                <Button variant="outline" busy={s.busy} onPress={s.saveProfile}>
                    {a.securitySaveProfile}
                </Button>
            </Card>

            <Card title={a.securityPassword}>
                <TextField
                    label={a.securityNewPassword}
                    type="password"
                    value={s.newPassword}
                    onChange={s.setNewPassword}
                    onSubmit={s.savePassword}
                    autoComplete="new-password"
                    hint={a.passwordHint}
                />
                <Button variant="outline" busy={s.busy} onPress={s.savePassword}>
                    {a.securityChangePassword}
                </Button>
            </Card>

            <Card title={a.securityTotp}>
                {s.totp.enabled ? (
                    <>
                        <Text style={styles.soft}>{a.securityTotpOn}</Text>
                        <Button variant="danger" busy={s.busy} onPress={s.disableTotp}>
                            {a.securityTurnOff}
                        </Button>
                    </>
                ) : (
                    <>
                        <Text style={styles.soft}>{a.securityTotpSetup}</Text>
                        {s.totp.qr !== null ? (
                            <Image
                                source={{ uri: s.totp.qr }}
                                style={styles.qr}
                                accessibilityLabel={a.securityTotpQr}
                            />
                        ) : null}
                        {s.totp.secret !== null ? (
                            <Text selectable style={styles.mono}>
                                {a.securityTotpSecret(s.totp.secret)}
                            </Text>
                        ) : null}
                        <TextField
                            label={a.code}
                            value={s.totpCode}
                            onChange={s.setTotpCode}
                            onSubmit={s.enableTotp}
                            placeholder={a.codePlaceholder}
                            autoComplete="one-time-code"
                        />
                        <Button busy={s.busy} onPress={s.enableTotp}>
                            {a.securityTurnOn}
                        </Button>
                    </>
                )}
            </Card>

            <Card title={a.securityBackupCodes} hint={a.securityBackupCodesHint}>
                {s.backupCodes.codes !== null ? (
                    <Text selectable style={styles.mono}>
                        {s.backupCodes.codes.join("   ")}
                    </Text>
                ) : null}
                {s.backupCodes.unconfirmed ? (
                    <Button busy={s.busy} onPress={s.confirmBackupCodes}>
                        {a.securityConfirmCodes}
                    </Button>
                ) : (
                    <>
                        {s.backupCodes.enabled && s.backupCodes.codes === null ? (
                            <Button variant="outline" busy={s.busy} onPress={s.showBackupCodes}>
                                {a.securityShowCodes}
                            </Button>
                        ) : null}
                        <Button variant="outline" busy={s.busy} onPress={s.newBackupCodes}>
                            {a.securityNewCodes}
                        </Button>
                        {s.backupCodes.enabled ? (
                            <Button variant="danger" busy={s.busy} onPress={s.disableBackupCodes}>
                                {a.securityTurnOff}
                            </Button>
                        ) : null}
                    </>
                )}
            </Card>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    body: { padding: 16, paddingBottom: 32, gap: 14 },
    card: {
        backgroundColor: c.surface,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        padding: 16,
        gap: 10,
    },
    cardTitle: { color: c.ink, fontSize: 16, fontWeight: "700" },
    muted: { color: c.muted, fontSize: 13 },
    soft: { color: c.inkSoft, fontSize: 14, lineHeight: 20 },
    mono: { color: c.ink, fontSize: 13, fontFamily: "monospace", lineHeight: 20 },
    qr: { width: 176, height: 176, borderRadius: theme.radius },
});
