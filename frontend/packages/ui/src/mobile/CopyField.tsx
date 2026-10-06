import { type CopyFieldProps, strings, useFlash } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "./Icon";
import type { NativeProps } from "./props";

const c = theme.colors;
const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

// React Native has no clipboard of its own, so onCopy does the copying.
export function CopyField({
    label,
    value,
    hint,
    variant = "line",
    copied: copiedProp,
    onCopy,
    copyLabel = strings.ui.copy,
    copiedLabel = strings.ui.copied,
    style,
}: NativeProps<CopyFieldProps>) {
    const [flashed, flash] = useFlash();
    const copied = copiedProp ?? flashed;
    const snippet = variant === "snippet";
    return (
        <View style={style}>
            <Text style={styles.label}>{label}</Text>
            <View style={[styles.box, snippet && styles.boxMulti]}>
                <Text
                    selectable
                    style={[
                        styles.value,
                        snippet && styles.code,
                        variant === "code" && styles.emphasis,
                    ]}
                    numberOfLines={snippet ? 6 : 1}
                >
                    {value}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${copied ? copiedLabel : copyLabel}, ${label}`}
                    onPress={() => {
                        if (copiedProp === undefined) flash();
                        onCopy?.();
                    }}
                    style={[styles.btn, snippet && styles.btnMulti]}
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
    value: { flex: 1, fontSize: 14, color: c.ink, fontFamily: MONO },
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
