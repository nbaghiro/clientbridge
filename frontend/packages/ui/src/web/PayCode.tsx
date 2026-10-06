import { type PayCodeProps, payCodeMatrix } from "@clientbridge/app-core/public";

import { type WebProps, cx } from "./props";

export function PayCode({ value, size = 96, label, className }: WebProps<PayCodeProps>) {
    const m = payCodeMatrix(value);
    const n = m.length;
    const d = m
        .flatMap((row, r) => row.map((on, c) => (on ? `M${String(c)} ${String(r)}h1v1h-1z` : "")))
        .join("");
    return (
        <svg
            width={size}
            height={size}
            viewBox={`-2 -2 ${String(n + 4)} ${String(n + 4)}`}
            role="img"
            aria-label={label}
            shapeRendering="crispEdges"
            className={cx("shrink-0 rounded-sm bg-surface text-ink", className)}
        >
            <path d={d} fill="currentColor" />
        </svg>
    );
}
