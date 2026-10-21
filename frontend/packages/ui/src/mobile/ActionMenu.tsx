import { type ActionMenuItem, type ActionMenuProps, strings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { useEffect, useRef } from "react";
import {
    Animated,
    Easing,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    View,
    useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "./Icon";
import type { NativeProps } from "./props";

const c = theme.colors;
const CHIP = 60;
const DEGREE = Math.PI / 180;

// an even half-circle of chips, tightened for short menus
function fan(count: number, radius: number): { dx: number; dy: number }[] {
    const span = count > 5 ? 180 : 150;
    return Array.from({ length: count }, (_, k) => {
        const angle = (90 + span / 2 - ((k + 0.5) * span) / count) * DEGREE;
        return { dx: radius * Math.cos(angle), dy: -radius * Math.sin(angle) };
    });
}

export function ActionMenu({
    open,
    onClose,
    title,
    items,
    onSelect,
    layout = "list",
    footer,
    anchor,
    style,
}: NativeProps<ActionMenuProps>) {
    const insets = useSafeAreaInsets();
    if (layout === "radial" && anchor !== undefined)
        return (
            <RadialMenu
                open={open}
                onClose={onClose}
                items={items}
                onSelect={onSelect}
                anchor={anchor}
            />
        );
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
                                        size={layout === "grid" ? 26 : 22}
                                        color={c.inkSoft}
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

function RadialMenu({
    open,
    onClose,
    items,
    onSelect,
    anchor,
}: {
    open: boolean;
    onClose: () => void;
    items: readonly ActionMenuItem[];
    onSelect: (key: string) => void;
    anchor: { x: number; y: number };
}) {
    const { width } = useWindowDimensions();
    const progress = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        if (!open) {
            progress.setValue(0);
            return;
        }
        Animated.timing(progress, {
            toValue: 1,
            duration: 220,
            easing: Easing.out(Easing.back(1.4)),
            useNativeDriver: true,
        }).start();
    }, [open, progress]);
    const spots = fan(items.length, Math.min(150, width / 2 - CHIP / 2 - 8));
    const turn = progress.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "45deg"] });
    return (
        <Modal
            visible={open}
            transparent
            statusBarTranslucent
            animationType="fade"
            onRequestClose={onClose}
        >
            <Pressable
                style={[styles.backdrop, styles.dim]}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={strings.common.close}
            />
            {items.map((item, i) => {
                const { dx, dy } = spots[i] ?? { dx: 0, dy: 0 };
                return (
                    <Animated.View
                        key={item.key}
                        style={[
                            styles.spoke,
                            {
                                left: anchor.x - CHIP / 2,
                                top: anchor.y - CHIP / 2,
                                opacity: progress,
                                transform: [
                                    {
                                        translateX: progress.interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [0, dx],
                                        }),
                                    },
                                    {
                                        translateY: progress.interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [0, dy],
                                        }),
                                    },
                                    {
                                        scale: progress.interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [0.3, 1],
                                        }),
                                    },
                                ],
                            },
                        ]}
                    >
                        <Pressable
                            accessibilityRole="menuitem"
                            accessibilityLabel={item.label}
                            accessibilityHint={item.hint}
                            onPress={() => {
                                onSelect(item.key);
                            }}
                            style={({ pressed }) => [styles.round, pressed && styles.roundPressed]}
                        >
                            <Icon name={item.icon} size={20} color={c.accent} />
                            <Text style={styles.roundLabel} numberOfLines={1} adjustsFontSizeToFit>
                                {item.label}
                            </Text>
                        </Pressable>
                    </Animated.View>
                );
            })}
            <Pressable
                style={[styles.dismiss, { left: anchor.x - 26, top: anchor.y - 26 }]}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={strings.common.close}
            >
                <Animated.View style={{ transform: [{ rotate: turn }] }}>
                    <Icon name="plus" size={26} color={c.surface} />
                </Animated.View>
            </Pressable>
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
    tileIcon: { height: 36, alignItems: "center", justifyContent: "center" },
    tileLabel: { color: c.ink, fontSize: 13, fontWeight: "600" },
    row: {
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingVertical: 11,
        paddingHorizontal: 4,
        borderRadius: theme.radius,
    },
    rowIcon: { width: 24, alignItems: "center" },
    rowText: { flex: 1 },
    rowLabel: { color: c.ink, fontSize: 16, fontWeight: "600" },
    rowHint: { color: c.muted, fontSize: 13, marginTop: 1 },
    pressed: { backgroundColor: c.bg },
    dim: { backgroundColor: c.ink, opacity: 0.5 },
    spoke: { position: "absolute" },
    round: {
        width: CHIP,
        height: CHIP,
        borderRadius: CHIP / 2,
        backgroundColor: c.surface,
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        paddingHorizontal: 5,
        shadowColor: c.ink,
        shadowOpacity: 0.18,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        elevation: 4,
    },
    roundPressed: { backgroundColor: c.bg },
    roundLabel: { color: c.inkSoft, fontSize: 10, fontWeight: "600" },
    dismiss: {
        position: "absolute",
        width: 52,
        height: 52,
        borderRadius: 26,
        backgroundColor: c.accent,
        alignItems: "center",
        justifyContent: "center",
    },
    footer: {
        marginTop: 8,
        borderTopColor: c.borderSoft,
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingTop: 8,
    },
});
