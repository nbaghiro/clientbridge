import { strings, useSendToClient } from "@clientbridge/app-core";
import { Button, Modal, Notice, Select } from "@clientbridge/ui";

import { api } from "../lib/api";

const s = strings.forms;

/** Sends one form or contract link to a client picked from the client book. */
export function SendToClientDialog({
    title,
    path,
    body,
    onClose,
}: {
    title: string;
    path: "/v1/forms/send" | "/v1/contracts/send";
    body: Record<string, string>;
    onClose: () => void;
}) {
    const send = useSendToClient(api, path, body);
    return (
        <Modal open onClose={onClose}>
            <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
            <p className="mt-1 text-sm text-muted">{s.sendBody}</p>
            <div className="mt-4 space-y-3">
                <Select
                    label={s.client}
                    value={send.clientId}
                    options={[{ key: "", label: s.chooseClient }, ...send.clients]}
                    onChange={send.setClientId}
                />
                {send.sentTo !== null ? (
                    <Notice tone="success">{s.sent(send.sentTo)}</Notice>
                ) : null}
                {send.error !== null ? <Notice tone="danger">{send.error}</Notice> : null}
                <div className="flex justify-end gap-2 pt-1">
                    <Button variant="quiet" onPress={onClose}>
                        {send.sentTo !== null ? s.done : s.cancel}
                    </Button>
                    <Button
                        icon="send"
                        busy={send.busy}
                        disabled={send.sentTo !== null}
                        onPress={send.send}
                    >
                        {s.sendLink}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
