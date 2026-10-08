import { type OptionCardProps } from "@clientbridge/app-core/public";
import { type WebProps, type WithRef } from "./props";
import { Icon } from "./Icon";

export function OptionCard({
    title,
    subtitle,
    detail,
    leading,
    trailing,
    footer,
    selected,
    onPress,
    disabled,
    layout = "row",
    size = "md",
    label,
    className,
    ref,
}: WebProps<OptionCardProps> & WithRef<HTMLButtonElement>) {
    const on = selected === true;
    const pad = size === "lg" ? "p-4" : size === "sm" ? "py-2 pl-2 pr-3" : "p-3";
    return (
        <button
            ref={ref}
            type="button"
            aria-pressed={selected}
            aria-label={label}
            disabled={disabled}
            onClick={onPress}
            className={`group relative flex w-full min-w-0 rounded-xl border bg-surface text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55 ${
                layout === "stack"
                    ? "flex-col overflow-hidden"
                    : `items-center ${size === "sm" ? "gap-2" : "gap-3"} ${pad}`
            } ${on ? "border-accent shadow-[0_0_0_1px_var(--accent)] bg-accent-weak/50" : "border-line hover:border-accent-line hover:shadow-card"} ${className ?? ""}`}
        >
            {layout === "stack" && leading !== undefined ? (
                <span className="block w-full">{leading}</span>
            ) : null}
            {layout === "row" && leading !== undefined ? (
                <span className="shrink-0">{leading}</span>
            ) : null}
            <span
                className={`flex min-w-0 flex-1 items-start gap-3 ${layout === "stack" ? pad : ""}`}
            >
                <span className="min-w-0 flex-1">
                    <span
                        className={`block font-semibold text-ink ${size === "lg" ? "text-base" : size === "sm" ? "truncate text-sm" : "text-[15px]"} leading-snug`}
                    >
                        {title}
                    </span>
                    {subtitle !== undefined ? (
                        <span className="mt-0.5 block text-[13px] text-muted">{subtitle}</span>
                    ) : null}
                    {detail !== undefined ? (
                        <span className="mt-1.5 line-clamp-2 block text-[13px] leading-relaxed text-ink-soft">
                            {detail}
                        </span>
                    ) : null}
                    {footer !== undefined ? <span className="mt-2 block">{footer}</span> : null}
                </span>
                {trailing !== undefined ? (
                    <span className="shrink-0 text-right">{trailing}</span>
                ) : null}
            </span>
            {selected !== undefined && size !== "sm" ? (
                <span
                    aria-hidden
                    className={`absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full border transition ${
                        on
                            ? "border-accent bg-accent text-accent-ink"
                            : "border-line bg-surface text-transparent"
                    } ${layout === "row" && trailing !== undefined ? "hidden" : ""}`}
                >
                    <Icon name="check" size={12} />
                </span>
            ) : null}
        </button>
    );
}
