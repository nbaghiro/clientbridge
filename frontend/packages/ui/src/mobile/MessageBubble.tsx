import type { MessageBubbleProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, Text, View } from "react-native";

const c = theme.colors;

export function MessageBubble({
    body,
    direction,
    meta,
    kind = "message",
    failed = false,
    fill = false,
}: MessageBubbleProps) {
    if (kind === "event") {
        return (
            <View style={styles.eventWrap}>
                <Text style={styles.event}>{body}</Text>
            </View>
        );
    }
    const out = direction === "out";
    return (
        <View style={[styles.row, out ? styles.right : styles.left, fill && styles.fill]}>
            <View style={[styles.bubble, out ? (failed ? styles.failed : styles.out) : styles.in]}>
                <Text
                    style={[
                        styles.body,
                        out && !failed ? styles.outText : failed ? styles.failedText : null,
                    ]}
                >
                    {body}
                </Text>
            </View>
            {meta !== undefined ? <Text style={styles.meta}>{meta}</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    row: { maxWidth: "80%", marginBottom: 10 },
    fill: { maxWidth: "100%" },
    left: { alignSelf: "flex-start", alignItems: "flex-start" },
    right: { alignSelf: "flex-end", alignItems: "flex-end" },
    bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
    in: {
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: c.border,
        borderBottomLeftRadius: 6,
    },
    out: { backgroundColor: c.accent, borderBottomRightRadius: 6 },
    failed: { backgroundColor: c.danBg, borderBottomRightRadius: 6 },
    body: { color: c.ink, fontSize: 15, lineHeight: 21 },
    outText: { color: c.accentInk },
    failedText: { color: c.danFg },
    meta: { color: c.muted, fontSize: 11, marginTop: 4, paddingHorizontal: 4 },
    eventWrap: {
        alignSelf: "center",
        backgroundColor: c.surface2,
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 5,
        marginVertical: 8,
        maxWidth: "90%",
    },
    event: { color: c.muted, fontSize: 12, textAlign: "center" },
});
