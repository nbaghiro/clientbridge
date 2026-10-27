import type { IconName } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { Empty } from "@clientbridge/ui";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

const c = theme.colors;

// Tablet list and detail side by side, like Mail: the phone list and the open item as two cards.
export function SplitView({
    list,
    detail,
    icon,
    placeholder,
}: {
    list: ReactNode;
    detail: ReactNode;
    icon: IconName;
    placeholder: string | null;
}) {
    return (
        <View style={styles.split}>
            <View style={styles.list}>{list}</View>
            <View style={styles.detail}>
                {detail ??
                    (placeholder === null ? null : (
                        <View style={styles.pick}>
                            <Empty icon={icon} message={placeholder} />
                        </View>
                    ))}
            </View>
        </View>
    );
}

const card = {
    backgroundColor: c.surface,
    borderRadius: theme.radius,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    overflow: "hidden",
} as const;

const styles = StyleSheet.create({
    split: {
        flex: 1,
        flexDirection: "row",
        gap: 16,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 16,
    },
    list: { ...card, width: theme.layout.list },
    detail: { ...card, flex: 1, minWidth: 0 },
    pick: { flex: 1, alignItems: "center", justifyContent: "center" },
});
