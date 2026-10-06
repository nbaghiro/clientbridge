import { type AvatarProps, initials } from "@clientbridge/app-core/public";
import { tint } from "@clientbridge/tokens";

const SIZE = {
    sm: "h-7 w-7 text-[11px]",
    md: "h-9 w-9 text-xs",
    lg: "h-11 w-11 text-sm",
    xl: "h-16 w-16 text-lg",
} as const;

export function Avatar({ name, size = "md", color }: AvatarProps) {
    const tinted = color ? { backgroundColor: tint(color, 12), color } : undefined;
    return (
        <span
            aria-hidden
            style={tinted}
            className={`flex shrink-0 select-none items-center justify-center rounded-avatar font-bold ${
                tinted ? "" : "bg-accent-weak text-accent"
            } ${SIZE[size]}`}
        >
            {/^\p{L}/u.test(name) ? initials(name) : "#"}
        </span>
    );
}
