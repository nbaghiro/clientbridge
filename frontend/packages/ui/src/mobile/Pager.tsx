import type { PagerProps } from "@clientbridge/app-core";
import { StyleSheet, View } from "react-native";

import { Button } from "./Button";
import type { NativeProps } from "./props";

export function Pager({
    onPrevious,
    onNext,
    previousLabel,
    nextLabel,
    style,
}: NativeProps<PagerProps>) {
    if (onPrevious === null && onNext === null) return null;
    return (
        <View style={[styles.row, style]}>
            {onPrevious !== null ? (
                <Button size="sm" variant="outline" onPress={onPrevious}>
                    {previousLabel}
                </Button>
            ) : null}
            {onNext !== null ? (
                <Button size="sm" variant="outline" onPress={onNext}>
                    {nextLabel}
                </Button>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: "row", justifyContent: "flex-end", gap: 12 },
});
