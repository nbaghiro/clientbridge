import type {
    CalendarEventCardProps,
    CalendarEventFlag,
    IconName,
} from "@clientbridge/app-core/public";
import { INTENT_COLORS, cssVar } from "@clientbridge/tokens";

import { Icon } from "./Icon";
import { type WebProps, cx } from "./props";

const FLAG_ICON: Record<CalendarEventFlag, IconName> = {
    online: "globe",
    recurring: "repeat",
    deposit_due: "dollar",
    addons: "bag",
    note: "note",
    walk_in: "user",
    class: "users",
};

const STATE = {
    idle: "",
    selected: "ring-2 ring-accent ring-offset-1 ring-offset-surface",
    dragging: "z-30 scale-[1.02] shadow-lg ring-2 ring-accent",
    refused: "z-30 shadow-lg ring-2 ring-danger",
    faded: "opacity-55",
} as const;

export function CalendarEventCard({
    headline,
    detail,
    time,
    intent,
    color,
    density = "full",
    flags = [],
    state = "idle",
    label,
    onPress,
    className,
}: WebProps<CalendarEventCardProps>) {
    const tone = INTENT_COLORS[intent];
    const pending = intent === "warning";
    return (
        <button
            type="button"
            aria-label={label}
            onClick={onPress}
            style={{
                backgroundColor: cssVar(tone.soft),
                color: cssVar(tone.ink),
                borderColor: cssVar(tone.line),
            }}
            className={cx(
                `group flex h-full w-full min-w-0 flex-col overflow-hidden rounded-md border-l-[3px] text-left text-xs leading-tight transition ${
                    pending ? "outline-1 -outline-offset-1 outline-dashed outline-warn/60" : ""
                } ${density === "compact" ? "justify-center px-1.5 py-0.5" : "px-2 py-1"} ${STATE[state]}`,
                className,
            )}
        >
            {density === "compact" ? (
                <span className="flex min-w-0 items-center gap-1">
                    {time !== "" ? <span className="shrink-0 font-semibold">{time}</span> : null}
                    <span className="truncate">{headline}</span>
                </span>
            ) : (
                <>
                    <span className="flex min-w-0 items-start gap-1">
                        <span className="min-w-0 flex-1 truncate font-semibold">{headline}</span>
                        {flags.length > 0 ? (
                            <span className="flex shrink-0 items-center gap-0.5 pt-px opacity-80">
                                {flags.map((f) => (
                                    <Icon key={f} name={FLAG_ICON[f]} size={11} />
                                ))}
                            </span>
                        ) : null}
                    </span>
                    {density === "regular" ? (
                        <span className="mt-0.5 flex min-w-0 items-center gap-1 opacity-90">
                            {color ? (
                                <span
                                    aria-hidden
                                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                                    style={{ backgroundColor: color }}
                                />
                            ) : null}
                            <span className="truncate">
                                {[time, detail].filter(Boolean).join(" · ")}
                            </span>
                        </span>
                    ) : (
                        <>
                            {detail !== undefined ? (
                                <span className="mt-0.5 flex min-w-0 items-center gap-1 opacity-90">
                                    {color ? (
                                        <span
                                            aria-hidden
                                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                                            style={{ backgroundColor: color }}
                                        />
                                    ) : null}
                                    <span className="truncate">{detail}</span>
                                </span>
                            ) : null}
                            <span className="mt-0.5 truncate opacity-75">{time}</span>
                        </>
                    )}
                </>
            )}
        </button>
    );
}
