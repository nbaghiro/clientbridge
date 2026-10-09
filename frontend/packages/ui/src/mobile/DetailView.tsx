import { type DetailSectionProps, type DetailViewProps, strings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { useEffect, useRef } from "react";
import { Keyboard, ScrollView, StyleSheet, Text, View } from "react-native";

import { IconButton } from "./IconButton";
import { Modal, useModalFlow } from "./Modal";
import type { NativeProps } from "./props";
import { StatusPill } from "./StatusPill";

const c = theme.colors;

export function DetailView({
    open,
    title,
    subtitle,
    status,
    leading,
    onClose,
    actions,
    children,
    style,
}: NativeProps<DetailViewProps>) {
    const inFlow = useModalFlow();
    const body = useRef<ScrollView>(null);
    const scrollOffset = useRef(0);
    const scrolling = useRef(false);
    const restoreScroll = () =>
        body.current?.scrollTo({ y: scrollOffset.current, animated: false });

    useEffect(() => {
        scrolling.current = false;
        if (!open) return;
        const frame = requestAnimationFrame(restoreScroll);
        const keyboard = Keyboard.addListener("keyboardDidHide", restoreScroll);
        return () => {
            cancelAnimationFrame(frame);
            keyboard.remove();
        };
    }, [open]);

    return (
        <Modal style={style} open={open} onClose={onClose} framed={false}>
            <View style={[styles.frame, inFlow && styles.flowFrame]}>
                <View style={styles.head}>
                    <View style={styles.headMain}>
                        {leading}
                        <View style={styles.headText}>
                            <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
                                {title}
                            </Text>
                            {subtitle !== undefined ? (
                                <Text style={styles.subtitle} numberOfLines={1}>
                                    {subtitle}
                                </Text>
                            ) : null}
                        </View>
                    </View>
                    {status !== undefined ? (
                        <StatusPill
                            style={{ alignSelf: "center" }}
                            status={status.status}
                            intent={status.intent}
                            asWritten
                        />
                    ) : null}
                    <IconButton
                        icon="x"
                        label={strings.common.close}
                        onPress={onClose}
                        style={styles.close}
                    />
                </View>
                <ScrollView
                    ref={body}
                    onLayout={() => {
                        if (open) restoreScroll();
                    }}
                    onScrollBeginDrag={() => {
                        scrolling.current = true;
                    }}
                    onScroll={(event) => {
                        if (open && scrolling.current)
                            scrollOffset.current = event.nativeEvent.contentOffset.y;
                    }}
                    scrollEventThrottle={16}
                    style={styles.body}
                    contentContainerStyle={styles.bodyContent}
                    keyboardShouldPersistTaps="handled"
                >
                    {children}
                </ScrollView>
                {actions !== undefined && actions !== null ? (
                    <View style={styles.footer}>{actions}</View>
                ) : null}
            </View>
        </Modal>
    );
}

export function DetailSection({ title, action, children, style }: NativeProps<DetailSectionProps>) {
    return (
        <View style={[styles.section, style]}>
            {title !== undefined || action !== undefined ? (
                <View style={styles.sectionHead}>
                    {title !== undefined ? (
                        <Text style={styles.sectionLabel}>{title}</Text>
                    ) : (
                        <View />
                    )}
                    {action}
                </View>
            ) : null}
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    frame: {
        flexShrink: 1,
        backgroundColor: c.surface,
        padding: 22,
        paddingBottom: 36,
    },
    flowFrame: { flex: 1, minHeight: 0 },
    head: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 12,
    },
    headMain: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
    headText: { flex: 1 },
    title: { color: c.ink, fontSize: 18, fontWeight: "700" },
    subtitle: { color: c.muted, fontSize: 13, marginTop: 2 },
    body: { flexGrow: 0, flexShrink: 1 },
    bodyContent: { paddingBottom: 20 },
    footer: {
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 8,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: c.border,
        paddingTop: 16,
    },
    close: { width: 44, height: 44 },
    section: { marginTop: 14 },
    sectionHead: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 4,
    },
    sectionLabel: {
        color: c.muted,
        fontSize: 11,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
});
