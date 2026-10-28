import type { PageHeaderProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, Text, View } from "react-native";

import type { NativeProps } from "./props";

const c = theme.colors;

export function PageHeader({
    title,
    subtitle,
    leading,
    actions,
    children,
    style,
}: NativeProps<PageHeaderProps>) {
    return (
        <View style={style}>
            <View style={styles.row}>
                <View style={styles.text}>
                    {leading}
                    <Text
                        accessibilityRole="header"
                        numberOfLines={2}
                        adjustsFontSizeToFit
                        minimumFontScale={0.8}
                        style={styles.title}
                    >
                        {title}
                    </Text>
                    {subtitle !== undefined ? (
                        <Text style={styles.subtitle} numberOfLines={1}>
                            {subtitle}
                        </Text>
                    ) : null}
                </View>
                {actions !== undefined ? <View style={styles.actions}>{actions}</View> : null}
            </View>
            {children !== undefined ? <View style={styles.below}>{children}</View> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
    text: { flex: 1, minWidth: 0 },
    title: {
        color: c.ink,
        fontFamily: theme.fonts.display,
        fontSize: theme.type.page,
        fontWeight: "700",
        letterSpacing: -0.4,
    },
    subtitle: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 13, marginTop: 2 },
    actions: { flexDirection: "row", alignItems: "center", gap: 4 },
    below: { marginTop: 10 },
});
