import { strings, useSecuritySettings } from "@clientbridge/app-core";
import { Button, Field, Loading, Notice, PageHeader, Panel, TextField } from "@clientbridge/ui";

import { PersonPhoto } from "../components/PersonPhoto";
import { api, identity } from "../lib/api";
import { getUserId } from "../lib/auth";
import { leave } from "../lib/powersync";
import { webauthn } from "../lib/webauthn";

const a = strings.auth;

/** Account email and name, password, and second factors, all kept in the auth service. */
export function Security() {
    const userId = getUserId();
    const s = useSecuritySettings(identity, {
        api,
        ...(webauthn ? { webauthn } : {}),
        returnTo: `${window.location.origin}/setup/security`,
        openUrl: (url) => leave(url).then(() => null),
    });

    const header = <PageHeader title={strings.navigation.setupSections.security} />;
    if (!s.ready && s.error === null)
        return (
            <div className="space-y-6">
                {header}
                <Loading label={a.securityTitle} />
            </div>
        );

    return (
        <div className="space-y-6">
            {header}
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
                    {s.reauth.password ? (
                        <div className="flex items-end gap-3">
                            <TextField
                                label={a.password}
                                type="password"
                                value={s.reauthPassword}
                                onChange={s.setReauthPassword}
                                onSubmit={s.confirmReauth}
                                autoComplete="current-password"
                                autoFocus
                            />
                            <Button busy={s.busy} onPress={s.confirmReauth}>
                                {a.confirm}
                            </Button>
                        </div>
                    ) : null}
                    {s.reauth.google ? (
                        <div>
                            <Button variant="outline" busy={s.busy} onPress={s.reauthWithGoogle}>
                                {a.continueWithGoogle}
                            </Button>
                        </div>
                    ) : null}
                </Panel>
            ) : null}

            <Panel
                title={a.securityAccount}
                subtitle={a.securityEmailHint}
                footer={
                    <Button variant="outline" busy={s.busy} onPress={s.saveProfile}>
                        {a.securitySaveProfile}
                    </Button>
                }
            >
                {userId !== null ? (
                    <PersonPhoto owner={{ kind: "user", id: userId }} name={s.name} />
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
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
                </div>
            </Panel>

            <Panel title={a.securityPassword}>
                <Field label={a.securityNewPassword} hint={a.passwordHint}>
                    <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                            <TextField
                                name={a.securityNewPassword}
                                type="password"
                                value={s.newPassword}
                                onChange={s.setNewPassword}
                                onSubmit={s.savePassword}
                                autoComplete="new-password"
                            />
                        </div>
                        <Button variant="outline" busy={s.busy} onPress={s.savePassword}>
                            {a.securityChangePassword}
                        </Button>
                    </div>
                </Field>
            </Panel>

            <Panel title={a.securityTotp}>
                {s.totp.enabled ? (
                    <div className="flex items-center justify-between gap-3">
                        <p className="text-sm text-ink-soft">{a.securityTotpOn}</p>
                        <Button variant="danger" busy={s.busy} onPress={s.disableTotp}>
                            {a.securityTurnOff}
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <p className="text-sm text-ink-soft">{a.securityTotpSetup}</p>
                        {s.totp.qr !== null ? (
                            <img
                                src={s.totp.qr}
                                alt={a.securityTotpQr}
                                className="h-40 w-40 rounded-md border border-line"
                            />
                        ) : null}
                        {s.totp.secret !== null ? (
                            <p className="break-all font-mono text-xs text-muted">
                                {a.securityTotpSecret(s.totp.secret)}
                            </p>
                        ) : null}
                        <div className="flex items-end gap-3">
                            <TextField
                                label={a.code}
                                value={s.totpCode}
                                onChange={s.setTotpCode}
                                onSubmit={s.enableTotp}
                                placeholder={a.codePlaceholder}
                                autoComplete="one-time-code"
                                width="narrow"
                            />
                            <Button busy={s.busy} onPress={s.enableTotp}>
                                {a.securityTurnOn}
                            </Button>
                        </div>
                    </div>
                )}
            </Panel>

            <Panel title={a.securityBackupCodes} subtitle={a.securityBackupCodesHint}>
                {s.backupCodes.codes !== null ? (
                    <ul className="grid grid-cols-2 gap-1 font-mono text-sm text-ink sm:grid-cols-3">
                        {s.backupCodes.codes.map((code) => (
                            <li key={code}>{code}</li>
                        ))}
                    </ul>
                ) : null}
                <div className="flex flex-wrap gap-2">
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
                </div>
            </Panel>

            {s.keys !== null ? (
                <Panel title={a.securityKeys} subtitle={a.securityKeysHint}>
                    {s.keys.length === 0 ? (
                        <p className="text-sm text-muted">{a.securityNoKeys}</p>
                    ) : (
                        <ul className="divide-y divide-line-soft">
                            {s.keys.map((key) => (
                                <li key={key.id} className="flex items-center justify-between py-2">
                                    <span className="text-sm text-ink">{key.name}</span>
                                    <Button
                                        variant="link"
                                        onPress={() => {
                                            s.removeKey(key.id);
                                        }}
                                    >
                                        {a.securityRemoveKey(key.name)}
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    )}
                    <div className="flex items-end gap-3">
                        <TextField
                            label={a.securityKeyName}
                            value={s.keyName}
                            onChange={s.setKeyName}
                            placeholder={a.securityKeyNamePlaceholder}
                            error={s.keyNameError}
                        />
                        <Button variant="outline" busy={s.busy} onPress={s.addKey}>
                            {a.securityAddKey}
                        </Button>
                    </div>
                </Panel>
            ) : null}
        </div>
    );
}
