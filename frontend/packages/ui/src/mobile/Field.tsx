import {
    type FieldProps,
    type SelectProps,
    type TextFieldProps,
    type TextFieldType,
    type ToggleProps,
    strings,
    useControllable,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { type ReactNode, useState } from "react";
import {
    Pressable,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    View,
    type KeyboardTypeOptions,
} from "react-native";

import { Choice } from "./Choice";
import { Icon } from "./Icon";
import { ListRow } from "./ListRow";
import { Modal } from "./Modal";
import { Notice } from "./Notice";
import { SearchField } from "./SearchField";
import type { NativeProps, WithRef } from "./props";

const c = theme.colors;

const KEYBOARD: Partial<Record<TextFieldType, KeyboardTypeOptions>> = {
    email: "email-address",
    number: "decimal-pad",
    tel: "phone-pad",
    url: "url",
    date: "numbers-and-punctuation",
    time: "numbers-and-punctuation",
};

function Label({
    text,
    optional,
    required = false,
}: {
    text: string;
    optional: boolean;
    required?: boolean;
}) {
    return (
        <Text style={styles.label}>
            {text}
            {required ? <Text style={styles.required}> *</Text> : null}
            {optional && !required ? (
                <Text style={styles.optional}> {strings.common.optional}</Text>
            ) : null}
        </Text>
    );
}

function Extras({ hint, error }: { hint: string | undefined; error: string | null | undefined }) {
    return (
        <>
            {hint !== undefined ? <Text style={styles.hint}>{hint}</Text> : null}
            {error !== undefined && error !== null ? <Notice tone="danger">{error}</Notice> : null}
        </>
    );
}

export function Field({
    label,
    hint,
    error,
    optional = false,
    required = false,
    children,
    style,
}: NativeProps<FieldProps>) {
    return (
        <View style={style}>
            <Label text={label} optional={optional} required={required} />
            {children}
            <Extras hint={hint} error={error} />
        </View>
    );
}

export function TextField({
    label,
    name,
    hint,
    error,
    optional = false,
    value: valueProp,
    defaultValue = "",
    onChange,
    onSubmit,
    placeholder,
    prefix,
    type = "text",
    multiline = false,
    rows = 3,
    size = "md",
    surface = "bg",
    width = "full",
    disabled,
    autoFocus,
    autoComplete,
    required,
    maxLength,
    style,
    ref,
}: NativeProps<TextFieldProps> & WithRef<TextInput>) {
    const [value, setValue] = useControllable(valueProp, defaultValue, onChange);
    const plain = type === "email" || type === "password" || type === "url";
    const input: ReactNode = (
        <TextInput
            ref={ref}
            value={value}
            onChangeText={setValue}
            onSubmitEditing={onSubmit}
            placeholder={placeholder}
            placeholderTextColor={c.muted}
            accessibilityLabel={label ?? name ?? placeholder}
            keyboardType={KEYBOARD[type]}
            secureTextEntry={type === "password"}
            autoCapitalize={plain ? "none" : "sentences"}
            autoCorrect={!plain}
            autoComplete={autoComplete as never}
            autoFocus={autoFocus}
            editable={disabled !== true}
            maxLength={maxLength}
            multiline={multiline}
            numberOfLines={multiline ? rows : undefined}
            textAlignVertical={multiline ? "top" : "center"}
            style={[
                styles.input,
                SIZE[size],
                surface === "surface" && styles.onBg,
                multiline && { minHeight: rows * 22 + 20 },
                width === "narrow" && styles.narrow,
                width === "auto" && styles.auto,
                disabled === true && styles.disabled,
                prefix !== undefined && styles.bare,
            ]}
        />
    );
    const box: ReactNode =
        prefix === undefined ? (
            input
        ) : (
            <View style={[styles.prefixed, surface === "surface" && styles.onBg]}>
                <Text style={styles.prefix}>{prefix}</Text>
                <View style={styles.prefixInput}>{input}</View>
            </View>
        );
    if (label === undefined && hint === undefined && (error ?? null) === null) return box;
    return (
        <View style={style}>
            {label !== undefined ? (
                <Label text={label} optional={optional} required={required === true} />
            ) : null}
            {box}
            <Extras hint={hint} error={error} />
        </View>
    );
}

// Above this many options a Select opens a searchable list instead of a row of chips.
const SHEET_AFTER = 6;

export function Select<K extends string>({
    label,
    name,
    hint,
    error,
    value: valueProp,
    defaultValue,
    options,
    onChange,
    size = "md",
    disabled = false,
    style,
}: NativeProps<SelectProps<K>>) {
    const [value, setValue] = useControllable<K | undefined>(
        valueProp,
        defaultValue ?? options[0]?.key,
    );
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState("");
    const pick = (key: K): void => {
        setValue(key);
        onChange?.(key);
    };
    const sheet = options.length > SHEET_AFTER;
    const chosen = options.find((o) => o.key === value);
    const needle = q.trim().toLowerCase();
    const shown =
        needle === "" ? options : options.filter((o) => o.label.toLowerCase().includes(needle));
    const close = (): void => {
        setOpen(false);
        setQ("");
    };
    return (
        <View style={style}>
            {label !== undefined ? <Label text={label} optional={false} /> : null}
            {sheet ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={label ?? name}
                    accessibilityValue={{ text: chosen?.label ?? "" }}
                    accessibilityState={{ disabled, expanded: open }}
                    disabled={disabled}
                    onPress={() => {
                        setOpen(true);
                    }}
                    style={[styles.input, SIZE[size], styles.select, disabled && styles.disabled]}
                >
                    <Text style={[styles.selectText, SIZE_TEXT[size]]} numberOfLines={1}>
                        {chosen?.label ?? ""}
                    </Text>
                    <Icon name="chevronDown" size={16} color={c.muted} />
                </Pressable>
            ) : (
                <Choice
                    options={options.map((o) => ({ key: o.key, label: o.label, disabled }))}
                    value={value}
                    onChange={pick}
                    label={label}
                    size={size === "lg" ? "lg" : "md"}
                />
            )}
            <Extras hint={hint} error={error} />
            {sheet ? (
                <Modal open={open} onClose={close} size="xl">
                    {label !== undefined ? <Text style={styles.sheetTitle}>{label}</Text> : null}
                    <SearchField
                        value={q}
                        onChange={setQ}
                        placeholder={strings.ui.searchOptions}
                        autoFocus
                    />
                    <View style={styles.sheetList}>
                        {shown.length === 0 ? (
                            <Text style={styles.noMatch}>{strings.ui.noMatches}</Text>
                        ) : (
                            shown.map((o) => (
                                <ListRow
                                    key={o.key}
                                    title={o.label}
                                    density="compact"
                                    selected={o.key === value}
                                    meta={
                                        o.key === value ? (
                                            <Icon name="check" size={18} color={c.accent} />
                                        ) : undefined
                                    }
                                    onPress={() => {
                                        pick(o.key);
                                        close();
                                    }}
                                />
                            ))
                        )}
                    </View>
                </Modal>
            ) : null}
        </View>
    );
}

export function Toggle({
    label,
    hint,
    value: valueProp,
    defaultValue = false,
    onChange,
    disabled,
    style,
}: NativeProps<ToggleProps>) {
    const [value, setValue] = useControllable(valueProp, defaultValue, onChange);
    return (
        <View style={[styles.toggle, style]}>
            <View style={styles.toggleText}>
                <Text style={styles.toggleLabel}>{label}</Text>
                {hint !== undefined ? <Text style={styles.hint}>{hint}</Text> : null}
            </View>
            <Switch
                value={value}
                onValueChange={setValue}
                disabled={disabled}
                accessibilityLabel={label}
                trackColor={{ true: c.accent, false: c.border }}
                thumbColor={c.surface}
                ios_backgroundColor={c.border}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    label: { color: c.inkSoft, fontSize: 13, fontWeight: "600", marginBottom: 6, marginTop: 14 },
    optional: { color: c.muted, fontWeight: "400" },
    required: { color: c.danFg },
    hint: { color: c.muted, fontSize: 12, marginTop: 6, lineHeight: 17 },
    input: {
        borderColor: c.border,
        borderWidth: theme.borderWidth,
        borderRadius: theme.radius,
        color: c.ink,
        fontSize: 15,
        backgroundColor: c.bg,
    },
    onBg: { backgroundColor: c.surface },
    narrow: { width: 120 },
    auto: { alignSelf: "flex-start", minWidth: 80 },
    disabled: { opacity: 0.6 },
    prefixed: {
        flexDirection: "row",
        alignItems: "center",
        borderColor: c.border,
        borderWidth: theme.borderWidth,
        borderRadius: theme.radius,
        backgroundColor: c.bg,
        paddingLeft: 12,
    },
    prefix: { color: c.muted, fontSize: 15 },
    bare: { borderWidth: 0, backgroundColor: "transparent", paddingLeft: 2 },
    prefixInput: { flex: 1 },
    select: { flexDirection: "row", alignItems: "center", gap: 8 },
    selectText: { flex: 1, color: c.ink, fontSize: 15 },
    sheetTitle: { color: c.ink, fontSize: 18, fontWeight: "700", marginBottom: 12 },
    sheetList: { marginTop: 8 },
    noMatch: { color: c.muted, fontSize: 14, textAlign: "center", paddingVertical: 24 },
    toggle: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 },
    toggleText: { flex: 1 },
    toggleLabel: { color: c.ink, fontSize: 14, fontWeight: "600" },
});

const SIZE = StyleSheet.create({
    sm: { paddingHorizontal: 10, paddingVertical: 6, fontSize: 13 },
    md: { paddingHorizontal: 12, paddingVertical: 10 },
    lg: { paddingHorizontal: 13, paddingVertical: 13 },
});

const SIZE_TEXT = StyleSheet.create({
    sm: { fontSize: 13 },
    md: { fontSize: 15 },
    lg: { fontSize: 15 },
});
