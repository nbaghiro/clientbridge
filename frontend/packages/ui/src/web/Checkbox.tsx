import { type CheckboxProps, useControllable } from "@clientbridge/app-core/public";
import { useEffect, useId, useRef } from "react";

import { Icon } from "./Icon";
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
                `relative inline-flex items-center gap-2 text-sm text-ink ${disabled ? "opacity-60" : "cursor-pointer"}`,
                className,
            )}
        >
            <span className="relative inline-flex shrink-0">
                <input
                    ref={mergeRefs(input, ref)}
                    id={id}
                    type="checkbox"
                    checked={value}
                    disabled={disabled}
                    onChange={(e) => {
                        setValue(e.target.checked);
                    }}
                    className="peer h-4 w-4 cursor-pointer appearance-none rounded border border-line bg-bg transition checked:border-accent checked:bg-accent indeterminate:border-accent indeterminate:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default"
                />
                <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 hidden items-center justify-center text-accent-ink peer-checked:flex peer-indeterminate:flex"
                >
                    <Icon name={mixed && !value ? "minus" : "check"} size={12} />
                </span>
            </span>
            <span className={hideLabel ? "sr-only" : ""}>{label}</span>
        </label>
    );
}
