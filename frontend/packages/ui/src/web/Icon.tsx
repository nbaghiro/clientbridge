import { ICON_SPECS, type IconPrimitive, type IconProps } from "@clientbridge/app-core/public";

import { type WebProps, cx } from "./props";

export function Icon({ name, size = 18, color, label, className }: WebProps<IconProps>) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color ?? "currentColor"}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cx("shrink-0", className)}
            role={label === undefined ? undefined : "img"}
            aria-label={label}
            aria-hidden={label === undefined ? true : undefined}
        >
            {ICON_SPECS[name].map((p: IconPrimitive, i) =>
                p.kind === "rect" ? (
                    <rect key={i} x={p.x} y={p.y} width={p.width} height={p.height} rx={p.rx} />
                ) : p.kind === "circle" ? (
                    <circle key={i} cx={p.cx} cy={p.cy} r={p.r} />
                ) : (
                    <path key={i} d={p.d} />
                ),
            )}
        </svg>
    );
}

// Google's own four-colour mark, drawn as the brand requires on a sign-in button.
export function GoogleIcon({ size = 18, className }: WebProps<{ size?: number | undefined }>) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            className={cx("shrink-0", className)}
            aria-hidden="true"
        >
            <path
                fill="#4285F4"
                d="M23.06 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h6.2a5.3 5.3 0 0 1-2.3 3.48v2.9h3.72c2.18-2.01 3.44-4.97 3.44-8.39z"
            />
            <path
                fill="#34A853"
                d="M12 24c3.11 0 5.72-1.03 7.62-2.79l-3.72-2.89c-1.03.69-2.35 1.1-3.9 1.1-3 0-5.54-2.02-6.45-4.75H1.71v2.98A12 12 0 0 0 12 24z"
            />
            <path
                fill="#FBBC05"
                d="M5.55 14.67a7.2 7.2 0 0 1 0-4.6V7.09H1.71a12 12 0 0 0 0 10.56l3.84-2.98z"
            />
            <path
                fill="#EA4335"
                d="M12 4.77c1.69 0 3.21.58 4.4 1.72l3.3-3.3C17.72 1.2 15.11 0 12 0A12 12 0 0 0 1.71 7.09l3.84 2.98C6.46 7.35 9 4.77 12 4.77z"
            />
        </svg>
    );
}
