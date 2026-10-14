// Draws the email header and contour strip from the same contour art and logo as the site.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

import type { LogoGeometry } from "./og.ts";

const WIDTH = 1120;
const HEIGHT = 200;
const STRIP_HEIGHT = 180;
const COLORS = { surface: "#ffffff", ink: "#191d22", accent: "#3f5e80" };

const require = createRequire(import.meta.url);
const font = readFileSync(
    require.resolve("@fontsource/schibsted-grotesk/files/schibsted-grotesk-latin-700-normal.woff"),
);
const dataUri = (svg: string): string =>
    `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

export async function writeEmailImages(
    dist: string,
    art: string,
    logo: LogoGeometry,
): Promise<void> {
    const mark = dataUri(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${logo.viewBox}" fill="none" stroke="${COLORS.accent}" stroke-width="${String(logo.strokeWidth)}" stroke-linecap="round">${logo.paths.map((d) => `<path d="${d}"/>`).join("")}</svg>`,
    );
    const contours = dataUri(readFileSync(art, "utf8"));
    const tree = {
        type: "div",
        props: {
            style: {
                width: WIDTH,
                height: HEIGHT,
                display: "flex",
                position: "relative",
                alignItems: "center",
                background: COLORS.surface,
                fontFamily: "Schibsted Grotesk",
                overflow: "hidden",
            },
            children: [
                {
                    type: "img",
                    props: {
                        src: contours,
                        style: {
                            position: "absolute",
                            left: -110,
                            top: -10,
                            width: 1200,
                            height: 433,
                        },
                    },
                },
                {
                    type: "div",
                    props: {
                        style: { display: "flex", alignItems: "center", gap: 14, paddingLeft: 80 },
                        children: [
                            { type: "img", props: { src: mark, style: { width: 40, height: 46 } } },
                            {
                                type: "div",
                                props: {
                                    style: {
                                        fontSize: 42,
                                        fontWeight: 700,
                                        color: COLORS.ink,
                                        letterSpacing: -1,
                                    },
                                    children: "Clientbridge",
                                },
                            },
                        ],
                    },
                },
            ],
        },
    };
    const svg = await satori(tree as unknown as Parameters<typeof satori>[0], {
        width: WIDTH,
        height: HEIGHT,
        fonts: [{ name: "Schibsted Grotesk", data: font, weight: 700, style: "normal" }],
    });
    mkdirSync(join(dist, "email"), { recursive: true });
    writeFileSync(join(dist, "email", "header.png"), new Resvg(svg).render().asPng());
    // the lower-left contour field of the art, cropped to the strip's proportions
    const stripWidth = 1500;
    const strip = readFileSync(art, "utf8")
        .replace(
            /viewBox="[^"]*"/,
            `viewBox="-40 330 ${String(stripWidth)} ${String((stripWidth * STRIP_HEIGHT) / WIDTH)}"`,
        )
        .replace(/preserveAspectRatio="[^"]*"/, 'preserveAspectRatio="xMinYMin slice"');
    writeFileSync(
        join(dist, "email", "contours.png"),
        new Resvg(strip, { background: COLORS.surface, fitTo: { mode: "width", value: WIDTH } })
            .render()
            .asPng(),
    );
}
