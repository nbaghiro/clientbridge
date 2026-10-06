import type { CheckboxProps } from "@clientbridge/app-core/public";
import { useEffect, useId, useRef } from "react";

export function Checkbox({
    label,
    value,
    onChange,
    hideLabel = false,
    mixed = false,
    disabled = false,
}: CheckboxProps) {
    const id = useId();
    const ref = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (ref.current) ref.current.indeterminate = mixed && !value;
    }, [mixed, value]);
    return (
        <label
            htmlFor={id}
            className={`inline-flex items-center gap-2 text-sm text-ink ${disabled ? "opacity-60" : "cursor-pointer"}`}
        >
            <input
                ref={ref}
                id={id}
                type="checkbox"
                checked={value}
                disabled={disabled}
                onChange={(e) => {
                    onChange(e.target.checked);
                }}
                className="h-4 w-4 shrink-0 cursor-pointer rounded border-line accent-[var(--accent)]"
            />
            <span className={hideLabel ? "sr-only" : ""}>{label}</span>
        </label>
    );
}
