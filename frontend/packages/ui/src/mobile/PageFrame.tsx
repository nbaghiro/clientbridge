import type { PageFrameProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Backdrop, BackdropDrawn } from "./Backdrop";
import { useTabletLayout } from "./layout";
import type { NativeProps } from "./props";

// Phone screens run edge to edge; on a tablet they sit in a centred card, the corner art at the window's corner.
export function PageFrame({ leading, size = "lg", children, style }: NativeProps<PageFrameProps>) {
    if (!useTabletLayout())
        return (
            <View style={[styles.page, style]}>
                {leading}
                <View style={styles.page}>{children}</View>
            </View>
        );
    return (
        <SafeAreaView edges={["top"]} style={[styles.page, style]}>
            <Backdrop size="lg" />
            <Backdrop corner="bottomLeft" size="lg" />
            <Backdrop corner="bottomRight" size="sm" />
            {leading}
            <View style={[styles.frame, size === "md" && styles.md]}>
                <BackdropDrawn.Provider value>
                    <View style={styles.card}>{children}</View>
                </BackdropDrawn.Provider>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    page: { flex: 1 },
    frame: {
        flex: 1,
        width: "100%",
        maxWidth: theme.layout.frame,
        alignSelf: "center",
        marginTop: theme.layout.gutter,
        marginBottom: theme.layout.gutter / 2,
        paddingHorizontal: theme.layout.gutter / 2,
    },
    md: { maxWidth: theme.layout.page },
    card: { flex: 1, borderRadius: theme.radius, overflow: "hidden" },
});
