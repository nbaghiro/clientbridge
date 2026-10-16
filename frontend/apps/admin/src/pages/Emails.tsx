import { useState } from "react";
import {
    adminLabel,
    strings,
    useAdminEmailForm,
    useAdminResource,
} from "@clientbridge/app-core/public";
import { Button, LoadFailed, Notice, Panel, Select, TextField } from "@clientbridge/ui";
import { config } from "../config";
import { Resource } from "../components/Records";

export function Emails() {
    const state = useAdminResource("AdminEmails", config.apiUrl, "emails");
    const [key, setKey] = useState("login-code");
    return (
        <Resource state={state}>
            {(items) => (
                <>
                    <Select
                        label={strings.admin.emailSample}
                        value={key}
                        onChange={setKey}
                        options={items.map((item) => ({ key: item.key, label: item.subject }))}
                    />
                    <EmailSample key={key} sample={key} />
                </>
            )}
        </Resource>
    );
}
function EmailSample({ sample }: { sample: string }) {
    const state = useAdminResource("AdminEmailPreview", config.apiUrl, `emails/${sample}`);
    const configuration = useAdminResource("AdminEmailConfig", config.apiUrl, "email-config");
    const form = useAdminEmailForm(config.apiUrl);
    const [selectedTransport, setTransport] = useState<"smtp" | "resend" | "">("");
    const transports = configuration.data?.email_transports ?? [];
    const transport = selectedTransport || transports[0];
    return (
        <>
            <Panel title={strings.admin.sendTest}>
                {configuration.error !== null ? (
                    <LoadFailed onRetry={configuration.refresh} />
                ) : null}
                <p className="text-sm text-muted">{strings.admin.testInfo}</p>
                <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-60 flex-1">
                        <TextField
                            type="email"
                            label={strings.admin.recipient}
                            value={form.recipient}
                            onChange={form.setRecipient}
                            disabled={form.busy || form.confirmed}
                        />
                    </div>
                    <Button
                        disabled={
                            !form.recipient.includes("@") ||
                            !transport ||
                            transports.length === 0 ||
                            form.busy
                        }
                        onPress={() => {
                            form.setConfirmed(true);
                        }}
                    >
                        {strings.admin.sendTest}
                    </Button>
                </div>
                <Select
                    label={strings.admin.emailTransport}
                    value={transport}
                    onChange={setTransport}
                    disabled={form.busy || form.confirmed}
                    options={transports.map((key) => ({ key, label: adminLabel(key) }))}
                />
                <p className="text-xs text-muted">{strings.admin.sendInfo}</p>
                {form.confirmed ? (
                    <div className="space-y-3 rounded-md border border-line p-4">
                        <p className="text-sm">{form.recipient}</p>
                        <p className="text-xs text-muted">{transport}</p>
                        <div className="flex gap-3">
                            <Button
                                busy={form.busy}
                                onPress={() => {
                                    if (transport === "smtp" || transport === "resend")
                                        form.send(sample, transport, crypto.randomUUID());
                                }}
                            >
                                {strings.admin.sendConfirm}
                            </Button>
                            <Button
                                variant="outline"
                                disabled={form.busy}
                                onPress={() => {
                                    form.setConfirmed(false);
                                }}
                            >
                                {strings.admin.cancel}
                            </Button>
                        </div>
                    </div>
                ) : null}
                {form.outcome ? (
                    <Notice tone={form.outcome === "accepted" ? "success" : "danger"}>
                        {form.outcome === "accepted"
                            ? strings.admin.testAccepted
                            : strings.admin.testFailed}
                    </Notice>
                ) : null}
                {configuration.data !== null && transports.length === 0 ? (
                    <Notice tone="info">{strings.admin.transportUnavailable}</Notice>
                ) : null}
            </Panel>
            <Resource state={state}>
                {(mail) => (
                    <Panel title={mail.subject}>
                        <iframe
                            title={strings.admin.preview}
                            sandbox=""
                            referrerPolicy="no-referrer"
                            srcDoc={mail.html}
                            className="h-[780px] w-full rounded-md border border-line bg-white"
                        />
                        <details>
                            <summary className="cursor-pointer text-sm text-muted">
                                {strings.admin.plainText}
                            </summary>
                            <pre className="whitespace-pre-wrap pt-4 text-sm">{mail.text}</pre>
                        </details>
                    </Panel>
                )}
            </Resource>
        </>
    );
}
