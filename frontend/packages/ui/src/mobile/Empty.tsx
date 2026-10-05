import type { EmptyProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, Text } from "react-native";

export function Empty({ message }: EmptyProps) {
    return <Text style={styles.empty}>{message}</Text>;
}

const styles = StyleSheet.create({
    empty: { color: theme.colors.muted, textAlign: "center", paddingVertical: 48, fontSize: 14 },
});
