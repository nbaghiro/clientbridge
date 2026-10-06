import type { IconButtonProps } from "@clientbridge/app-core/public";

import { Icon } from "./Icon";

export function IconButton({
    icon,
    label,
    onPress,
    badge,
    variant = "quiet",
    size = "md",
    pressed,
}: IconButtonProps) {
    const count =
        typeof badge === "number" && badge > 0 ? (badge > 99 ? "99+" : String(badge)) : null;
    return (
        <button
            type="button"
            onClick={onPress}
            aria-label={count ? `${label}, ${count}` : label}
            aria-pressed={pressed}
            title={label}
            className={`relative inline-flex shrink-0 items-center justify-center rounded-md text-ink-soft transition hover:bg-bg hover:text-ink ${
                variant === "outline" ? "border border-line bg-surface" : ""
            } ${pressed ? "bg-accent-weak text-accent" : ""} ${size === "sm" ? "h-8 w-8" : "h-9 w-9"}`}
        >
            <Icon name={icon} size={size === "sm" ? 16 : 19} />
            {count ? (
                <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-surface bg-danger px-1 text-[10px] font-bold leading-none text-surface">
                    {count}
                </span>
            ) : badge === true ? (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full border border-surface bg-danger" />
            ) : null}
        </button>
    );
}
