import type { PageFrameProps } from "@clientbridge/app-core/public";

import { type WebProps, cx } from "./props";

// Every page sits in this centred frame, so margins match across the app.
export function PageFrame({ leading, children, className }: WebProps<PageFrameProps>) {
    return (
        <>
            {leading}
            <div className={cx("mx-auto w-full max-w-[88rem] px-8 py-8", className)}>
                {children}
            </div>
        </>
    );
}
