import {
    type FieldProps,
    type TextFieldProps,
    type ToggleProps,
    strings,
    useControllable,
} from "@clientbridge/app-core/public";
import { type ReactNode, useId, useMemo } from "react";

import { Notice } from "./Notice";
import { type WebProps, type WithRef, cx, mergeRefs } from "./props";

const INPUT_SIZE = { sm: "px-2 py-1 text-xs", md: "px-3 py-2 text-sm", lg: "px-3 py-2.5" } as const;
const INPUT_WIDTH = { full: "w-full", narrow: "w-32", auto: "" } as const;
const SURFACE = { bg: "bg-bg", surface: "bg-surface [--field-fill:var(--surface)]" } as const;

// The one look of a text box, shared by every field that opens a picker so they line up.
export function fieldClass(
    size: keyof typeof INPUT_SIZE,
    surface: keyof typeof SURFACE,
    width: keyof typeof INPUT_WIDTH,
): string {
    return `${INPUT_WIDTH[width]} rounded-md border border-line ${SURFACE[surface]} ${INPUT_SIZE[size]} text-ink outline-hidden transition placeholder:text-muted focus:border-accent aria-invalid:border-danger disabled:opacity-60`;
}

function Mark({ optional, required }: { optional: boolean; required: boolean }) {
    if (required) return <span className="text-danger"> *</span>;
    if (optional) return <span className="font-normal text-muted"> {strings.common.optional}</span>;
    return null;
}

export function Labelled({
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
    min,
    max,
    step,
    maxLength,
    className,
    ref,
}: WebProps<TextFieldProps> & WithRef<HTMLInputElement | HTMLTextAreaElement>) {
    const [value, setValue] = useControllable(valueProp, defaultValue, onChange);
    const id = useId();
    const inputRef = useMemo(() => mergeRefs(ref), [ref]);
    const shared = {
        id,
        ref: inputRef,
        value,
        placeholder,
        disabled,
        autoFocus,
        maxLength,
        "aria-required": required,
        "aria-label": label === undefined ? (name ?? placeholder) : undefined,
        "aria-invalid": error !== undefined && error !== null ? true : undefined,
        className: fieldClass(size, surface, width),
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
                        setValue(e.target.value);
                    }}
                    className={`${shared.className} resize-none`}
                />
            ) : prefix !== undefined ? (
                <div
                    className={`flex items-center overflow-hidden rounded-md border border-line focus-within:border-accent ${SURFACE[surface]} ${INPUT_WIDTH[width]}`}
                >
                    <span className="pl-3 text-sm text-muted">{prefix}</span>
                    <input
                        {...shared}
                        type={type === "number" ? "text" : type}
                        inputMode={type === "number" ? "decimal" : undefined}
                        autoComplete={autoComplete}
                        onChange={(e) => {
                            setValue(e.target.value);
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
                        setValue(e.target.value);
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

export function Toggle({
    label,
    hint,
    value: valueProp,
    defaultValue = false,
    onChange,
    disabled,
    className,
}: WebProps<ToggleProps>) {
    const [value, setValue] = useControllable(valueProp, defaultValue, onChange);
    return (
        <label
            className={cx(
                `flex items-start gap-2.5 text-sm text-ink ${disabled === true ? "opacity-60" : "cursor-pointer"}`,
                className,
            )}
        >
            <span className="relative mt-px inline-flex shrink-0">
                <input
                    type="checkbox"
                    role="switch"
                    checked={value}
                    disabled={disabled}
                    onChange={(e) => {
                        setValue(e.target.checked);
                    }}
                    className="peer h-[18px] w-8 cursor-pointer appearance-none rounded-full border border-line bg-surface2 transition checked:border-accent checked:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default"
                />
                <span
                    aria-hidden
                    className="pointer-events-none absolute left-[3px] top-[3px] h-3 w-3 rounded-full bg-surface shadow-sm ring-1 ring-line transition peer-checked:translate-x-3.5 peer-checked:ring-0"
                />
            </span>
            <span>
                <span className="font-medium">{label}</span>
                {hint !== undefined ? (
                    <span className="mt-0.5 block text-xs text-muted">{hint}</span>
                ) : null}
            </span>
        </label>
    );
}
