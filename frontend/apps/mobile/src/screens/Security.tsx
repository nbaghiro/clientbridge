import { strings, useSecuritySettings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { Button, Loading, Notice, Panel, TextField } from "@clientbridge/ui";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";

import { identity } from "../lib/api";
import { getSession } from "../lib/auth";

const c = theme.colors;
const a = strings.auth;

const settingsOptions = {
    sessionToken: async () => (await getSession())?.session_token,
};

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
                <Panel title={a.securityReauthTitle} subtitle={a.securityReauthBody}>
                    <View style={styles.stack}>
                        {s.reauth.password ? (
                            <>
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
                            </>
                        ) : (
                            <Text style={styles.soft}>{a.securityReauthOnWeb}</Text>
                        )}
                    </View>
                </Panel>
            ) : null}

            <Panel title={a.securityAccount} subtitle={a.securityEmailHint}>
                <View style={styles.stack}>
                    <TextField
                        label={a.name}
                        value={s.name}
                        onChange={s.setName}
                        autoComplete="name"
                    />
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
                </View>
            </Panel>

            <Panel title={a.securityPassword}>
                <View style={styles.stack}>
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
                </View>
            </Panel>

            <Panel title={a.securityTotp}>
                <View style={styles.stack}>
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
                </View>
            </Panel>

            <Panel title={a.securityBackupCodes} subtitle={a.securityBackupCodesHint}>
                <View style={styles.stack}>
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
                                <Button
                                    variant="danger"
                                    busy={s.busy}
                                    onPress={s.disableBackupCodes}
                                >
                                    {a.securityTurnOff}
                                </Button>
                            ) : null}
                        </>
                    )}
                </View>
            </Panel>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    body: { padding: 16, paddingBottom: 32, gap: 14 },
    stack: { gap: 10 },
    soft: { color: c.inkSoft, fontSize: 14, lineHeight: 20 },
    mono: { color: c.ink, fontSize: 13, fontFamily: "monospace", lineHeight: 20 },
    qr: { width: 176, height: 176, borderRadius: theme.radius },
});
