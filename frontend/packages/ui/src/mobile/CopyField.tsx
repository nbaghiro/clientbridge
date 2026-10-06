import type { CopyFieldProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "./Icon";

const c = theme.colors;

/** A link or snippet to hand out, with a copy button that confirms in place. */
export function CopyField({
    label,
    value,
    hint,
    multiline = false,
    emphasis = "plain",
    copied,
    onCopy,
    copyLabel,
    copiedLabel,
}: CopyFieldProps) {
    return (
        <View>
            <Text style={styles.label}>{label}</Text>
            <View style={[styles.box, multiline && styles.boxMulti]}>
                <Text
                    style={[
                        styles.value,
                        multiline && styles.code,
                        emphasis === "code" && styles.emphasis,
                    ]}
                    numberOfLines={multiline ? 6 : 1}
                >
                    {value}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${copyLabel} ${label}`}
                    onPress={onCopy}
                    style={[styles.btn, multiline && styles.btnMulti]}
                >
                    <Icon
                        name={copied ? "check" : "copy"}
                        size={15}
                        color={copied ? c.okFg : c.accent}
                    />
                    <Text style={[styles.btnText, copied && styles.done]}>
                        {copied ? copiedLabel : copyLabel}
                    </Text>
                </Pressable>
            </View>
            {hint !== undefined ? <Text style={styles.hint}>{hint}</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    emphasis: { fontSize: 20, fontWeight: "700", letterSpacing: 2 },
    label: { color: c.inkSoft, fontSize: 13, fontWeight: "600", marginBottom: 6 },
    box: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: theme.radius,
        backgroundColor: c.bg,
        paddingLeft: 12,
        paddingRight: 4,
        paddingVertical: 4,
    },
    boxMulti: {
        flexDirection: "column",
        alignItems: "stretch",
        paddingVertical: 10,
        paddingRight: 12,
    },
    value: { flex: 1, fontSize: 14, color: c.ink, fontFamily: "Menlo" },
    code: { fontSize: 11.5, lineHeight: 17, color: c.inkSoft },
    btn: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: theme.radius,
    },
    btnMulti: { alignSelf: "flex-end", paddingHorizontal: 0, paddingBottom: 0 },
    btnText: { color: c.accent, fontSize: 14, fontWeight: "600" },
    done: { color: c.okFg },
    hint: { color: c.muted, fontSize: 12, marginTop: 6, lineHeight: 17 },
});
