import type { SwatchPickerProps } from "@clientbridge/app-core/public";

import { Icon } from "./Icon";

export function SwatchPicker({ label, colours, value, onChange }: SwatchPickerProps) {
    return (
        <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
            {colours.map((colour) => {
                const on = colour.toLowerCase() === value.toLowerCase();
                return (
                    <button
                        key={colour}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={colour}
                        onClick={() => {
                            onChange(colour);
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
