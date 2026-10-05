import type { SearchFieldProps } from "@clientbridge/app-core/public";

import { IconSearch } from "./Icons";

export function SearchField({ value, onChange, placeholder, autoFocus }: SearchFieldProps) {
    return (
        <div className="relative">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
                value={value}
                onChange={(e) => {
                    onChange(e.target.value);
                }}
                placeholder={placeholder}
                aria-label={placeholder}
                autoFocus={autoFocus}
                type="search"
                className="w-full rounded-md border border-line bg-surface py-2.5 pl-9 pr-3 text-sm outline-hidden placeholder:text-muted focus:border-accent"
            />
        </div>
    );
}
