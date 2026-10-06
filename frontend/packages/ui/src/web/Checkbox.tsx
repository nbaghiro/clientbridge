import { type CheckboxProps, useControllable } from "@clientbridge/app-core/public";
import { useEffect, useId, useRef } from "react";

import { type WebProps, type WithRef, cx, mergeRefs } from "./props";

export function Checkbox({
    label,
    value: valueProp,
    defaultValue = false,
    onChange,
    hideLabel = false,
    mixed = false,
    disabled = false,
    className,
    ref,
}: WebProps<CheckboxProps> & WithRef<HTMLInputElement>) {
    const id = useId();
    const [value, setValue] = useControllable(valueProp, defaultValue, onChange);
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (input.current) input.current.indeterminate = mixed && !value;
    }, [mixed, value]);
    return (
        <label
            htmlFor={id}
            className={cx(
                `inline-flex items-center gap-2 text-sm text-ink ${disabled ? "opacity-60" : "cursor-pointer"}`,
                className,
            )}
        >
            <input
                ref={mergeRefs(input, ref)}
                id={id}
                type="checkbox"
                checked={value}
                disabled={disabled}
                onChange={(e) => {
                    setValue(e.target.checked);
                }}
                className="h-4 w-4 shrink-0 cursor-pointer rounded border-line accent-[var(--accent)]"
            />
            <span className={hideLabel ? "sr-only" : ""}>{label}</span>
        </label>
    );
}
