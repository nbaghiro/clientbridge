import { useMemo } from "react";
import {
    PAY_CODE_QUIET_ZONE,
    type PayCodeProps,
    payCodeMatrix,
} from "@clientbridge/app-core/public";

import { type WebProps, cx } from "./props";

export function PayCode({ value, size = 96, label, className }: WebProps<PayCodeProps>) {
    const { n, d } = useMemo(() => {
        const m = payCodeMatrix(value);
        return {
            n: m.length,
            d: m
                .flatMap((row, r) =>
                    row.map((on, c) => (on ? `M${String(c)} ${String(r)}h1v1h-1z` : "")),
                )
                .join(""),
        };
    }, [value]);
    const origin = String(-PAY_CODE_QUIET_ZONE);
    const side = String(n + PAY_CODE_QUIET_ZONE * 2);
    return (
        <svg
            width={size}
            height={size}
            viewBox={`${origin} ${origin} ${side} ${side}`}
            role="img"
            aria-label={label}
            shapeRendering="crispEdges"
            className={cx("shrink-0 rounded-sm bg-surface text-ink", className)}
        >
            <path d={d} fill="currentColor" />
        </svg>
    );
}
