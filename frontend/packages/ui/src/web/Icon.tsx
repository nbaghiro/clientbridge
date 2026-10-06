import { ICON_SPECS, type IconProps } from "@clientbridge/app-core/public";

export function Icon({ name, size = 18, color, label }: IconProps) {
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
            className="shrink-0"
            role={label === undefined ? undefined : "img"}
            aria-label={label}
            aria-hidden={label === undefined ? true : undefined}
        >
            {ICON_SPECS[name].map((p, i) =>
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
