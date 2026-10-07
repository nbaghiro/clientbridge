import { strings, useSendToClient } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { Button, Modal, Notice, Select } from "@clientbridge/ui";
import { StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";

const c = theme.colors;
const s = strings.forms;

/** Sends one form or contract link to a client picked from the client book. */
export function SendToClientSheet({
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
            <View style={styles.sheet}>
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.body}>{s.sendBody}</Text>
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
                <View style={styles.actions}>
                    <View style={styles.flex}>
                        <Button full variant="outline" onPress={onClose}>
                            {send.sentTo !== null ? s.done : s.cancel}
                        </Button>
                    </View>
                    <View style={styles.flex}>
                        <Button
                            full
                            busy={send.busy}
                            disabled={send.sentTo !== null}
                            onPress={send.send}
                        >
                            {s.sendLink}
                        </Button>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    sheet: { gap: 14 },
    title: { color: c.ink, fontSize: 18, fontWeight: "700" },
    body: { color: c.inkSoft, fontSize: 14, lineHeight: 20 },
    actions: { flexDirection: "row", gap: 10 },
    flex: { flex: 1 },
});
