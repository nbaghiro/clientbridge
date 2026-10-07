import {
    type DateStripDay,
    type DateStripProps,
    strings,
    useControllable,
} from "@clientbridge/app-core/public";

import { Icon } from "./Icon";
import { moveFocus } from "./keys";
import { type WebProps, cx } from "./props";

export function DateStrip({
    days,
    value: valueProp,
    defaultValue = null,
    onChange,
    label,
    onPrev,
    onNext,
    prevLabel = strings.ui.previous,
    nextLabel = strings.ui.next,
    className,
}: WebProps<DateStripProps>) {
    const [value, setValue] = useControllable<string | null>(valueProp, defaultValue);
    return (
        <div className={cx("flex items-stretch gap-1", className)} role="group" aria-label={label}>
            {onPrev !== undefined ? (
                <button
                    type="button"
                    aria-label={prevLabel}
                    onClick={onPrev}
                    className="flex w-8 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-bg hover:text-ink"
                >
                    <Icon name="chevronLeft" size={18} />
                </button>
            ) : null}
            <div
                onKeyDown={(e) => {
                    moveFocus(e, "button", "horizontal");
                }}
                className="grid min-w-0 flex-1 gap-1"
                style={{ gridTemplateColumns: `repeat(${String(days.length)}, minmax(0, 1fr))` }}
            >
                {days.map((d: DateStripDay) => {
                    const on = d.key === value;
                    const off = d.disabled === true || d.closed === true;
                    return (
                        <button
                            key={d.key}
                            type="button"
                            aria-pressed={on}
                            disabled={off}
                            onClick={() => {
                                setValue(d.key);
                                onChange?.(d.key);
                            }}
                            className={`flex flex-col items-center rounded-md border px-1 py-1.5 transition ${
                                on
                                    ? "border-accent bg-accent text-accent-ink"
                                    : off
                                      ? "cursor-not-allowed border-transparent text-muted/60"
                                      : "border-transparent text-ink hover:border-line hover:bg-bg hover:text-ink"
                            }`}
                        >
                            <span
                                className={`text-[11px] font-medium uppercase tracking-wide ${on ? "" : d.isToday === true ? "text-accent" : "text-muted"}`}
                            >
                                {d.weekday}
                            </span>
                            <span
                                className={`text-base font-semibold tabular-nums ${off ? "line-through" : ""}`}
                            >
                                {d.day}
                            </span>
                            <span className="flex h-1.5 items-center gap-0.5">
                                {d.closed === true
                                    ? null
                                    : Array.from({ length: d.busy ?? 0 }, (_, i) => (
                                          <span
                                              key={i}
                                              className={`h-1 w-1 rounded-full ${on ? "bg-accent-ink" : "bg-accent"}`}
                                          />
                                      ))}
                            </span>
                        </button>
                    );
                })}
            </div>
            {onNext !== undefined ? (
                <button
                    type="button"
                    aria-label={nextLabel}
                    onClick={onNext}
                    className="flex w-8 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-bg hover:text-ink"
                >
                    <Icon name="chevronRight" size={18} />
                </button>
            ) : null}
        </div>
    );
}
