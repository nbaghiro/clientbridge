import type { PageFrameProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, View } from "react-native";

import { useTabletLayout } from "./layout";
import type { NativeProps } from "./props";

// Phone screens run edge to edge; from tablet width they sit in a centred column.
export function PageFrame({ leading, children, style }: NativeProps<PageFrameProps>) {
    const tablet = useTabletLayout();
    return (
        <View style={[styles.page, style]}>
            {leading}
            <View style={[styles.fill, tablet && styles.frame]}>{children}</View>
        </View>
    );
}

const styles = StyleSheet.create({
    page: { flex: 1 },
    fill: { flex: 1 },
    frame: {
        width: "100%",
        maxWidth: theme.layout.frame,
        alignSelf: "center",
        paddingHorizontal: theme.layout.gutter,
    },
});
