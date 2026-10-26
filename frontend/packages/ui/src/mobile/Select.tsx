import {
    type IconName,
    type OptionMedia,
    type SelectOption,
    type SelectProps,
    strings,
    useControllable,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { type ReactNode, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Avatar } from "./Avatar";
import { Choice } from "./Choice";
import { Extras, FIELD_SIZE, Label, fieldStyles } from "./Field";
import { Icon } from "./Icon";
import { ItemImage } from "./ItemImage";
import { Modal } from "./Modal";
import type { NativeProps } from "./props";
import { SearchField } from "./SearchField";

const c = theme.colors;

/** An option's picture: a person's avatar, or an item's photo on its colour. */
function OptionLead({ media }: { media: OptionMedia }) {
    return media.kind === "person" ? (
        <Avatar name={media.name} src={media.src} color={media.color} size="sm" />
    ) : (
        <ItemImage name={media.name} src={media.src ?? null} color={media.color} size={28} />
    );
}

// Above this many options the sheet starts with a search box; at or below it, plain options are chips.
const SEARCH_AFTER = 6;

// The box of a field that opens a sheet: a text field's look, with a glyph at the end.
export function PickerTrigger({
    label,
    text,
    placeholder,
    icon,
    size,
    media,
    surface = "bg",
    open,
    disabled,
    invalid,
    onPress,
}: {
    label: string | undefined;
    text: string;
    placeholder: boolean;
    icon: IconName;
    size: "sm" | "md" | "lg";
    media?: OptionMedia | undefined;
    surface?: "bg" | "surface" | undefined;
    open: boolean;
    disabled: boolean;
    invalid: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityValue={{ text: placeholder ? "" : text }}
            accessibilityState={{ disabled, expanded: open }}
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => [
                fieldStyles.input,
                surface === "surface" && fieldStyles.onBg,
                FIELD_SIZE[size],
                styles.trigger,
                (open || pressed) && styles.open,
                invalid && styles.invalid,
                disabled && fieldStyles.disabled,
            ]}
        >
            {media !== undefined ? <OptionLead media={media} /> : null}
            <Text
                style={[
                    styles.text,
                    size === "sm" && styles.small,
                    placeholder && styles.placeholder,
                ]}
                numberOfLines={1}
            >
                {text}
            </Text>
            <Icon name={icon} size={size === "sm" ? 14 : 16} color={c.muted} />
        </Pressable>
    );
}

function Row<K extends string>({
    option,
    selected,
    onPress,
}: {
    option: SelectOption<K>;
    selected: boolean;
    onPress: () => void;
}) {
    const off = option.disabled === true;
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected, disabled: off }}
            disabled={off}
            onPress={onPress}
            style={({ pressed }) => [
                styles.row,
                (pressed || selected) && styles.rowOn,
                off && styles.rowOff,
            ]}
        >
            {option.media !== undefined ? <OptionLead media={option.media} /> : null}
            <Text style={[styles.rowLabel, selected && styles.rowChosen]} numberOfLines={1}>
                {option.label}
            </Text>
            {option.detail !== undefined ? (
                <Text style={styles.rowDetail} numberOfLines={1}>
                    {option.detail}
                </Text>
            ) : null}
            <View style={styles.check}>
                {selected ? <Icon name="check" size={18} color={c.accent} /> : null}
            </View>
        </Pressable>
    );
}

export function Select<K extends string>(props: NativeProps<SelectProps<K>>) {
    return <SelectSheet {...props} searchFirst={false} />;
}

/** Select's body; `searchFirst` always opens a sheet with its search box focused (SearchSelect). */
export function SelectSheet<K extends string>({
    label,
    name,
    hint,
    error,
    value: valueProp,
    defaultValue,
    options,
    onChange,
    placeholder,
    searchable,
    size = "md",
    surface,
    disabled = false,
    style,
    searchFirst,
}: NativeProps<SelectProps<K>> & { searchFirst: boolean }) {
    const [value, setValue] = useControllable<K | undefined>(
        valueProp,
        defaultValue ?? (placeholder === undefined ? options[0]?.key : undefined),
    );
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState("");
    const pick = (key: K): void => {
        setValue(key);
        onChange?.(key);
    };
    const plain = options.every((o) => o.detail === undefined && o.group === undefined);
    const sheet =
        searchFirst ||
        options.length > SEARCH_AFTER ||
        placeholder !== undefined ||
        searchable === true ||
        !plain;
    const withSearch = searchFirst || (searchable ?? options.length > SEARCH_AFTER);
    const chosen = options.find((o) => o.key === value);
    const needle = q.trim().toLowerCase();
    const shown =
        needle === ""
            ? options
            : options.filter(
                  (o) =>
                      o.label.toLowerCase().includes(needle) ||
                      (o.detail?.toLowerCase().includes(needle) ?? false),
              );
    const close = (): void => {
        setOpen(false);
        setQ("");
    };
    const rows: ReactNode[] = [];
    let group: string | undefined;
    for (const o of shown) {
        if (o.group !== undefined && o.group !== group) {
            rows.push(
                <Text key={`g-${o.group}`} style={styles.group} accessibilityRole="header">
                    {o.group}
                </Text>,
            );
        }
        group = o.group;
        rows.push(
            <Row
                key={o.key}
                option={o}
                selected={o.key === value}
                onPress={() => {
                    pick(o.key);
                    close();
                }}
            />,
        );
    }
    return (
        <View style={style}>
            {label !== undefined ? <Label text={label} optional={false} /> : null}
            {sheet ? (
                <PickerTrigger
                    label={label ?? name ?? placeholder}
                    text={chosen?.label ?? placeholder ?? strings.ui.choose}
                    media={chosen?.media}
                    placeholder={chosen === undefined}
                    icon="chevronDown"
                    size={size}
                    surface={surface}
                    open={open}
                    disabled={disabled}
                    invalid={error !== undefined && error !== null}
                    onPress={() => {
                        setOpen(true);
                    }}
                />
            ) : (
                <Choice
                    options={options.map((o) => ({
                        key: o.key,
                        label: o.label,
                        disabled: disabled || o.disabled === true,
                    }))}
                    value={value}
                    onChange={pick}
                    label={label ?? name}
                    size={size === "lg" ? "lg" : "md"}
                />
            )}
            <Extras hint={hint} error={error} />
            {sheet ? (
                <Modal
                    open={open}
                    onClose={close}
                    size={options.length > SEARCH_AFTER ? "xl" : "md"}
                >
                    {label !== undefined || name !== undefined ? (
                        <Text style={styles.sheetTitle} accessibilityRole="header">
                            {label ?? name}
                        </Text>
                    ) : null}
                    {withSearch ? (
                        <SearchField
                            value={q}
                            onChange={setQ}
                            placeholder={strings.ui.searchOptions}
                            autoFocus={searchFirst}
                        />
                    ) : null}
                    <View style={styles.list}>
                        {shown.length === 0 ? (
                            <Text style={styles.empty}>
                                {options.length === 0 ? strings.ui.noOptions : strings.ui.noMatches}
                            </Text>
                        ) : (
                            rows
                        )}
                    </View>
                </Modal>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    trigger: { flexDirection: "row", alignItems: "center", gap: 8 },
    open: { borderColor: c.accent },
    invalid: { borderColor: c.danFg },
    text: { flex: 1, color: c.ink, fontFamily: theme.fonts.ui, fontSize: 15 },
    small: { fontFamily: theme.fonts.ui, fontSize: 13 },
    placeholder: { color: c.muted },
    sheetTitle: {
        color: c.ink,
        fontFamily: theme.fonts.ui,
        fontSize: 18,
        fontWeight: "700",
        marginBottom: 12,
    },
    list: { marginTop: 8, marginHorizontal: -8 },
    group: {
        color: c.muted,
        fontFamily: theme.fonts.ui,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 0.6,
        textTransform: "uppercase",
        paddingHorizontal: 12,
        paddingTop: 14,
        paddingBottom: 6,
    },
    row: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        minHeight: 48,
        paddingHorizontal: 12,
        borderRadius: theme.radius,
    },
    rowOn: { backgroundColor: c.bg },
    rowOff: { opacity: 0.45 },
    rowLabel: { flex: 1, color: c.inkSoft, fontFamily: theme.fonts.ui, fontSize: 15 },
    rowChosen: { color: c.ink, fontWeight: "600" },
    rowDetail: {
        color: c.muted,
        fontFamily: theme.fonts.ui,
        fontSize: 13,
        fontVariant: ["tabular-nums"],
    },
    check: { width: 20, alignItems: "flex-end" },
    empty: {
        color: c.muted,
        fontFamily: theme.fonts.ui,
        fontSize: 14,
        textAlign: "center",
        paddingVertical: 24,
    },
});
