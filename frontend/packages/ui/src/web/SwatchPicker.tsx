import { type SwatchPickerProps, useControllable } from "@clientbridge/app-core/public";

import { Icon } from "./Icon";
import { moveFocus } from "./keys";
import { type WebProps, cx } from "./props";

export function SwatchPicker({
    label,
    colours,
    value: valueProp,
    defaultValue = "",
    onChange,
    className,
}: WebProps<SwatchPickerProps>) {
    const [value, setValue] = useControllable(valueProp, defaultValue, onChange);
    const picked = colours.some((c) => c.toLowerCase() === value.toLowerCase());
    return (
        <div
            role="radiogroup"
            aria-label={label}
            onKeyDown={(e) => {
                moveFocus(e, '[role="radio"]', "both");
            }}
            className={cx("flex flex-wrap gap-2", className)}
        >
            {colours.map((colour, i) => {
                const on = colour.toLowerCase() === value.toLowerCase();
                return (
                    <button
                        key={colour}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={colour}
                        tabIndex={on || (!picked && i === 0) ? 0 : -1}
                        onClick={() => {
                            setValue(colour);
                        }}
                        style={{ backgroundColor: colour }}
                        className={`flex h-9 w-9 items-center justify-center rounded-full text-on-data ring-offset-2 ring-offset-surface transition ${on ? "ring-2 ring-ink" : "hover:scale-105"}`}
                    >
                        {on ? <Icon name="check" size={16} /> : null}
                    </button>
                );
            })}
        </div>
    );
}
