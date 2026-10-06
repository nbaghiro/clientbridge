import {
    type SearchFieldKey,
    type SearchFieldProps,
    strings,
    useControllable,
} from "@clientbridge/app-core/public";
import type { KeyboardEvent } from "react";

import { Icon } from "./Icon";
import { type WebProps, type WithRef, cx } from "./props";

const KEYS: Partial<Record<string, SearchFieldKey>> = {
    ArrowUp: "up",
    ArrowDown: "down",
    Enter: "enter",
    Escape: "escape",
};

export function SearchField({
    value: valueProp,
    defaultValue = "",
    onChange,
    placeholder,
    autoFocus,
    onKey,
    trailing,
    size = "md",
    className,
    ref,
}: WebProps<SearchFieldProps> & WithRef<HTMLInputElement>) {
    const [value, setValue] = useControllable(valueProp, defaultValue, onChange);
    const large = size === "lg";
    const handle = (e: KeyboardEvent<HTMLInputElement>): void => {
        const key = KEYS[e.key];
        if (key !== undefined && onKey !== undefined) {
            e.preventDefault();
            onKey(key);
        }
    };
    return (
        <div
            className={cx(
                `flex items-center gap-2.5 ${large ? "px-5 py-4" : "rounded-md border border-line bg-surface px-3 py-2.5 focus-within:border-accent"}`,
                className,
            )}
        >
            <span className="text-muted">
                <Icon name="search" size={large ? 20 : 16} />
            </span>
            <input
                ref={ref}
                value={value}
                onChange={(e) => {
                    setValue(e.target.value);
                }}
                onKeyDown={handle}
                placeholder={placeholder}
                aria-label={placeholder}
                autoFocus={autoFocus}
                type="search"
                role={onKey !== undefined ? "combobox" : undefined}
                aria-expanded={onKey !== undefined ? value.length > 0 : undefined}
                className={`min-w-0 flex-1 bg-transparent text-ink outline-hidden placeholder:text-muted [&::-webkit-search-cancel-button]:hidden ${large ? "text-lg" : "text-sm"}`}
            />
            {value.length > 0 ? (
                <button
                    type="button"
                    onClick={() => {
                        setValue("");
                    }}
                    aria-label={strings.ui.clearSearch}
                    className="flex h-5 w-5 items-center justify-center rounded-full bg-surface2 text-muted hover:text-ink"
                >
                    <Icon name="x" size={12} />
                </button>
            ) : null}
            {trailing}
        </div>
    );
}
