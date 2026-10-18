import { type BackdropProps, CONTOURS } from "@clientbridge/app-core/public";

import { type WebProps, cx } from "./props";

/** The marketing site's contour lines, faint in a page's corner and fading out. */
export function Backdrop({ corner = "topRight", className }: WebProps<BackdropProps>) {
    return (
        <svg
            aria-hidden
            focusable="false"
            viewBox={CONTOURS.viewBox}
            fill="none"
            strokeWidth={1}
            className={cx(
                "pointer-events-none absolute right-0 -z-10 h-[300px] w-[540px] max-w-full select-none text-accent-line [mask-image:radial-gradient(ellipse_at_top_right,#000_25%,transparent_72%)]",
                corner === "topRight" ? "top-0" : "bottom-0 -scale-y-100",
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
