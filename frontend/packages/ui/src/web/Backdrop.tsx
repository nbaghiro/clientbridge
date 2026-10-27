import { type BackdropProps, CONTOURS } from "@clientbridge/app-core/public";

import { type WebProps, cx } from "./props";

/** The marketing site's contour lines, faint in a page's corner and fading out. */
export function Backdrop({ corner = "topRight", size = "md", className }: WebProps<BackdropProps>) {
    const left = corner === "topLeft" || corner === "bottomLeft";
    const top = corner === "topRight" || corner === "topLeft";
    return (
        <svg
            aria-hidden
            focusable="false"
            viewBox={CONTOURS.viewBox}
            fill="none"
            strokeWidth={1}
            className={cx(
                "pointer-events-none absolute -z-10 max-w-full select-none text-accent-line [mask-image:radial-gradient(ellipse_at_top_right,#000_25%,transparent_72%)]",
                size === "sm"
                    ? "h-[180px] w-[320px]"
                    : size === "lg"
                      ? "h-[380px] w-[680px]"
                      : "h-[300px] w-[540px]",
                top ? "top-0" : "bottom-0 -scale-y-100",
                left ? "left-0 -scale-x-100" : "right-0",
                className,
            )}
        >
            {CONTOURS.rings.map((r) => (
                <path
                    key={r.d.slice(0, 24)}
                    d={r.d}
                    stroke={r.index ? "var(--border)" : "currentColor"}
                />
            ))}
        </svg>
    );
}
