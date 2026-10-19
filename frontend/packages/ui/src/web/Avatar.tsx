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

export function Avatar({
    name,
    src,
    variant = "photo",
    size = "md",
    color,
    className,
}: WebProps<AvatarProps>) {
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    const tinted = color
        ? { backgroundColor: tint(color, 12), color: shade(color, 25) }
        : undefined;
    const image = src && src !== failedSrc ? src : null;
    // one painted layer, so the rounded clip cannot let the backing colour show at the edge
    const painted = image
        ? {
              backgroundImage: `url(${JSON.stringify(image)})`,
              backgroundOrigin: "content-box",
              backgroundPosition: "center",
              backgroundRepeat: "no-repeat",
              backgroundSize: variant === "mark" ? "contain" : "cover",
          }
        : undefined;
    return (
        <span
            aria-hidden
            style={{ ...tinted, ...painted }}
            className={cx(
                `flex overflow-hidden shrink-0 select-none items-center justify-center rounded-avatar font-bold ${
                    tinted ? "" : "bg-accent-weak text-accent"
                } ${SIZE[size]}`,
                className,
            )}
        >
            {image ? (
                <img
                    src={image}
                    alt=""
                    className="hidden"
                    onError={() => {
                        setFailedSrc(image);
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
