import type { NoticeProps, NoticeTone } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, Text, View } from "react-native";

import type { NativeProps } from "./props";

const c = theme.colors;

const LINE: Record<NoticeTone, string> = { danger: c.danFg, success: c.okFg, info: c.muted };
const BOX: Record<NoticeTone, { bg: string; fg: string }> = {
    danger: { bg: c.danBg, fg: c.danFg },
    success: { bg: c.okBg, fg: c.okFg },
    info: { bg: c.accentWeak, fg: c.accentStrong },
};

export function Notice({ tone, banner = false, children, style }: NativeProps<NoticeProps>) {
    const role = tone === "danger" ? "alert" : "text";
    if (!banner) {
        return (
            <Text accessibilityRole={role} style={[styles.line, { color: LINE[tone] }, style]}>
                {children}
            </Text>
        );
    }
    return (
        <View
            accessibilityRole={role}
            style={[styles.box, { backgroundColor: BOX[tone].bg }, style]}
        >
            <Text style={[styles.boxText, { color: BOX[tone].fg }]}>{children}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    line: { fontSize: 13, marginTop: 8, lineHeight: 18 },
    box: { borderRadius: theme.radius, paddingHorizontal: 12, paddingVertical: 10, marginTop: 10 },
    boxText: { fontSize: 13, lineHeight: 18 },
});
