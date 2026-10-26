import { type SheetHeaderProps, strings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "./Button";
import type { NativeProps } from "./props";

const c = theme.colors;

export function SheetHeader({
    title,
    subtitle,
    onClose,
    closeLabel,
    actions,
    style,
}: NativeProps<SheetHeaderProps>) {
    return (
        <View style={[styles.head, style]}>
            <View style={styles.side}>
                {onClose !== undefined ? (
                    <Button variant="link" onPress={onClose}>
                        {closeLabel ?? strings.common.cancel}
                    </Button>
                ) : null}
            </View>
            <View style={styles.text}>
                <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
                    {title}
                </Text>
                {subtitle !== undefined ? (
                    <Text style={styles.subtitle} numberOfLines={1}>
                        {subtitle}
                    </Text>
                ) : null}
            </View>
            <View style={[styles.side, styles.right]}>{actions}</View>
        </View>
    );
}

const styles = StyleSheet.create({
    head: {
        flexDirection: "row",
        alignItems: "center",
        paddingBottom: 8,
        marginBottom: 4,
        borderBottomColor: c.borderSoft,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    side: { width: 84, flexDirection: "row" },
    right: { justifyContent: "flex-end" },
    text: { flex: 1, minWidth: 0, alignItems: "center" },
    title: {
        color: c.ink,
        fontFamily: theme.fonts.display,
        fontSize: theme.type.section,
        fontWeight: "700",
    },
    subtitle: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 12, marginTop: 1 },
});
