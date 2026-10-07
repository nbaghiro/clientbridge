import {
    type FormAnswer,
    type FormQuestionProps,
    type TextFieldType,
    optionPair,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, Text, View } from "react-native";

import { Choice } from "./Choice";
import { DateField, TimeField } from "./DateField";
import { Field, TextField, Toggle } from "./Field";
import { Icon } from "./Icon";
import type { NativeProps } from "./props";

const c = theme.colors;

const TEXT_TYPE: Partial<Record<string, TextFieldType>> = {
    email: "email",
    phone: "tel",
    number: "number",
    currency: "number",
};

export function FormQuestion({
    field: f,
    value,
    onChange,
    fileName,
    chooseFileLabel,
    invalid = false,
    style,
}: NativeProps<FormQuestionProps>) {
    const preview = onChange === undefined;
    const set = (v: FormAnswer): void => {
        onChange?.(v);
    };
    const help = f.help ?? undefined;
    const options = f.options.map((o) => {
        const { value: v, label: l } = optionPair(o);
        return { key: v, label: l };
    });

    const body = (() => {
        if (f.input === "file" || f.input === "image" || f.input === "signature") {
            return (
                <Field label={f.label} hint={help} required={f.required}>
                    <View style={[styles.file, invalid && styles.invalid]}>
                        <View style={styles.fileIcon}>
                            <Icon name={fileName ? "check" : "upload"} color={c.accent} size={18} />
                        </View>
                        <Text style={styles.fileText} numberOfLines={1}>
                            {fileName ?? chooseFileLabel}
                        </Text>
                    </View>
                </Field>
            );
        }
        if (f.input === "checkbox") {
            return (
                <View style={[styles.check, invalid && styles.invalid]}>
                    <Toggle
                        label={f.required ? `${f.label} *` : f.label}
                        hint={help}
                        value={value === true}
                        onChange={set}
                    />
                </View>
            );
        }
        if (f.input === "select" || f.input === "multiselect") {
            const list = Array.isArray(value) ? value : [];
            return (
                <Field label={f.label} hint={help} required={f.required}>
                    <Choice
                        label={f.label}
                        options={options}
                        value={
                            f.input === "select"
                                ? typeof value === "string" && value !== ""
                                    ? value
                                    : null
                                : list
                        }
                        onChange={(v) => {
                            set(
                                f.input === "select"
                                    ? v
                                    : list.includes(v)
                                      ? list.filter((x) => x !== v)
                                      : [...list, v],
                            );
                        }}
                    />
                </Field>
            );
        }
        if (f.input === "date" || f.input === "time") {
            const Picker = f.input === "date" ? DateField : TimeField;
            return (
                <Picker
                    label={f.label}
                    hint={help}
                    required={f.required}
                    value={typeof value === "string" ? value : ""}
                    onChange={set}
                />
            );
        }
        return (
            <TextField
                label={f.label}
                hint={help}
                required={f.required}
                multiline={f.input === "longtext" || f.input === "address"}
                type={TEXT_TYPE[f.input] ?? "text"}
                value={typeof value === "string" ? value : ""}
                onChange={set}
            />
        );
    })();

    return <View style={[{ pointerEvents: preview ? "none" : "auto" }, style]}>{body}</View>;
}

const styles = StyleSheet.create({
    file: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        borderWidth: 1,
        borderStyle: "dashed",
        borderColor: c.border,
        borderRadius: theme.radius,
        backgroundColor: c.bg,
        padding: 12,
    },
    fileIcon: {
        width: 34,
        height: 34,
        borderRadius: theme.radius,
        backgroundColor: c.accentWeak,
        alignItems: "center",
        justifyContent: "center",
    },
    fileText: { flex: 1, color: c.ink, fontSize: 15, fontWeight: "600" },
    check: {
        marginTop: 14,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: theme.radius,
        backgroundColor: c.bg,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    invalid: { borderColor: c.danFg },
});
