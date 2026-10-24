import { type RepeatingGroupProps, strings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "./Button";
import type { NativeProps } from "./props";

const c = theme.colors;

export function RepeatingGroup<T>({
    title,
    hint,
    items,
    itemLabel,
    addLabel,
    onAdd,
    onRemove,
    max,
    children,
    style,
}: NativeProps<RepeatingGroupProps<T>>) {
    return (
        <View style={[styles.section, style]}>
            <Text style={styles.title}>{title}</Text>
            {hint !== undefined ? <Text style={styles.hint}>{hint}</Text> : null}
            {items.map((item, i) => {
                const label = itemLabel(i + 1);
                return (
                    <View key={i} style={styles.item}>
                        <View style={styles.head}>
                            <Text style={styles.label}>{label}</Text>
                            <Button
                                variant="link"
                                label={strings.ui.removeItem(label)}
                                onPress={() => {
                                    onRemove(i);
                                }}
                            >
                                {strings.ui.remove}
                            </Button>
                        </View>
                        {children(item, i)}
                    </View>
                );
            })}
            {items.length < max ? (
                <Button variant="outline" full onPress={onAdd} style={styles.add}>
                    {addLabel}
                </Button>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    section: {
        marginTop: 22,
        paddingTop: 16,
        borderTopColor: c.borderSoft,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    title: { color: c.ink, fontSize: 15, fontWeight: "700" },
    hint: { color: c.muted, fontSize: 12, lineHeight: 17 },
    item: {
        marginTop: 12,
        padding: 12,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
    },
    head: { flexDirection: "row", alignItems: "center", gap: 8 },
    add: { marginTop: 12 },
    label: { flex: 1, minWidth: 0, color: c.ink, fontSize: 15 },
});
