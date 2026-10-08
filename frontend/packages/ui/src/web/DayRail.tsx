import { type DayRailProps, useControllable, strings } from "@clientbridge/app-core/public";
import { type WebProps } from "./props";
import { Icon } from "./Icon";
import { moveFocus } from "./keys";

export function DayRail({
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
}: WebProps<DayRailProps>) {
    const [value, setValue] = useControllable<string | null>(valueProp, defaultValue);
    const arrow = (dir: "prev" | "next") => {
        const fn = dir === "prev" ? onPrev : onNext;
        return (
            <button
                type="button"
                aria-label={dir === "prev" ? prevLabel : nextLabel}
                disabled={fn === undefined}
                onClick={fn}
                className="flex h-[68px] w-8 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-bg hover:text-ink disabled:opacity-30"
            >
                <Icon name={dir === "prev" ? "chevronLeft" : "chevronRight"} size={16} />
            </button>
        );
    };
    return (
        <div className={`flex items-center gap-1 ${className ?? ""}`}>
            {arrow("prev")}
            <div
                role="radiogroup"
                onKeyDown={(e) => {
                    moveFocus(e, '[role="radio"]', "both");
                }}
                aria-label={label}
                className="flex min-w-0 flex-1 snap-x gap-2 overflow-x-auto pb-1 [scrollbar-width:none]"
            >
                {days.map((d) => {
                    const on = d.key === value;
                    return (
                        <button
                            key={d.key}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            disabled={d.disabled}
                            onClick={() => {
                                setValue(d.key);
                                onChange?.(d.key);
                            }}
                            className={`flex h-[68px] min-w-[64px] flex-1 snap-start flex-col items-center justify-center rounded-xl border px-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                                on
                                    ? "border-accent bg-accent text-accent-ink"
                                    : d.disabled === true
                                      ? "cursor-not-allowed border-line-soft bg-bg text-muted/60"
                                      : "border-line bg-surface text-ink hover:border-accent"
                            }`}
                        >
                            <span
                                className={`text-[11px] font-semibold uppercase tracking-wide ${on ? "opacity-85" : "text-muted"}`}
                            >
                                {d.weekday}
                            </span>
                            <span className="text-lg font-bold leading-tight tabular-nums">
                                {d.day}
                            </span>
                            {d.hint !== undefined ? (
                                <span
                                    className={`text-[10.5px] font-medium ${on ? "opacity-85" : d.disabled === true ? "" : "text-accent"}`}
                                >
                                    {d.hint}
                                </span>
                            ) : null}
                        </button>
                    );
                })}
            </div>
            {arrow("next")}
        </div>
    );
}
