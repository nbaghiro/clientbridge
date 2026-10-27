import type { PageFrameProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTabletLayout } from "./layout";
import type { NativeProps } from "./props";

// Phone screens run edge to edge; from tablet width they sit in a centred card with margins all round.
export function PageFrame({ leading, children, style }: NativeProps<PageFrameProps>) {
    const tablet = useTabletLayout();
    if (!tablet)
        return (
            <View style={[styles.page, style]}>
                {leading}
                <View style={styles.fill}>{children}</View>
            </View>
        );
    return (
        <SafeAreaView edges={["top", "bottom"]} style={[styles.page, style]}>
            {leading}
            <View style={styles.gutter}>
                <View style={styles.frame}>{children}</View>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    page: { flex: 1 },
    fill: { flex: 1 },
    gutter: { flex: 1, padding: theme.layout.gutter / 2 },
    frame: {
        flex: 1,
        width: "100%",
        maxWidth: theme.layout.frame,
        alignSelf: "center",
        borderRadius: theme.radius,
        overflow: "hidden",
    },
});
