import type { ItemImageProps } from "@clientbridge/app-core/public";
import { cssVar, tint } from "@clientbridge/tokens";
import { useState } from "react";

import { type WebProps, cx } from "./props";

/** An item's picture, or its initial on a tint of its colour when there's none (or it fails). */
export function ItemImage({ src, name, color, size = 40, className }: WebProps<ItemImageProps>) {
    const [failed, setFailed] = useState(false);
    const box = { width: size, height: size };
    if (src !== null && !failed) {
        return (
            <img
                src={src}
                alt=""
                style={box}
                onError={() => {
                    setFailed(true);
                }}
                className={cx("shrink-0 rounded-md object-cover", className)}
            />
        );
    }
    const tone = color ?? cssVar("accent");
    return (
        <span
            aria-hidden
            style={{ ...box, backgroundColor: tint(tone, 12), color: tone, fontSize: size * 0.42 }}
            className={cx(
                "flex shrink-0 items-center justify-center rounded-md font-semibold",
                className,
            )}
        >
            {name.trim().charAt(0).toUpperCase()}
        </span>
    );
}
