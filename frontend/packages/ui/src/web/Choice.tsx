import type { ChoiceProps } from "@clientbridge/app-core/public";

export function Choice<K extends string>({
    options,
    value,
    onChange,
    layout = "chips",
    label,
}: ChoiceProps<K>) {
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
