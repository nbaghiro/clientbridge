import { type ActionMenuProps, strings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "./Icon";
import type { NativeProps } from "./props";

const c = theme.colors;

export function ActionMenu({
    open,
    onClose,
    title,
    items,
    onSelect,
    layout = "list",
    footer,
    style,
}: NativeProps<ActionMenuProps>) {
    const insets = useSafeAreaInsets();
    return (
        <Modal
            style={style}
            visible={open}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <View style={styles.root}>
                <Pressable
                    style={styles.backdrop}
                    onPress={onClose}
                    accessibilityRole="button"
                    accessibilityLabel={strings.common.close}
                />
                <View
                    style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}
                    accessibilityViewIsModal
                >
                    <View style={styles.grabber} />
                    {title !== undefined ? (
                        <Text style={styles.title} accessibilityRole="header">
                            {title}
                        </Text>
                    ) : null}
                    <View style={layout === "grid" ? styles.grid : undefined}>
                        {items.map((item) => (
                            <Pressable
                                key={item.key}
                                accessibilityRole="menuitem"
                                accessibilityLabel={item.label}
                                accessibilityHint={item.hint}
                                onPress={() => {
                                    onSelect(item.key);
                                }}
                                style={({ pressed }) => [
                                    layout === "grid" ? styles.tile : styles.row,
                                    pressed && styles.pressed,
                                ]}
                            >
                                <View style={layout === "grid" ? styles.tileIcon : styles.rowIcon}>
                                    <Icon
                                        name={item.icon}
                                        size={layout === "grid" ? 22 : 19}
                                        color={c.accent}
                                    />
                                </View>
                                {layout === "grid" ? (
                                    <Text style={styles.tileLabel} numberOfLines={1}>
                                        {item.label}
                                    </Text>
                                ) : (
                                    <View style={styles.rowText}>
                                        <Text style={styles.rowLabel}>{item.label}</Text>
                                        {item.hint !== undefined ? (
                                            <Text style={styles.rowHint} numberOfLines={1}>
                                                {item.hint}
                                            </Text>
                                        ) : null}
                                    </View>
                                )}
                            </Pressable>
                        ))}
                    </View>
                    {footer !== undefined ? <View style={styles.footer}>{footer}</View> : null}
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, justifyContent: "flex-end" },
    backdrop: {
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: c.scrim,
    },
    sheet: {
        backgroundColor: c.surface,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingHorizontal: 16,
        paddingTop: 8,
    },
    grabber: {
        alignSelf: "center",
        width: 36,
        height: 5,
        borderRadius: 3,
        backgroundColor: c.border,
        marginBottom: 10,
    },
    title: {
        color: c.muted,
        fontSize: 12,
        fontWeight: "700",
        letterSpacing: 0.5,
        textTransform: "uppercase",
        marginBottom: 6,
        marginLeft: 4,
    },
    grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -4 },
    tile: {
        width: "33.333%",
        alignItems: "center",
        gap: 8,
        paddingVertical: 12,
        paddingHorizontal: 4,
        borderRadius: theme.radius,
    },
    tileIcon: {
        width: 52,
        height: 52,
        borderRadius: 16,
        backgroundColor: c.accentWeak,
        alignItems: "center",
        justifyContent: "center",
    },
    tileLabel: { color: c.ink, fontSize: 13, fontWeight: "600" },
    row: {
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingVertical: 11,
        paddingHorizontal: 4,
        borderRadius: theme.radius,
    },
    rowIcon: {
        width: 38,
        height: 38,
        borderRadius: 10,
        backgroundColor: c.accentWeak,
        alignItems: "center",
        justifyContent: "center",
    },
    rowText: { flex: 1 },
    rowLabel: { color: c.ink, fontSize: 16, fontWeight: "600" },
    rowHint: { color: c.muted, fontSize: 13, marginTop: 1 },
    pressed: { backgroundColor: c.bg },
    footer: {
        marginTop: 8,
        borderTopColor: c.borderSoft,
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingTop: 8,
    },
});
