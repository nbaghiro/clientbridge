import {
    type WeeklyHoursDay,
    type WeeklyHoursEditorProps,
    strings,
} from "@clientbridge/app-core/public";

import { Button } from "./Button";
import { Select, Toggle } from "./Field";
import type { WebProps } from "./props";

export function WeeklyHoursEditor({
    days,
    timeOptions,
    onOpen,
    onTime,
    onCopy,
    copyLabel,
    closedLabel,
    toLabel,
    hoursLabel,
    className,
}: WebProps<WeeklyHoursEditorProps>) {
    const firstOpen = days.find((d) => d.open)?.weekday;
    return (
        <div className={className}>
            {onCopy !== undefined && firstOpen !== undefined ? (
                <div className="-mt-1 flex justify-end">
                    <Button
                        size="sm"
                        variant="link"
                        onPress={() => {
                            onCopy(firstOpen);
                        }}
                    >
                        {copyLabel}
                    </Button>
                </div>
            ) : null}
            <ul className="divide-y divide-line-soft">
                {days.map((d: WeeklyHoursDay) => (
                    <li
                        key={d.weekday}
                        className="flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-1 py-2"
                    >
                        <div className="w-28 shrink-0">
                            <Toggle
                                label={d.label}
                                value={d.open}
                                onChange={(open) => {
                                    onOpen(d.weekday, open);
                                }}
                            />
                        </div>
                        {d.open ? (
                            <div className="flex flex-1 items-center gap-2">
                                <div>
                                    <Select
                                        name={strings.ui.startOf(d.label)}
                                        size="sm"
                                        value={d.start}
                                        options={timeOptions}
                                        onChange={(v) => {
                                            onTime(d.weekday, "start", v);
                                        }}
                                    />
                                </div>
                                <span className="text-sm text-muted">{toLabel}</span>
                                <div>
                                    <Select
                                        name={strings.ui.endOf(d.label)}
                                        size="sm"
                                        value={d.end}
                                        options={timeOptions}
                                        onChange={(v) => {
                                            onTime(d.weekday, "end", v);
                                        }}
                                    />
                                </div>
                                {d.error !== null ? (
                                    <span role="alert" className="text-xs font-medium text-danger">
                                        {d.error}
                                    </span>
                                ) : (
                                    <span className="text-xs tabular-nums text-muted">
                                        {hoursLabel(d.hours)}
                                    </span>
                                )}
                            </div>
                        ) : (
                            <span className="text-sm text-muted">{closedLabel}</span>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}
