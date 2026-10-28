import type { PageFrameProps } from "@clientbridge/app-core/public";

import { type WebProps, cx } from "./props";

// Every page sits in this centred frame, so margins match across the app.
export function PageFrame({ leading, size = "lg", children, className }: WebProps<PageFrameProps>) {
    return (
        <>
            {leading}
            <div
                className={cx(
                    "mx-auto w-full px-8 py-8",
                    size === "md" ? "max-w-[64rem]" : "max-w-[88rem]",
                    className,
                )}
            >
                {children}
            </div>
        </>
    );
}
