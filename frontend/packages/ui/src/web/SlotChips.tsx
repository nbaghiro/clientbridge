import { type SlotChipsProps, type TimeSlot, useControllable } from "@clientbridge/app-core/public";
import { type WebProps } from "./props";
import { moveFocus } from "./keys";

const COLS = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-3 sm:grid-cols-4" } as const;

export function SlotChips({
    groups,
    value: valueProp,
    defaultValue = null,
    onChange,
    label,
    layout = "grid",
    columns = 3,
    size = "lg",
    className,
}: WebProps<SlotChipsProps>) {
    const [value, setValue] = useControllable<string | null>(valueProp, defaultValue);
    const chip = (slot: TimeSlot) => {
        const on = slot.key === value;
        return (
            <button
                key={slot.key}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={slot.disabled}
                onClick={() => {
                    setValue(slot.key);
                    onChange?.(slot.key);
                }}
                className={`flex shrink-0 flex-col items-center justify-center whitespace-nowrap rounded-xl border font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 ${
                    size === "lg" ? "min-h-12 px-3 text-[15px]" : "min-h-10 px-2.5 text-sm"
                } ${layout === "rail" ? "min-w-[92px] snap-start" : "min-w-0"} ${
                    on
                        ? "border-accent bg-accent text-accent-ink shadow-[0_6px_16px_-8px_var(--accent)]"
                        : slot.disabled === true
                          ? "cursor-not-allowed border-line-soft text-muted/60 line-through"
                          : "border-line bg-surface text-ink hover:border-accent hover:text-accent"
                }`}
            >
                {slot.label}
                {slot.hint !== undefined ? (
                    <span
                        className={`block max-w-full truncate text-[11px] font-normal ${on ? "opacity-85" : "text-muted"}`}
                    >
                        {slot.hint}
                    </span>
                ) : null}
            </button>
        );
    };
    return (
        <div
            role="radiogroup"
            onKeyDown={(e) => {
                moveFocus(e, '[role="radio"]', "both");
            }}
            aria-label={label}
            className={`space-y-4 ${className ?? ""}`}
        >
            {groups.map((g) => (
                <div key={g.label === "" ? (g.slots[0]?.key ?? "none") : g.label}>
                    {g.label !== "" ? (
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                            {g.label}
                        </p>
                    ) : null}
                    {layout === "stack" ? (
                        <div className="flex flex-col gap-1.5">{g.slots.map(chip)}</div>
                    ) : layout === "rail" ? (
                        <div className="-mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
                            {g.slots.map(chip)}
                        </div>
                    ) : (
                        <div className={`grid gap-2 ${COLS[columns]}`}>{g.slots.map(chip)}</div>
                    )}
                </div>
            ))}
        </div>
    );
}
