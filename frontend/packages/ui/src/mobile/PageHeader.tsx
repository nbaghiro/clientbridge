import type { PageHeaderProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { StyleSheet, Text, View } from "react-native";

const c = theme.colors;

export function PageHeader({ title, subtitle, actions, children }: PageHeaderProps) {
    return (
        <View>
            <View style={styles.row}>
                <View style={styles.text}>
                    <Text accessibilityRole="header" style={styles.title}>
                        {title}
                    </Text>
                    {subtitle !== undefined ? (
                        <Text style={styles.subtitle}>{subtitle}</Text>
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
    text: { flexShrink: 1 },
    title: { color: c.ink, fontSize: 26, fontWeight: "700", letterSpacing: -0.4 },
    subtitle: { color: c.muted, fontSize: 13, marginTop: 2 },
    actions: { flexDirection: "row", alignItems: "center", gap: 10 },
    below: { marginTop: 10 },
});
