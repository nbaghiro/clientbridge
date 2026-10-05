import type { SearchFieldProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { StyleSheet, TextInput, View } from "react-native";

import { IconSearch } from "./Icons";

const c = theme.colors;

export function SearchField({ value, onChange, placeholder, autoFocus }: SearchFieldProps) {
    return (
        <View style={styles.wrap}>
            <IconSearch size={16} color={c.muted} />
            <TextInput
                style={styles.input}
                value={value}
                onChangeText={onChange}
                placeholder={placeholder}
                accessibilityLabel={placeholder}
                placeholderTextColor={c.muted}
                autoCapitalize="none"
                autoFocus={autoFocus}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 12,
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: theme.radius,
        backgroundColor: c.surface,
    },
    input: { flex: 1, paddingVertical: 11, color: c.ink, fontSize: 15 },
});
