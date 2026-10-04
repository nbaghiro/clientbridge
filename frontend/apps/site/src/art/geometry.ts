// Deterministic generators for the line art, so every build renders the same drawing.

type Point = readonly [number, number];

const rng = (seed: number) => {
    let s = seed;
    return (): number => {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
    };
};

const f = (n: number): number => Math.round(n * 10) / 10;
const at = (pts: readonly Point[], i: number): Point => pts[i] ?? [0, 0];

function closedCurve(pts: readonly Point[]): string {
    const n = pts.length;
    let d = `M${String(f(at(pts, 0)[0]))} ${String(f(at(pts, 0)[1]))}`;
    for (let i = 0; i < n; i++) {
        const p0 = at(pts, (i - 1 + n) % n);
        const p1 = at(pts, i);
        const p2 = at(pts, (i + 1) % n);
        const p3 = at(pts, (i + 2) % n);
        const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
        const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
        d += `C${[c1[0], c1[1], c2[0], c2[1], p2[0], p2[1]].map((v) => String(f(v ?? 0))).join(" ")}`;
    }
    return `${d}Z`;
}

function openCurve(pts: readonly Point[]): string {
    let d = `M${String(f(at(pts, 0)[0]))} ${String(f(at(pts, 0)[1]))}`;
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = at(pts, Math.max(i - 1, 0));
        const p1 = at(pts, i);
        const p2 = at(pts, i + 1);
        const p3 = at(pts, Math.min(i + 2, pts.length - 1));
        const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
        const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
        d += `C${[c1[0], c1[1], c2[0], c2[1], p2[0], p2[1]].map((v) => String(f(v ?? 0))).join(" ")}`;
    }
    return d;
}

/** One peak: centre, ring count, ring step, base radius, x and y stretch. */
export type Peak = readonly [number, number, number, number, number, number?, number?];

export interface Contour {
    d: string;
    index: boolean;
}

/** Contour rings around a few peaks, like a topographic map. Every fifth ring is an index line. */
export function contours(peaks: readonly Peak[], seed: number): Contour[] {
    const r = rng(seed);
    const out: Contour[] = [];
    for (const [cx, cy, rings, step, base, sx = 1, sy = 0.72] of peaks) {
        const ph = [r() * 6.28, r() * 6.28, r() * 6.28] as const;
        const amp = [0.08 + r() * 0.06, 0.05 + r() * 0.04, 0.025 + r() * 0.02] as const;
        for (let i = 0; i < rings; i++) {
            const pts: Point[] = [];
            const radius = base + i * step;
            for (let k = 0; k < 64; k++) {
                const t = (k / 64) * Math.PI * 2;
                const drift = i * 0.06;
                const rr =
                    radius *
                    (1 +
                        amp[0] * Math.sin(2 * t + ph[0] + drift) +
                        amp[1] * Math.sin(3 * t + ph[1] - drift) +
                        amp[2] * Math.sin(5 * t + ph[2]));
                pts.push([cx + Math.cos(t) * rr * sx, cy + Math.sin(t) * rr * sy]);
            }
            out.push({ d: closedCurve(pts), index: i % 5 === 4 });
        }
    }
    return out;
}

/** The logo's two concentric arcs with a slight hand wobble, plus a faint second stroke. */
export function sketchArcs(seed: number): { inner: string; outer: string; ghost: string } {
    const r = rng(seed);
    const cx = 34;
    const cy = 32;
    const open = (48 / 180) * Math.PI;
    const arc = (radius: number): string => {
        const pts: Point[] = [];
        for (let k = 0; k <= 24; k++) {
            const t = open + (k / 24) * (2 * Math.PI - 2 * open);
            const rr = radius * (1 + (r() - 0.5) * 0.035);
            pts.push([cx + Math.cos(t) * rr, cy + Math.sin(t) * rr]);
        }
        return openCurve(pts);
    };
    return { inner: arc(12.4), outer: arc(28), ghost: arc(28.8) };
}

/** One long hand-drawn arc used as a section divider (1200x80 box). */
export function sketchRule(seed: number): string {
    const r = rng(seed);
    const pts: Point[] = [];
    for (let k = 0; k <= 24; k++) {
        const x = 20 + (k / 24) * 1160;
        const y = 70 - Math.sin((k / 24) * Math.PI) * 52 + (r() - 0.5) * 1.6;
        pts.push([x, y]);
    }
    return openCurve(pts);
}

// The fields the home page uses, as tuned in the concept.
export const FIELDS = {
    hero: {
        width: 1440,
        height: 760,
        seed: 5,
        peaks: [
            [170, 210, 16, 17, 14, 1.15, 0.75],
            [1290, 150, 14, 18, 18, 1.1, 0.7],
            [1180, 690, 10, 20, 24, 1.3, 0.6],
            [330, 720, 8, 22, 30, 1.2, 0.55],
        ],
    },
    band: {
        width: 1440,
        height: 520,
        seed: 19,
        peaks: [
            [1260, 120, 13, 18, 16, 1.2, 0.7],
            [120, 470, 11, 18, 22, 1.2, 0.65],
        ],
    },
    small: { width: 640, height: 640, seed: 23, peaks: [[320, 320, 15, 20, 10, 1, 0.85]] },
} as const satisfies Record<
    string,
    { width: number; height: number; seed: number; peaks: readonly Peak[] }
>;

export type FieldName = keyof typeof FIELDS;

/** A field as a standalone SVG, stroked in the Pewter accent-line colour (index rings a step darker). */
export function fieldSvg(name: FieldName): string {
    const f = FIELDS[name];
    const paths = contours(f.peaks, f.seed)
        .map((c) => `<path d="${c.d}"${c.index ? ' stroke="#b9c7d6"' : ""}/>`)
        .join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(f.width)} ${String(f.height)}" preserveAspectRatio="xMidYMid slice" fill="none" stroke="#ccd7e3" stroke-width="1">${paths}</svg>`;
}
