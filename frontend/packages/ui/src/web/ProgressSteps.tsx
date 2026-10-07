import {
    type ProgressStepState,
    type ProgressStepsProps,
    type ProgressStep,
} from "@clientbridge/app-core/public";

import { Icon } from "./Icon";
import { type WebProps, cx } from "./props";

const DOT: Record<ProgressStepState, string> = {
    done: "bg-accent text-accent-ink",
    current: "border-2 border-accent bg-surface text-accent",
    todo: "border-2 border-line bg-surface text-muted",
    blocked: "bg-warn-bg text-warn-fg",
};

function Dot({ state, n }: { state: ProgressStepState; n: number }) {
    return (
        <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${DOT[state]}`}
        >
            {state === "done" ? (
                <Icon name="check" size={14} />
            ) : state === "blocked" ? (
                <Icon name="alert" size={13} />
            ) : (
                n
            )}
        </span>
    );
}

export function ProgressSteps({
    steps,
    layout = "row",
    label,
    className,
}: WebProps<ProgressStepsProps>) {
    if (layout === "row") {
        return (
            <ol
                aria-label={label}
                className={cx("flex min-w-0 items-center gap-2 sm:gap-3", className)}
            >
                {steps.map((s: ProgressStep, i) => (
                    <li
                        key={s.key}
                        aria-current={s.state === "current" ? "step" : undefined}
                        className={`flex items-center gap-2 sm:gap-3 ${s.state === "current" ? "shrink-0" : "min-w-0"}`}
                    >
                        <Dot state={s.state} n={i + 1} />
                        <span
                            className={`text-sm ${s.state === "current" ? "shrink-0 whitespace-nowrap font-semibold text-ink" : `truncate ${s.state === "done" ? "font-medium text-ink-soft" : "text-muted"} sr-only sm:not-sr-only`}`}
                        >
                            {s.label}
                        </span>
                        {i < steps.length - 1 ? (
                            <span
                                aria-hidden
                                className={`h-px w-4 shrink-0 sm:w-8 ${s.state === "done" ? "bg-accent" : "bg-line"}`}
                            />
                        ) : null}
                    </li>
                ))}
            </ol>
        );
    }
    return (
        <ol className={className} aria-label={label}>
            {steps.map((s, i) => (
                <li
                    key={s.key}
                    className="flex gap-3"
                    aria-current={s.state === "current" ? "step" : undefined}
                >
                    <span className="flex flex-col items-center">
                        <Dot state={s.state} n={i + 1} />
                        {i < steps.length - 1 ? (
                            <span
                                className={`my-1 w-0.5 flex-1 rounded-full ${s.state === "done" ? "bg-accent" : "bg-line"}`}
                            />
                        ) : null}
                    </span>
                    <span className={`flex-1 pt-1 ${i < steps.length - 1 ? "pb-5" : ""}`}>
                        <span
                            className={`block text-sm ${s.state === "todo" ? "font-medium text-muted" : "font-semibold text-ink"}`}
                        >
                            {s.label}
                        </span>
                        {s.hint !== undefined ? (
                            <span
                                className={`mt-0.5 block text-xs leading-snug ${s.state === "blocked" ? "text-warn-fg" : "text-muted"}`}
                            >
                                {s.hint}
                            </span>
                        ) : null}
                    </span>
                </li>
            ))}
        </ol>
    );
}
