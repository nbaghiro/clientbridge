import {
    type TimeSlot,
    type TimeSlotPickerProps,
    useControllable,
} from "@clientbridge/app-core/public";

import { moveFocus } from "./keys";
import { type WebProps, cx } from "./props";

const COLS = {
    3: "grid-cols-3",
    4: "grid-cols-3 sm:grid-cols-4",
    5: "grid-cols-3 sm:grid-cols-5",
} as const;

export function TimeSlotPicker({
    groups,
    value: valueProp,
    defaultValue = null,
    onChange,
    label,
    columns = 4,
    className,
}: WebProps<TimeSlotPickerProps>) {
    const [value, setValue] = useControllable<string | null>(valueProp, defaultValue);
    return (
        <div
            role="radiogroup"
            aria-label={label}
            onKeyDown={(e) => {
                moveFocus(e, '[role="radio"]', "both");
            }}
            className={cx("space-y-4", className)}
        >
            {groups.map((g) => (
                <div key={g.label}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                        {g.label}
                    </p>
                    <div className={`grid gap-2 ${COLS[columns]}`}>
                        {g.slots.map((slot: TimeSlot) => {
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
                                    className={`rounded-md border px-2 py-2 text-center text-sm font-medium tabular-nums transition ${
                                        on
                                            ? "border-accent bg-accent text-accent-ink"
                                            : slot.disabled === true
                                              ? "cursor-not-allowed border-line-soft text-muted/60 line-through"
                                              : "border-line bg-surface text-ink hover:border-accent hover:text-accent"
                                    }`}
                                >
                                    {slot.label}
                                    {slot.hint !== undefined ? (
                                        <span
                                            className={`block text-[11px] font-normal ${on ? "opacity-85" : "text-muted"}`}
                                        >
                                            {slot.hint}
                                        </span>
                                    ) : null}
                                </button>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}
