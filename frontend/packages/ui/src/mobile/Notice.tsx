import type { NoticeProps, NoticeTone } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { NativeProps } from "./props";
import { useReveal } from "./reveal";

const c = theme.colors;

const LINE: Record<NoticeTone, string> = { danger: c.danFg, success: c.okFg, info: c.muted };
const BOX: Record<NoticeTone, { bg: string; fg: string }> = {
    danger: { bg: c.danBg, fg: c.danFg },
    success: { bg: c.okBg, fg: c.okFg },
    info: { bg: c.accentWeak, fg: c.accentStrong },
};

export function Notice({ tone, banner = false, children, style }: NativeProps<NoticeProps>) {
    const role = tone === "danger" ? "alert" : "text";
    const reveal = useReveal();
    const line = useRef<Text>(null);
    const box = useRef<View>(null);
    useEffect(() => {
        const target = line.current ?? box.current;
        // an error usually lands at the end of a sheet, below the fold
        if (tone === "danger" && reveal !== null && target !== null) reveal(target);
    }, [tone, reveal, children]);
    if (!banner) {
        return (
            <Text
                ref={line}
                accessibilityRole={role}
                style={[styles.line, { color: LINE[tone] }, style]}
            >
                {children}
            </Text>
        );
    }
    return (
        <View
            ref={box}
            accessibilityRole={role}
            style={[styles.box, { backgroundColor: BOX[tone].bg }, style]}
        >
            <Text style={[styles.boxText, { color: BOX[tone].fg }]}>{children}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    line: { fontFamily: theme.fonts.ui, fontSize: 13, marginTop: 8, lineHeight: 18 },
    box: { borderRadius: theme.radius, paddingHorizontal: 12, paddingVertical: 10, marginTop: 10 },
    boxText: { fontFamily: theme.fonts.ui, fontSize: 13, lineHeight: 18 },
});
