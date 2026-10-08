import type { TabsProps } from "@clientbridge/app-core/public";

import { moveFocus } from "./keys";
import { type WebProps, cx } from "./props";

export function Tabs<K extends string>({
    items,
    active,
    onSelect,
    label,
    variant = "underline",
    className,
}: WebProps<TabsProps<K>>) {
    const pill = variant === "pill";
    return (
        <nav
            role="tablist"
            aria-label={label}
            onKeyDown={(e) => {
                moveFocus(e, '[role="tab"]', "horizontal");
            }}
            className={cx(
                "flex max-w-full overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                pill ? "gap-2 text-sm" : "gap-6 pb-px text-sm font-medium",
                className,
            )}
        >
            {items.map((item) => {
                const on = item.key === active;
                return (
                    <button
                        key={item.key}
                        type="button"
                        role="tab"
                        aria-selected={on}
                        tabIndex={on ? 0 : -1}
                        onClick={() => {
                            onSelect(item.key);
                        }}
                        className={
                            pill
                                ? `shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 font-medium transition ${
                                      on
                                          ? "border-accent bg-accent text-accent-ink"
                                          : "border-line bg-surface text-ink-soft hover:bg-bg hover:text-ink"
                                  }`
                                : `-mb-px shrink-0 whitespace-nowrap border-b-2 pb-3 pt-1 transition ${
                                      on
                                          ? "border-accent text-ink"
                                          : "border-transparent text-muted hover:text-ink-soft"
                                  }`
                        }
                    >
                        {item.label}
                    </button>
                );
            })}
        </nav>
    );
}
