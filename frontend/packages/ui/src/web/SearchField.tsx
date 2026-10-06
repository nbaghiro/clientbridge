import { type SearchFieldProps, strings, type SearchFieldKey } from "@clientbridge/app-core/public";
import type { KeyboardEvent } from "react";

import { Icon } from "./Icon";

const KEYS: Partial<Record<string, SearchFieldKey>> = {
    ArrowUp: "up",
    ArrowDown: "down",
    Enter: "enter",
    Escape: "escape",
};

/** The real SearchField plus a clear button, key handling for result lists, a trailing slot and a large size. */
export function SearchField({
    value,
    onChange,
    placeholder,
    autoFocus,
    onKey,
    trailing,
    size = "md",
}: SearchFieldProps) {
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
            className={`flex items-center gap-2.5 ${large ? "px-5 py-4" : "rounded-md border border-line bg-surface px-3 py-2.5 focus-within:border-accent"}`}
        >
            <span className="text-muted">
                <Icon name="search" size={large ? 20 : 16} />
            </span>
            <input
                value={value}
                onChange={(e) => {
                    onChange(e.target.value);
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
                        onChange("");
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
