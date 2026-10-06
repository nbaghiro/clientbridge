import { type SearchFieldProps, strings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { Icon } from "./Icon";

const c = theme.colors;

/** The real SearchField plus a clear button, Enter for result lists, a trailing slot and a large size. */
export function SearchField({
    value,
    onChange,
    placeholder,
    autoFocus,
    onKey,
    trailing,
    size = "md",
}: SearchFieldProps) {
    const large = size === "lg";
    return (
        <View style={styles.row}>
            <View style={[styles.box, large && styles.large]}>
                <Icon name="search" size={large ? 19 : 16} color={c.muted} />
                <TextInput
                    value={value}
                    onChangeText={onChange}
                    placeholder={placeholder}
                    placeholderTextColor={c.muted}
                    accessibilityLabel={placeholder}
                    autoFocus={autoFocus}
                    autoCorrect={false}
                    autoCapitalize="none"
                    returnKeyType="search"
                    onSubmitEditing={() => onKey?.("enter")}
                    style={[styles.input, large && styles.inputLarge]}
                />
                {value.length > 0 ? (
                    <Pressable
                        onPress={() => {
                            onChange("");
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={strings.ui.clearSearch}
                        hitSlop={8}
                        style={styles.clear}
                    >
                        <Icon name="x" size={12} color={c.surface} />
                    </Pressable>
                ) : null}
            </View>
            {trailing}
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: 12 },
    box: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 12,
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: theme.radius,
        backgroundColor: c.surface,
    },
    large: { borderWidth: 0, borderRadius: 10, backgroundColor: c.surface2, minHeight: 44 },
    input: {
        flex: 1,
        minWidth: 0,
        paddingVertical: 11,
        color: c.ink,
        fontSize: 15,
    },
    inputLarge: { fontSize: 17 },
    clear: {
        width: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: c.muted,
        alignItems: "center",
        justifyContent: "center",
    },
});
