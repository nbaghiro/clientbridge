import {
    type FormAnswer,
    type FormQuestionField,
    type FormQuestionProps,
    type TextFieldType,
    optionPair,
} from "@clientbridge/app-core/public";

import { Choice } from "./Choice";
import { DateField, TimeField } from "./DateField";
import { Field, TextField, Toggle } from "./Field";
import { Icon } from "./Icon";
import type { WebProps } from "./props";
import { Select } from "./Select";

const TEXT_TYPE: Partial<Record<string, TextFieldType>> = {
    email: "email",
    phone: "tel",
    number: "number",
    currency: "number",
};

const isUpload = (f: FormQuestionField): boolean =>
    f.input === "file" || f.input === "image" || f.input === "signature";

export function FormQuestion({
    field: f,
    value,
    onChange,
    onUpload,
    fileName,
    chooseFileLabel,
    selectPlaceholder,
    invalid = false,
    className,
}: WebProps<FormQuestionProps>) {
    const preview = onChange === undefined;
    const set = (v: FormAnswer): void => {
        onChange?.(v);
    };
    const help = f.help ?? undefined;
    const label = f.label;
    const options = f.options.map((o) => {
        const { value: v, label: l } = optionPair(o);
        return { key: v, label: l };
    });

    const body = (() => {
        if (isUpload(f)) {
            return (
                <Field label={label} hint={help} required={f.required}>
                    <label
                        className={`flex items-center gap-3 rounded-md border border-dashed px-4 py-3 text-sm transition ${
                            invalid ? "border-danger" : "border-line"
                        } ${preview ? "bg-bg" : "cursor-pointer bg-bg hover:border-accent"}`}
                    >
                        <Icon
                            name={fileName ? "check" : "upload"}
                            size={20}
                            className="text-ink-soft"
                        />
                        <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-ink">
                                {fileName ?? chooseFileLabel}
                            </span>
                        </span>
                        {preview ? null : (
                            <input
                                type="file"
                                className="sr-only"
                                aria-label={label}
                                accept="application/pdf,image/jpeg,image/png,image/heic"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) onUpload?.(file, file.name);
                                }}
                            />
                        )}
                    </label>
                </Field>
            );
        }
        if (f.input === "checkbox") {
            return (
                <div
                    className={`rounded-md border px-3.5 py-3 ${invalid ? "border-danger" : "border-line"} bg-bg`}
                >
                    <Toggle
                        label={f.required ? `${label} *` : label}
                        hint={help}
                        value={value === true}
                        onChange={set}
                    />
                </div>
            );
        }
        if (f.input === "select") {
            return (
                <Field label={label} hint={help} required={f.required}>
                    <Select
                        name={label}
                        value={typeof value === "string" ? value : ""}
                        options={[{ key: "", label: selectPlaceholder }, ...options]}
                        onChange={set}
                    />
                </Field>
            );
        }
        if (f.input === "multiselect") {
            const list = Array.isArray(value) ? value : [];
            return (
                <Field label={label} hint={help} required={f.required}>
                    <Choice
                        label={label}
                        options={options}
                        value={list}
                        onChange={(v) => {
                            set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
                        }}
                    />
                </Field>
            );
        }
        if (f.input === "date" || f.input === "time") {
            const Picker = f.input === "date" ? DateField : TimeField;
            return (
                <Picker
                    label={label}
                    hint={help}
                    required={f.required}
                    value={typeof value === "string" ? value : ""}
                    onChange={set}
                />
            );
        }
        return (
            <TextField
                label={label}
                hint={help}
                required={f.required}
                multiline={f.input === "longtext" || f.input === "address"}
                type={TEXT_TYPE[f.input] ?? "text"}
                value={typeof value === "string" ? value : ""}
                onChange={set}
            />
        );
    })();

    return (
        <div className={className} inert={preview || undefined} aria-invalid={invalid || undefined}>
            {body}
        </div>
    );
}
