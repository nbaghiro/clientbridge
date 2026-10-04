import { ICONS, type IconShape } from "./iconData";

export type IconName = keyof typeof ICONS;

function shape(s: IconShape, i: number) {
    if (s.kind === "rect")
        return <rect key={i} x={s.x} y={s.y} width={s.width} height={s.height} rx={s.rx} />;
    if (s.kind === "circle") return <circle key={i} cx={s.cx} cy={s.cy} r={s.r} />;
    return <path key={i} d={s.d} />;
}

export function Icon({ name, className = "icon" }: { name: IconName; className?: string }) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
        >
            {(ICONS[name] as readonly IconShape[]).map(shape)}
        </svg>
    );
}
