import type { ButtonProps, ButtonVariant, ControlSize } from "@clientbridge/app-core/public";

import { Icon } from "./Icon";
import { type WebProps, type WithRef, cx } from "./props";

const VARIANT: Record<ButtonVariant, string> = {
    primary: "rounded-md bg-accent font-semibold text-accent-ink hover:opacity-90",
    outline: "rounded-md border border-line font-medium text-ink-soft hover:bg-bg",
    quiet: "rounded-md font-medium text-ink-soft hover:bg-bg",
    danger: "rounded-md border border-danger font-medium text-danger hover:bg-danger hover:text-surface",
    link: "font-medium text-accent hover:underline",
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
                `inline-flex shrink-0 items-center justify-center gap-1.5 transition disabled:opacity-60 ${VARIANT[variant]} ${sizing} ${full ? "w-full" : ""} ${grow ? "flex-1" : ""}`,
                className,
            )}
        >
            {typeof icon === "string" ? <Icon name={icon} size={size === "sm" ? 14 : 16} /> : icon}
            {children}
        </button>
    );
}
