import { type ControlTone, type IconButtonProps, strings } from "@clientbridge/app-core/public";

import { Icon } from "./Icon";
import { type WebProps, type WithRef, cx } from "./props";

// Each look pairs its hover fill with a hover text colour, so the glyph stays readable.
const LOOK: Record<
    ControlTone,
    { quiet: string; outline: string; pressed: string; focus: string }
> = {
    default: {
        quiet: "text-ink-soft hover:bg-bg hover:text-ink",
        outline: "border border-line bg-surface text-ink-soft hover:bg-bg hover:text-ink",
        pressed:
            "border-accent-line bg-accent-weak text-accent hover:bg-accent-weak hover:text-accent-strong",
        focus: "focus-visible:outline-accent",
    },
    inverse: {
        quiet: "text-inverse hover:bg-inverse/15 hover:text-inverse",
        outline:
            "border border-inverse/60 text-inverse hover:border-inverse hover:bg-inverse hover:text-inverse-ink",
        pressed:
            "border-inverse bg-inverse text-inverse-ink hover:bg-inverse/85 hover:text-inverse-ink",
        focus: "focus-visible:outline-inverse",
    },
};

export function IconButton({
    icon,
    label,
    onPress,
    badge,
    variant = "quiet",
    size = "md",
    pressed,
    disabled = false,
    tone = "default",
    className,
    ref,
}: WebProps<IconButtonProps> & WithRef<HTMLButtonElement>) {
    const count =
        typeof badge === "number" && badge > 0 ? (badge > 99 ? "99+" : String(badge)) : null;
    return (
        <button
            ref={ref}
            type="button"
            onClick={onPress}
            disabled={disabled}
            aria-label={count !== null ? strings.ui.withCount(label, count) : label}
            aria-pressed={pressed}
            title={label}
            className={cx(
                `relative inline-flex shrink-0 items-center justify-center rounded-md transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 ${
                    pressed === true
                        ? `${variant === "outline" ? "border" : ""} ${LOOK[tone].pressed}`
                        : LOOK[tone][variant]
                } ${LOOK[tone].focus} ${size === "sm" ? "h-8 w-8" : "h-9 w-9"}`,
                className,
            )}
        >
            <Icon name={icon} size={size === "sm" ? 16 : 19} />
            {count !== null ? (
                <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-surface bg-danger px-1 text-[10px] font-bold leading-none text-surface">
                    {count}
                </span>
            ) : badge === true ? (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full border border-surface bg-danger" />
            ) : null}
        </button>
    );
}
