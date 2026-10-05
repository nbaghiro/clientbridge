import type { ButtonProps, ButtonVariant, ControlSize } from "@clientbridge/app-core/public";

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
}: ButtonProps) {
    const sizing = variant === "link" ? LINK_SIZE[size] : SIZE[size];
    return (
        <button
            type={submit ? "submit" : "button"}
            onClick={onPress}
            disabled={disabled || busy}
            aria-busy={busy || undefined}
            aria-label={label}
            className={`inline-flex shrink-0 items-center justify-center gap-1.5 transition disabled:opacity-60 ${VARIANT[variant]} ${sizing} ${full ? "w-full" : ""} ${grow ? "flex-1" : ""}`}
        >
            {icon}
            {children}
        </button>
    );
}
