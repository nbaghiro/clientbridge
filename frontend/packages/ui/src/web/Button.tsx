import type {
    ButtonProps,
    ButtonVariant,
    ControlSize,
    ControlTone,
} from "@clientbridge/app-core/public";

import { Icon } from "./Icon";
import { type WebProps, type WithRef, cx } from "./props";

// Every hover sets its text colour with its fill, so the text never takes on the colour of the fill.
const VARIANT: Record<ControlTone, Record<ButtonVariant, string>> = {
    default: {
        primary:
            "rounded-md bg-accent font-semibold text-accent-ink hover:bg-accent/90 hover:text-accent-ink",
        outline:
            "rounded-md border border-line font-medium text-ink-soft hover:bg-bg hover:text-ink",
        quiet: "rounded-md font-medium text-ink-soft hover:bg-bg hover:text-ink",
        danger: "rounded-md border border-danger font-medium text-danger hover:bg-danger hover:text-surface",
        link: "font-medium text-accent hover:text-accent-strong hover:underline",
    },
    inverse: {
        primary:
            "rounded-md bg-inverse font-semibold text-inverse-ink hover:bg-inverse/85 hover:text-inverse-ink",
        outline:
            "rounded-md border border-inverse/60 font-medium text-inverse hover:border-inverse hover:bg-inverse hover:text-inverse-ink",
        quiet: "rounded-md font-medium text-inverse hover:bg-inverse/15 hover:text-inverse",
        danger: "rounded-md bg-inverse font-medium text-danger hover:bg-danger hover:text-inverse",
        link: "font-medium text-inverse hover:text-inverse hover:underline",
    },
};

const FOCUS: Record<ControlTone, string> = {
    default: "focus-visible:outline-accent",
    inverse: "focus-visible:outline-inverse",
};

const SIZE: Record<ControlSize, string> = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-4 py-2.5 text-sm",
};

const LINK_SIZE: Record<ControlSize, string> = { sm: "text-xs", md: "text-sm", lg: "text-sm" };

export function Button({
    children,
    onPress,
    variant = "primary",
    size = "md",
    submit = false,
    disabled = false,
    busy = false,
    full = false,
    grow = false,
    icon,
    label,
    tone = "default",
    className,
    ref,
}: WebProps<ButtonProps> & WithRef<HTMLButtonElement>) {
    const sizing = variant === "link" ? LINK_SIZE[size] : SIZE[size];
    return (
        <button
            ref={ref}
            type={submit ? "submit" : "button"}
            onClick={onPress}
            disabled={disabled || busy}
            aria-busy={busy || undefined}
            aria-label={label}
            className={cx(
                `inline-flex shrink-0 items-center justify-center gap-1.5 transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 ${VARIANT[tone][variant]} ${FOCUS[tone]} ${sizing} ${full ? "w-full" : ""} ${grow ? "flex-1" : ""}`,
                className,
            )}
        >
            {busy ? (
                <span
                    aria-hidden
                    className={`animate-spin rounded-full border-2 border-current border-t-transparent ${size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"}`}
                />
            ) : typeof icon === "string" ? (
                <Icon name={icon} size={size === "sm" ? 14 : 16} />
            ) : (
                icon
            )}
            {children}
        </button>
    );
}
