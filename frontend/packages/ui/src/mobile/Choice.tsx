import { type ChoiceProps, useControllable } from "@clientbridge/app-core";
import { SHADOW } from "@clientbridge/tokens";
import { theme } from "@clientbridge/tokens/native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Avatar } from "./Avatar";
import type { NativeProps } from "./props";

const c = theme.colors;

export function Choice<K extends string>({
    options,
    value: valueProp,
    defaultValue = null,
    onChange,
    layout = "chips",
    label,
    columns,
    size,
    style,
}: NativeProps<ChoiceProps<K>>) {
    const [value, setValue] = useControllable(valueProp, defaultValue);
    const chosen = (key: K): boolean =>
        Array.isArray(value) ? (value as readonly K[]).includes(key) : value === key;
    const press = (key: K): void => {
        if (valueProp === undefined) {
            const list = value as readonly K[];
            setValue(
                Array.isArray(value)
                    ? chosen(key)
                        ? list.filter((k) => k !== key)
                        : [...list, key]
                    : key,
            );
        }
        onChange?.(key);
    };
    if (layout === "tiles") {
        return (
            <Tiles
                options={options}
                value={value}
                onChange={press}
                label={label}
                columns={columns}
                size={size}
                style={style}
            />
        );
    }
    const box =
        layout === "cards" ? styles.card : layout === "segmented" ? styles.segment : styles.chip;
    return (
        <View
            accessibilityRole="radiogroup"
            accessibilityLabel={label}
            style={[
                layout === "cards" ? styles.cards : styles.wrap,
                layout === "segmented" && styles.bar,
                style,
            ]}
        >
            {options.map((o) => {
                const on = chosen(o.key);
                return (
                    <Pressable
                        key={o.key}
                        disabled={o.disabled}
                        accessibilityRole={Array.isArray(value) ? "checkbox" : "radio"}
                        accessibilityState={{ checked: on, disabled: o.disabled === true }}
                        accessibilityLabel={o.label}
                        onPress={() => {
                            press(o.key);
                        }}
                        style={[
                            box,
                            on &&
                                (layout === "cards"
                                    ? styles.cardOn
                                    : layout === "segmented"
                                      ? styles.segmentOn
                                      : styles.chipOn),
                            o.disabled === true && styles.off,
                            o.media !== undefined && layout !== "segmented" && styles.withMedia,
                            o.media !== undefined && layout === "chips" && styles.chipMedia,
                        ]}
                    >
                        {o.media !== undefined && layout !== "segmented" ? (
                            <Avatar
                                name={o.media.name}
                                src={o.media.src}
                                color={o.media.color}
                                size="sm"
                            />
                        ) : null}
                        <View style={styles.labelBox}>
                            <Text
                                style={[
                                    styles.text,
                                    layout === "cards" && styles.cardText,
                                    layout === "segmented" && styles.segmentText,
                                    on &&
                                        (layout === "cards"
                                            ? styles.cardTextOn
                                            : layout === "segmented"
                                              ? styles.segmentTextOn
                                              : styles.chipTextOn),
                                ]}
                                numberOfLines={layout === "cards" ? undefined : 1}
                            >
                                {o.label}
                            </Text>
                            {o.hint !== undefined ? (
                                <Text
                                    style={[
                                        styles.hint,
                                        on && layout === "chips" && styles.chipTextOn,
                                    ]}
                                    numberOfLines={layout === "cards" ? undefined : 1}
                                >
                                    {o.hint}
                                </Text>
                            ) : null}
                        </View>
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    bar: {
        flexWrap: "nowrap",
        alignSelf: "flex-start",
        gap: 2,
        padding: 2,
        borderRadius: theme.radius,
        backgroundColor: c.surface2,
    },
    cards: { gap: 8 },
    chip: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: c.border,
        maxWidth: "100%",
    },
    chipOn: { backgroundColor: c.accentWeak, borderColor: c.accentLine },
    segment: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radius - 2 },
    segmentOn: {
        backgroundColor: c.surface,
        shadowColor: SHADOW,
        shadowOpacity: 0.12,
        shadowRadius: 2,
        shadowOffset: { width: 0, height: 1 },
        elevation: 1,
    },
    card: {
        padding: 14,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
    },
    cardOn: { borderColor: c.accent, backgroundColor: c.accentWeak },
    off: { opacity: 0.5 },
    withMedia: { flexDirection: "row", alignItems: "center", gap: 8 },
    chipMedia: { paddingLeft: 4 },
    labelBox: { flexShrink: 1 },
    text: { color: c.inkSoft, fontSize: 13, fontWeight: "600" },
    chipTextOn: { color: c.accentStrong },
    segmentText: { color: c.muted },
    segmentTextOn: { color: c.ink },
    cardText: { color: c.ink, fontSize: 15 },
    cardTextOn: { color: c.accentStrong },
    hint: { color: c.muted, fontSize: 12, marginTop: 2 },
});

function Tiles<K extends string>({
    options,
    value,
    onChange,
    label,
    columns = 3,
    size = "md",
    style,
}: NativeProps<ChoiceProps<K>>) {
    const lg = size === "lg";
    const chosen = (key: K): boolean =>
        Array.isArray(value) ? (value as readonly K[]).includes(key) : value === key;
    const basis = `${String(100 / columns - 2)}%` as `${number}%`;
    const tight = columns >= 4;
    return (
        <View
            accessibilityRole="radiogroup"
            accessibilityLabel={label}
            style={[tileStyles.grid, style]}
        >
            {options.map((o) => {
                const on = chosen(o.key);
                return (
                    <Pressable
                        key={o.key}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: on, disabled: o.disabled === true }}
                        disabled={o.disabled}
                        onPress={() => {
                            onChange?.(o.key);
                        }}
                        style={[
                            tileStyles.tile,
                            { flexBasis: basis },
                            lg && tileStyles.lg,
                            tight && tileStyles.tight,
                            on && tileStyles.on,
                            on && tight && tileStyles.onTight,
                            o.disabled === true && tileStyles.off,
                        ]}
                    >
                        <Text
                            style={[
                                tileStyles.label,
                                lg && tileStyles.labelLg,
                                tight && (lg ? tileStyles.labelLgTight : tileStyles.labelTight),
                                on && tileStyles.onText,
                            ]}
                            numberOfLines={1}
                        >
                            {o.label}
                        </Text>
                        {o.hint !== undefined ? (
                            <Text
                                style={[
                                    tileStyles.hint,
                                    lg && tileStyles.hintLg,
                                    on && tileStyles.onText,
                                ]}
                                numberOfLines={1}
                            >
                                {o.hint}
                            </Text>
                        ) : null}
                        {o.detail !== undefined ? (
                            <Text style={tileStyles.detail} numberOfLines={2}>
                                {o.detail}
                            </Text>
                        ) : null}
                    </Pressable>
                );
            })}
        </View>
    );
}

const tileStyles = StyleSheet.create({
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "space-between" },
    tile: {
        flexGrow: 1,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
        borderRadius: theme.radius + 2,
        paddingHorizontal: 12,
        paddingVertical: 12,
    },
    lg: { alignItems: "center", paddingVertical: 18 },
    tight: { paddingHorizontal: 6 },
    on: {
        borderColor: c.accent,
        backgroundColor: c.accentWeak,
        borderWidth: 2,
        paddingHorizontal: 11,
    },
    onTight: { paddingHorizontal: 5 },
    off: { opacity: 0.5 },
    label: { color: c.ink, fontSize: 15, fontWeight: "700" },
    labelLg: { fontSize: 24 },
    labelTight: { fontSize: 13 },
    labelLgTight: { fontSize: 20 },
    hint: { color: c.inkSoft, fontSize: 12.5, marginTop: 2, fontVariant: ["tabular-nums"] },
    hintLg: { fontSize: 15, marginTop: 4 },
    onText: { color: c.accentStrong },
    detail: { color: c.muted, fontSize: 12, marginTop: 4, lineHeight: 16 },
});
