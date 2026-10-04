// Draws one 1200x630 share image per page (og/<page>.png) from its title, in the site's font with the
// C monogram and a contour field. Called by prerender.ts after the pages are written.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

export interface OgPage {
    title: string;
    ogImage: string;
}

export interface LogoGeometry {
    viewBox: string;
    strokeWidth: number;
    paths: readonly string[];
}

interface Node {
    type: string;
    props: Record<string, unknown>;
}

const COLORS = { bg: "#f3f4f6", ink: "#191d22", muted: "#6e757e", accent: "#3f5e80" };

const require = createRequire(import.meta.url);
const font = (weight: number): Buffer =>
    readFileSync(
        require.resolve(
            `@fontsource/schibsted-grotesk/files/schibsted-grotesk-latin-${String(weight)}-normal.woff`,
        ),
    );

const dataUri = (svg: string): string =>
    `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

const el = (
    type: string,
    style: Record<string, unknown>,
    children?: unknown,
    extra = {},
): Node => ({
    type,
    props: { style, children, ...extra },
});

/** "Grooming and daycare | Clientbridge" → "Grooming and daycare". */
const headline = (title: string): string => {
    const text = title.replace(/\s*\|\s*Clientbridge$/, "").replace(/^Clientbridge:\s*/, "");
    return text.charAt(0).toUpperCase() + text.slice(1);
};

export async function writeOgImages(
    pages: readonly OgPage[],
    dist: string,
    art: string,
    logo: LogoGeometry,
): Promise<void> {
    const fonts = [
        {
            name: "Schibsted Grotesk",
            data: font(500),
            weight: 500 as const,
            style: "normal" as const,
        },
        {
            name: "Schibsted Grotesk",
            data: font(700),
            weight: 700 as const,
            style: "normal" as const,
        },
    ];
    const mark = dataUri(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${logo.viewBox}" fill="none" stroke="${COLORS.accent}" stroke-width="${String(logo.strokeWidth)}" stroke-linecap="round">${logo.paths.map((d) => `<path d="${d}"/>`).join("")}</svg>`,
    );
    const contours = dataUri(readFileSync(art, "utf8"));
    const done = new Set<string>();
    for (const page of pages) {
        if (done.has(page.ogImage)) continue;
        done.add(page.ogImage);
        const tree = el(
            "div",
            {
                width: 1200,
                height: 630,
                display: "flex",
                position: "relative",
                background: COLORS.bg,
                fontFamily: "Schibsted Grotesk",
            },
            [
                el(
                    "img",
                    {
                        position: "absolute",
                        right: -120,
                        top: -60,
                        width: 760,
                        height: 760,
                        opacity: 0.9,
                    },
                    undefined,
                    {
                        src: contours,
                    },
                ),
                el(
                    "div",
                    {
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        padding: "72px 80px",
                        width: 900,
                    },
                    [
                        el("div", { display: "flex", alignItems: "center", gap: 16 }, [
                            el("img", { width: 48, height: 56 }, undefined, { src: mark }),
                            el(
                                "div",
                                {
                                    fontSize: 44,
                                    fontWeight: 700,
                                    color: COLORS.ink,
                                    letterSpacing: -1,
                                },
                                "Clientbridge",
                            ),
                        ]),
                        el(
                            "div",
                            {
                                fontSize: 64,
                                fontWeight: 700,
                                color: COLORS.ink,
                                lineHeight: 1.08,
                                letterSpacing: -2,
                            },
                            headline(page.title),
                        ),
                        el(
                            "div",
                            { fontSize: 26, fontWeight: 500, color: COLORS.muted },
                            "clientbridge.ca",
                        ),
                    ],
                ),
            ],
        );
        const svg = await satori(tree as unknown as Parameters<typeof satori>[0], {
            width: 1200,
            height: 630,
            fonts,
        });
        const png = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
        const out = join(dist, page.ogImage);
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, png);
    }
}
