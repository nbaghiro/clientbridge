import type { ChoiceProps } from "@clientbridge/app-core/public";

export function Choice<K extends string>({
    options,
    value,
    onChange,
    layout = "chips",
    label,
    columns,
    size,
}: ChoiceProps<K>) {
    if (layout === "tiles") {
        return (
            <Tiles
                options={options}
                value={value}
                onChange={onChange}
                label={label}
                columns={columns}
                size={size}
            />
        );
    }
    const chosen = (key: K): boolean =>
        Array.isArray(value) ? (value as readonly K[]).includes(key) : value === key;

    if (layout === "segmented") {
        return (
            <div
                role="group"
                aria-label={label}
                className="inline-flex self-start rounded-md border border-line bg-surface p-1 text-sm"
            >
                {options.map((o) => (
                    <button
                        key={o.key}
                        type="button"
                        aria-pressed={chosen(o.key)}
                        disabled={o.disabled}
                        onClick={() => {
                            onChange(o.key);
                        }}
                        className={`rounded px-3.5 py-1.5 font-medium transition disabled:opacity-50 ${
                            chosen(o.key)
                                ? "bg-accent text-accent-ink"
                                : "text-ink-soft hover:bg-bg"
                        }`}
                    >
                        {o.label}
                    </button>
                ))}
            </div>
        );
    }

    if (layout === "cards") {
        return (
            <div role="group" aria-label={label} className="grid gap-2 sm:grid-cols-2">
                {options.map((o) => (
                    <button
                        key={o.key}
                        type="button"
                        aria-pressed={chosen(o.key)}
                        disabled={o.disabled}
                        onClick={() => {
                            onChange(o.key);
                        }}
                        className={`rounded-md border px-3.5 py-3 text-left text-sm transition disabled:opacity-50 ${
                            chosen(o.key)
                                ? "border-accent bg-accent-weak text-accent-strong"
                                : "border-line bg-surface text-ink hover:bg-bg"
                        }`}
                    >
                        <span className="font-semibold">{o.label}</span>
                        {o.hint !== undefined ? (
                            <span className="mt-0.5 block text-xs text-muted">{o.hint}</span>
                        ) : null}
                    </button>
                ))}
            </div>
        );
    }

    return (
        <div role="group" aria-label={label} className="flex flex-wrap gap-2">
            {options.map((o) => (
                <button
                    key={o.key}
                    type="button"
                    aria-pressed={chosen(o.key)}
                    disabled={o.disabled}
                    onClick={() => {
                        onChange(o.key);
                    }}
                    className={`rounded-full border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
                        chosen(o.key)
                            ? "border-accent bg-accent text-accent-ink"
                            : "border-line bg-surface text-ink-soft hover:bg-bg"
                    }`}
                >
                    {o.label}
                    {o.hint !== undefined ? (
                        <span className={chosen(o.key) ? "opacity-80" : "text-muted"}>
                            {" "}
                            {o.hint}
                        </span>
                    ) : null}
                </button>
            ))}
        </div>
    );
}

const COLS = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4", 5: "grid-cols-5" } as const;

function Tiles<K extends string>({
    options,
    value,
    onChange,
    label,
    columns = 3,
    size = "md",
}: ChoiceProps<K>) {
    const lg = size === "lg";
    const chosen = (key: K): boolean =>
        Array.isArray(value) ? (value as readonly K[]).includes(key) : value === key;
    return (
        <div role="group" aria-label={label} className={`grid gap-2 ${COLS[columns]}`}>
            {options.map((o) => {
                const on = chosen(o.key);
                return (
                    <button
                        key={o.key}
                        type="button"
                        aria-pressed={on}
                        disabled={o.disabled}
                        onClick={() => {
                            onChange(o.key);
                        }}
                        className={`flex min-w-0 flex-col rounded-lg border text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                            lg ? "items-center px-3 py-5 text-center" : "px-3.5 py-3"
                        } ${on ? "border-accent bg-accent-weak shadow-[inset_0_0_0_1px_var(--accent)]" : "border-line bg-surface hover:border-accent-line hover:bg-bg"}`}
                    >
                        <span
                            className={`font-semibold ${on ? "text-accent-strong" : "text-ink"} ${lg ? "font-display text-2xl" : "text-sm"}`}
                        >
                            {o.label}
                        </span>
                        {o.hint !== undefined ? (
                            <span
                                className={`tabular-nums ${on ? "text-accent-strong" : "text-ink-soft"} ${lg ? "mt-1 text-base" : "mt-0.5 text-xs"}`}
                            >
                                {o.hint}
                            </span>
                        ) : null}
                        {o.detail !== undefined ? (
                            <span className="mt-1 text-xs leading-snug text-muted">{o.detail}</span>
                        ) : null}
                    </button>
                );
            })}
        </div>
    );
}
