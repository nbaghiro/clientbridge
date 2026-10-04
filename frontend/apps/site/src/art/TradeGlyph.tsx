import { GLYPHS, type GlyphShape } from "./glyphData";

export type GlyphName = keyof typeof GLYPHS;

function shape(s: GlyphShape, i: number) {
    switch (s.kind) {
        case "rect":
            return <rect key={i} x={s.x} y={s.y} width={s.width} height={s.height} rx={s.rx} />;
        case "circle":
            return <circle key={i} cx={s.cx} cy={s.cy} r={s.r} />;
        case "ellipse":
            return (
                <ellipse key={i} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} transform={s.transform} />
            );
        default:
            return <path key={i} d={s.d} />;
    }
}

export function TradeGlyph({ name, className = "trade" }: { name: GlyphName; className?: string }) {
    return (
        <svg
            className={className}
            viewBox="0 0 48 48"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.3}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
        >
            {(GLYPHS[name] as readonly GlyphShape[]).map(shape)}
        </svg>
    );
}
