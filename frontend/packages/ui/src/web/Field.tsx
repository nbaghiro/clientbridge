import {
    type FieldProps,
    type SelectProps,
    type TextFieldProps,
    type ToggleProps,
    strings,
} from "@clientbridge/app-core/public";
import { type ReactNode, useId } from "react";

import { Notice } from "./Notice";
import { type WebProps, cx } from "./props";

const INPUT_SIZE = { sm: "px-2 py-1 text-xs", md: "px-3 py-2 text-sm", lg: "px-3 py-2.5" } as const;
const INPUT_WIDTH = { full: "w-full", narrow: "w-32", auto: "" } as const;

function inputClass(
    size: keyof typeof INPUT_SIZE,
    surface: "bg" | "surface",
    width: keyof typeof INPUT_WIDTH,
): string {
    return `${INPUT_WIDTH[width]} rounded-md border border-line ${surface === "bg" ? "bg-bg" : "bg-surface"} ${INPUT_SIZE[size]} text-ink outline-hidden transition placeholder:text-muted focus:border-accent disabled:opacity-60`;
}

function Mark({ optional, required }: { optional: boolean; required: boolean }) {
    if (required) return <span className="text-danger"> *</span>;
    if (optional) return <span className="font-normal text-muted"> {strings.common.optional}</span>;
    return null;
}

function Labelled({
    id,
    label,
    hint,
    error,
    optional,
    required,
    children,
    className,
}: WebProps<{
    id: string;
    label: string | undefined;
    hint: string | undefined;
    error: string | null | undefined;
    optional: boolean;
    required: boolean;
    children: ReactNode;
}>) {
    if (label === undefined && hint === undefined && (error ?? null) === null) {
        return className === undefined ? children : <div className={className}>{children}</div>;
    }
    return (
        <div className={cx("flex flex-col gap-1.5", className)}>
            {label !== undefined ? (
                <label htmlFor={id} className="text-sm font-medium text-ink-soft">
                    {label}
                    <Mark optional={optional} required={required} />
                </label>
            ) : null}
            {children}
            {hint !== undefined ? <p className="text-xs text-muted">{hint}</p> : null}
            {error !== undefined && error !== null ? <Notice tone="danger">{error}</Notice> : null}
        </div>
    );
}

export function Field({
    label,
    hint,
    error,
    optional = false,
    required = false,
    children,
    className,
}: WebProps<FieldProps>) {
    return (
        <div className={cx("flex flex-col gap-1.5", className)}>
            <span className="text-sm font-medium text-ink-soft">
                {label}
                <Mark optional={optional} required={required} />
            </span>
            {children}
            {hint !== undefined ? <p className="text-xs text-muted">{hint}</p> : null}
            {error !== undefined && error !== null ? <Notice tone="danger">{error}</Notice> : null}
        </div>
    );
}

export function TextField({
    label,
    name,
    hint,
    error,
    optional = false,
    value,
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
    min,
    max,
    step,
    maxLength,
    className,
}: WebProps<TextFieldProps>) {
    const id = useId();
    const shared = {
        id,
        value,
        placeholder,
        disabled,
        autoFocus,
        maxLength,
        "aria-required": required,
        "aria-label": label === undefined ? (name ?? placeholder) : undefined,
        "aria-invalid": error !== undefined && error !== null ? true : undefined,
        className: inputClass(size, surface, width),
    };
    return (
        <Labelled
            className={className}
            id={id}
            label={label}
            hint={hint}
            error={error}
            optional={optional}
            required={required === true}
        >
            {multiline ? (
                <textarea
                    {...shared}
                    rows={rows}
                    onChange={(e) => {
                        onChange(e.target.value);
                    }}
                    className={`${shared.className} resize-none`}
                />
            ) : prefix !== undefined ? (
                <div
                    className={`flex items-center overflow-hidden rounded-md border border-line focus-within:border-accent ${surface === "bg" ? "bg-bg" : "bg-surface"} ${INPUT_WIDTH[width]}`}
                >
                    <span className="pl-3 text-sm text-muted">{prefix}</span>
                    <input
                        {...shared}
                        type={type === "number" ? "text" : type}
                        inputMode={type === "number" ? "decimal" : undefined}
                        autoComplete={autoComplete}
                        onChange={(e) => {
                            onChange(e.target.value);
                        }}
                        className={`min-w-0 flex-1 bg-transparent px-1 text-ink outline-hidden placeholder:text-muted ${INPUT_SIZE[size].replace(/px-\S+/, "")}`}
                    />
                </div>
            ) : (
                <input
                    {...shared}
                    type={type === "number" ? "text" : type}
                    inputMode={type === "number" ? "decimal" : undefined}
                    autoComplete={autoComplete}
                    min={min}
                    max={max}
                    step={step}
                    onChange={(e) => {
                        onChange(e.target.value);
                    }}
                    onKeyDown={
                        onSubmit === undefined
                            ? undefined
                            : (e) => {
                                  if (e.key === "Enter") {
                                      e.preventDefault();
                                      onSubmit();
                                  }
                              }
                    }
                />
            )}
        </Labelled>
    );
}

export function Select<K extends string>({
    label,
    name,
    hint,
    error,
    value,
    options,
    onChange,
    size = "md",
    disabled,
    className,
}: WebProps<SelectProps<K>>) {
    const id = useId();
    return (
        <Labelled
            className={className}
            id={id}
            label={label}
            hint={hint}
            error={error}
            optional={false}
            required={false}
        >
            <select
                id={id}
                value={value}
                disabled={disabled}
                aria-label={label === undefined ? name : undefined}
                onChange={(e) => {
                    const picked = options.find((o) => o.key === e.target.value);
                    if (picked !== undefined) onChange(picked.key);
                }}
                className={inputClass(size, "bg", size === "sm" ? "auto" : "full")}
            >
                {options.map((o) => (
                    <option key={o.key} value={o.key}>
                        {o.label}
                    </option>
                ))}
            </select>
        </Labelled>
    );
}

export function Toggle({
    label,
    hint,
    value,
    onChange,
    disabled,
    className,
}: WebProps<ToggleProps>) {
    return (
        <label className={cx("flex items-start gap-2.5 text-sm text-ink", className)}>
            <input
                type="checkbox"
                checked={value}
                disabled={disabled}
                onChange={(e) => {
                    onChange(e.target.checked);
                }}
                className="mt-0.5 h-4 w-4 accent-accent"
            />
            <span>
                <span className="font-medium">{label}</span>
                {hint !== undefined ? (
                    <span className="mt-0.5 block text-xs text-muted">{hint}</span>
                ) : null}
            </span>
        </label>
    );
}
