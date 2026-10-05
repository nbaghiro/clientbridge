import { type StepperProps, strings } from "@clientbridge/app-core/public";

const STEP =
    "flex h-7 w-7 items-center justify-center rounded-md border border-line text-sm text-ink-soft transition hover:bg-bg disabled:opacity-40";

export function Stepper({ value, onChange, min, max, label }: StepperProps) {
    return (
        <span className="inline-flex items-center gap-1.5">
            <button
                type="button"
                aria-label={strings.common.decrease(label)}
                disabled={min !== undefined && value <= min}
                onClick={() => {
                    onChange(value - 1);
                }}
                className={STEP}
            >
                −
            </button>
            <span aria-live="polite" className="min-w-6 text-center text-sm tabular-nums text-ink">
                {value}
            </span>
            <button
                type="button"
                aria-label={strings.common.increase(label)}
                disabled={max !== undefined && value >= max}
                onClick={() => {
                    onChange(value + 1);
                }}
                className={STEP}
            >
                +
            </button>
        </span>
    );
}
