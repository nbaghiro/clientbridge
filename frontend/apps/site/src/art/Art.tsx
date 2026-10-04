import { type FieldName, sketchArcs, sketchRule } from "./geometry";

/** A contour field drawn once to /art/<name>.svg at build time, so pages share one cached file. */
export function ContourField({
    name,
    className = "art-topo",
}: {
    name: FieldName;
    className?: string;
}) {
    return <img className={className} src={`/art/${name}.svg`} alt="" aria-hidden="true" />;
}

export function ArcMark({ seed, width = 120 }: { seed: number; width?: number }) {
    const arcs = sketchArcs(seed);
    return (
        <svg
            className="art-sketch"
            viewBox="0 0 64 64"
            width={Math.round(((width * 64) / 120) * 10) / 10}
            aria-hidden="true"
            focusable="false"
        >
            <path d={arcs.inner} />
            <path d={arcs.outer} />
            <path d={arcs.ghost} className="ghost" />
        </svg>
    );
}

export function ArcDivider({ seed }: { seed: number }) {
    return (
        <div className="wrap rule-wrap">
            <svg
                className="art-rule"
                viewBox="0 0 1200 80"
                preserveAspectRatio="none"
                aria-hidden="true"
                focusable="false"
            >
                <path d={sketchRule(seed)} vectorEffect="non-scaling-stroke" />
                <circle cx="20" cy="70" r="3" />
                <circle cx="1180" cy="70" r="3" />
            </svg>
        </div>
    );
}
