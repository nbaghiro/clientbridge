import type { TagInputProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Icon } from "./Icon";

const c = theme.colors;

export function TagInput({
    label,
    tags,
    onAdd,
    onRemove,
    suggestions = [],
    placeholder,
    removeLabel,
    createLabel,
}: TagInputProps) {
    const [q, setQ] = useState("");
    const text = q.trim().toLowerCase();
    const open = suggestions.filter((s) => !tags.includes(s.tag));
    const matches =
        text === "" ? open.slice(0, 6) : open.filter((s) => s.tag.includes(text)).slice(0, 6);
    const exact = open.some((s) => s.tag === text) || tags.includes(text);
    const add = (tag: string): void => {
        onAdd(tag);
        setQ("");
    };

    return (
        <View>
            <Text style={styles.label}>{label}</Text>
            <View style={styles.box}>
                {tags.map((t) => (
                    <View key={t} style={styles.chip}>
                        <Text style={styles.chipText}>{t}</Text>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={removeLabel(t)}
                            hitSlop={8}
                            onPress={() => {
                                onRemove(t);
                            }}
                        >
                            <Icon name="x" size={13} color={c.accentStrong} />
                        </Pressable>
                    </View>
                ))}
                <TextInput
                    value={q}
                    onChangeText={setQ}
                    onSubmitEditing={() => {
                        if (text !== "") add(text);
                    }}
                    placeholder={tags.length === 0 ? placeholder : ""}
                    placeholderTextColor={c.muted}
                    accessibilityLabel={label}
                    autoCapitalize="none"
                    style={styles.input}
                />
            </View>
            {matches.length > 0 || (text !== "" && !exact) ? (
                <View style={styles.suggest}>
                    {matches.map((s) => (
                        <Pressable
                            key={s.tag}
                            accessibilityRole="button"
                            onPress={() => {
                                add(s.tag);
                            }}
                            style={styles.option}
                        >
                            <Icon name="plus" size={12} color={c.inkSoft} />
                            <Text style={styles.optionText}>{s.tag}</Text>
                            <Text style={styles.count}>{s.count}</Text>
                        </Pressable>
                    ))}
                    {text !== "" && !exact ? (
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => {
                                add(text);
                            }}
                            style={[styles.option, styles.create]}
                        >
                            <Icon name="plus" size={12} color={c.accent} />
                            <Text style={[styles.optionText, styles.createText]}>
                                {createLabel(text)}
                            </Text>
                        </Pressable>
                    ) : null}
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    label: { color: c.inkSoft, fontSize: 13, fontWeight: "600", marginBottom: 6, marginTop: 14 },
    box: {
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
        borderWidth: theme.borderWidth,
        borderColor: c.border,
        borderRadius: theme.radius,
        backgroundColor: c.bg,
        paddingHorizontal: 8,
        paddingVertical: 7,
    },
    chip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        backgroundColor: c.accentWeak,
        borderRadius: 999,
        paddingLeft: 10,
        paddingRight: 6,
        paddingVertical: 4,
    },
    chipText: { color: c.accentStrong, fontSize: 13, fontWeight: "600" },
    input: {
        flexGrow: 1,
        flexBasis: 80,
        minWidth: 80,
        width: 80,
        color: c.ink,
        fontSize: 15,
        paddingVertical: 3,
        paddingHorizontal: 4,
    },
    suggest: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
    option: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    optionText: { color: c.inkSoft, fontSize: 13, fontWeight: "600" },
    count: { color: c.muted, fontSize: 12 },
    create: { borderStyle: "dashed", borderColor: c.accentLine },
    createText: { color: c.accent },
});
