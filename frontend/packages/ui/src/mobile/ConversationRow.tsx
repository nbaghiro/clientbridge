import type { ConversationRowProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { Badge } from "./Badge";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Avatar } from "./Avatar";
import { Icon } from "./Icon";

const c = theme.colors;
const GLYPH = { sms: "phoneDevice", email: "mail", chat: "inbox" } as const;

export function ConversationRow({
    name,
    preview,
    at,
    unread,
    channel,
    channelLabel,
    active = false,
    flag,
    onPress,
}: ConversationRowProps) {
    const bold = unread > 0;
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={`${name}, ${channelLabel}, ${preview}`}
            style={({ pressed }) => [styles.row, (active || pressed) && styles.active]}
        >
            <Avatar name={name} size="lg" />
            <View style={styles.main}>
                <View style={styles.top}>
                    <Text style={[styles.name, bold && styles.bold]} numberOfLines={1}>
                        {name}
                    </Text>
                    <Text style={[styles.at, bold && styles.atUnread]}>{at}</Text>
                </View>
                <View style={styles.bottom}>
                    <Icon name={GLYPH[channel]} size={14} color={c.muted} />
                    <Text style={[styles.preview, bold && styles.previewUnread]} numberOfLines={2}>
                        {preview}
                    </Text>
                    {unread > 0 ? <Badge kind="count" label={unread} /> : null}
                </View>
                {flag !== undefined ? (
                    <View style={styles.flag}>
                        <Badge label={flag.label} intent={flag.intent} />
                    </View>
                ) : null}
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: "row",
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderBottomColor: c.borderSoft,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    active: { backgroundColor: c.accentWeak },
    main: { flex: 1, minWidth: 0 },
    top: { flexDirection: "row", alignItems: "center", gap: 8 },
    name: { flex: 1, color: c.ink, fontSize: 16, fontWeight: "600" },
    bold: { fontWeight: "700" },
    at: { color: c.muted, fontSize: 13 },
    atUnread: { color: c.accent, fontWeight: "600" },
    bottom: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 3 },
    preview: { flex: 1, color: c.muted, fontSize: 14, lineHeight: 19 },
    previewUnread: { color: c.inkSoft },
    flag: { flexDirection: "row", marginTop: 6 },
});
