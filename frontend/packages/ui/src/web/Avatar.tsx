import { type AvatarProps, initials } from "@clientbridge/app-core/public";
import { useState } from "react";
import { shade, tint } from "@clientbridge/tokens";

import { type WebProps, cx } from "./props";

const SIZE = {
    sm: "h-7 w-7 text-[11px]",
    md: "h-9 w-9 text-xs",
    lg: "h-11 w-11 text-sm",
    xl: "h-16 w-16 text-lg",
} as const;

export function Avatar({ name, src, size = "md", color, className }: WebProps<AvatarProps>) {
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    const tinted = color
        ? { backgroundColor: tint(color, 12), color: shade(color, 25) }
        : undefined;
    return (
        <span
            aria-hidden
            style={tinted}
            className={cx(
                `flex overflow-hidden shrink-0 select-none items-center justify-center rounded-avatar font-bold ${
                    tinted ? "" : "bg-accent-weak text-accent"
                } ${SIZE[size]}`,
                className,
            )}
        >
            {src && src !== failedSrc ? (
                <img
                    src={src}
                    alt=""
                    className="h-full w-full object-contain"
                    onError={() => {
                        setFailedSrc(src);
                    }}
                />
            ) : /^\p{L}/u.test(name) ? (
                initials(name)
            ) : (
                "#"
            )}
        </span>
    );
}
