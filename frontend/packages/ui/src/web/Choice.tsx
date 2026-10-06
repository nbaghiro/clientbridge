import {
    type ChoiceOption,
    type ChoiceProps,
    useControllable,
} from "@clientbridge/app-core/public";

import { moveFocus } from "./keys";
import { type WebProps, cx } from "./props";

const GROUP = {
    chips: "flex flex-wrap gap-2",
    segmented: "inline-flex self-start rounded-md border border-line bg-surface p-1 text-sm",
    cards: "grid gap-2 sm:grid-cols-2",
    tiles: "grid gap-2",
} as const;

const COLS = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4", 5: "grid-cols-5" } as const;

function optionClass(layout: keyof typeof GROUP, on: boolean, lg: boolean): string {
    if (layout === "segmented") {
        return `rounded px-3.5 py-1.5 font-medium transition disabled:opacity-50 ${
            on ? "bg-accent text-accent-ink" : "text-ink-soft hover:bg-bg"
        }`;
    }
    if (layout === "cards") {
        return `rounded-md border px-3.5 py-3 text-left text-sm transition disabled:opacity-50 ${
            on
                ? "border-accent bg-accent-weak text-accent-strong"
                : "border-line bg-surface text-ink hover:bg-bg"
        }`;
    }
    if (layout === "tiles") {
        return `flex min-w-0 flex-col rounded-lg border text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
            lg ? "items-center px-3 py-5 text-center" : "px-3.5 py-3"
        } ${
            on
                ? "border-accent bg-accent-weak shadow-[inset_0_0_0_1px_var(--accent)]"
                : "border-line bg-surface hover:border-accent-line hover:bg-bg"
        }`;
    }
    return `rounded-full border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
        on
            ? "border-accent bg-accent text-accent-ink"
            : "border-line bg-surface text-ink-soft hover:bg-bg"
    }`;
}

function OptionBody<K extends string>({
    option: o,
    layout,
    on,
    lg,
}: {
    option: ChoiceOption<K>;
    layout: keyof typeof GROUP;
    on: boolean;
    lg: boolean;
}) {
    if (layout === "segmented") return <>{o.label}</>;
    if (layout === "cards") {
        return (
            <>
                <span className="font-semibold">{o.label}</span>
                {o.hint !== undefined ? (
                    <span className="mt-0.5 block text-xs text-muted">{o.hint}</span>
                ) : null}
            </>
        );
    }
    if (layout === "tiles") {
        return (
            <>
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
            </>
        );
    }
    return (
        <>
            {o.label}
            {o.hint !== undefined ? (
                <span className={on ? "opacity-80" : "text-muted"}> {o.hint}</span>
            ) : null}
        </>
    );
}

export function Choice<K extends string>({
    options,
    value: valueProp,
    defaultValue = null,
    onChange,
    layout = "chips",
    label,
    columns = 3,
    size = "md",
    className,
}: WebProps<ChoiceProps<K>>) {
    const [value, setValue] = useControllable(valueProp, defaultValue);
    const many = Array.isArray(value);
    const chosen = (key: K): boolean =>
        many ? (value as readonly K[]).includes(key) : value === key;
    const press = (key: K): void => {
        if (valueProp === undefined) {
            const list = value as readonly K[];
            setValue(many ? (chosen(key) ? list.filter((k) => k !== key) : [...list, key]) : key);
        }
        onChange?.(key);
    };
    const lg = size === "lg";
    return (
        <div
            role="group"
            aria-label={label}
            onKeyDown={(e) => {
                moveFocus(e, "button", "both");
            }}
            className={cx(GROUP[layout], layout === "tiles" && COLS[columns], className)}
        >
            {options.map((o) => {
                const on = chosen(o.key);
                return (
                    <button
                        key={o.key}
                        type="button"
                        aria-pressed={on}
                        disabled={o.disabled}
                        onClick={() => {
                            press(o.key);
                        }}
                        className={optionClass(layout, on, lg)}
                    >
                        <OptionBody option={o} layout={layout} on={on} lg={lg} />
                    </button>
                );
            })}
        </div>
    );
}
