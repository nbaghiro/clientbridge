import { type LoadingProps, strings } from "@clientbridge/app-core/public";

import { type WebProps, cx } from "./props";

export function Loading({ label, inline = false, className }: WebProps<LoadingProps>) {
    return (
        <p
            role="status"
            className={cx(
                `text-sm text-muted ${inline ? "" : "px-4 py-10 text-center"}`,
                className,
            )}
        >
            {label ?? strings.common.loading}
        </p>
    );
}
