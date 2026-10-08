import { type ActionTileProps } from "@clientbridge/app-core/public";
import { type WebProps, type WithRef } from "./props";
import { Icon } from "./Icon";

export function ActionTile({
    icon,
    label,
    hint,
    onPress,
    disabled,
    layout = "tile",
    variant = "plain",
    className,
    ref,
}: WebProps<ActionTileProps> & WithRef<HTMLButtonElement>) {
    const inv = variant === "inverse";
    return (
        <button
            ref={ref}
            type="button"
            disabled={disabled}
            onClick={onPress}
            className={`group flex min-w-0 rounded-xl border text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                layout === "tile"
                    ? "flex-col items-center gap-2 px-2 py-3.5 text-center"
                    : "items-center gap-3 px-3.5 py-3"
            } ${inv ? "border-inverse/20 bg-inverse/10 text-inverse hover:bg-inverse/20" : "border-line bg-surface text-ink hover:border-accent-line hover:bg-accent-weak/40"} ${className ?? ""}`}
        >
            <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${inv ? "bg-inverse/15" : "bg-accent-weak text-accent"}`}
            >
                <Icon name={icon} size={18} />
            </span>
            <span className="min-w-0">
                <span className="block text-[13px] font-semibold leading-tight">{label}</span>
                {hint !== undefined ? (
                    <span
                        className={`mt-0.5 block truncate text-xs ${inv ? "text-inverse/70" : "text-muted"}`}
                    >
                        {hint}
                    </span>
                ) : null}
            </span>
        </button>
    );
}
