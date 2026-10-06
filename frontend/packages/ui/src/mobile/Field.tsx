import {
    type ChoiceOption,
    type FieldProps,
    type SelectProps,
    type TextFieldProps,
    type TextFieldType,
    type ToggleProps,
    strings,
    useControllable,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import type { ReactNode } from "react";
import { StyleSheet, Switch, Text, TextInput, View, type KeyboardTypeOptions } from "react-native";

import { Choice } from "./Choice";
import { Notice } from "./Notice";
import type { NativeProps } from "./props";

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
}: NativeProps<TextFieldProps>) {
    const [value, setValue] = useControllable(valueProp, defaultValue, onChange);
    const plain = type === "email" || type === "password" || type === "url";
    const input: ReactNode = (
        <TextInput
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

export function Select<K extends string>({
    label,
    hint,
    error,
    value: valueProp,
    defaultValue,
    options,
    onChange,
    style,
}: NativeProps<SelectProps<K>>) {
    const [value, setValue] = useControllable<K | undefined>(
        valueProp,
        defaultValue ?? options[0]?.key,
    );
    const pick = (key: K): void => {
        setValue(key);
        onChange?.(key);
    };
    const choices: ChoiceOption<K>[] = options.map((o) => ({ key: o.key, label: o.label }));
    return (
        <View style={style}>
            {label !== undefined ? <Label text={label} optional={false} /> : null}
            <Choice options={choices} value={value} onChange={pick} label={label} />
            <Extras hint={hint} error={error} />
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
    toggle: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 },
    toggleText: { flex: 1 },
    toggleLabel: { color: c.ink, fontSize: 14, fontWeight: "600" },
});

const SIZE = StyleSheet.create({
    sm: { paddingHorizontal: 10, paddingVertical: 6, fontSize: 13 },
    md: { paddingHorizontal: 12, paddingVertical: 10 },
    lg: { paddingHorizontal: 13, paddingVertical: 13 },
});
