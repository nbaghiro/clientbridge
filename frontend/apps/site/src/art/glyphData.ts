// The nine trade line drawings (48x48, 1.3 stroke), kept as data for plain JSX rendering.

export type GlyphShape =
    | { kind: "path"; d: string }
    | { kind: "rect"; x: number; y: number; width: number; height: number; rx?: number }
    | { kind: "circle"; cx: number; cy: number; r: number }
    | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number; transform?: string };

export const GLYPHS = {
    paw: [
        {
            kind: "path",
            d: "M24 25.5c-5.2 0-9.5 5.6-9.5 9.4 0 3 2.4 4.6 5 4.1 1.7-.3 3-1.1 4.5-1.1s2.8.8 4.5 1.1c2.6.5 5-1.1 5-4.1 0-3.8-4.3-9.4-9.5-9.4z",
        },
        { kind: "ellipse", cx: 13, cy: 21, rx: 3.2, ry: 4.2, transform: "rotate(-20 13 21)" },
        {
            kind: "ellipse",
            cx: 19.5,
            cy: 12.8,
            rx: 3.2,
            ry: 4.4,
            transform: "rotate(-6 19.5 12.8)",
        },
        { kind: "ellipse", cx: 28.5, cy: 12.8, rx: 3.2, ry: 4.4, transform: "rotate(6 28.5 12.8)" },
        { kind: "ellipse", cx: 35, cy: 21, rx: 3.2, ry: 4.2, transform: "rotate(20 35 21)" },
    ],
    scissors: [
        { kind: "circle", cx: 15, cy: 36.5, r: 5.5 },
        { kind: "circle", cx: 33, cy: 36.5, r: 5.5 },
        { kind: "path", d: "M18.4 32.2L31.2 6.5c.8.9 1.1 2.4.6 3.6L22.8 31" },
        { kind: "path", d: "M29.6 32.2L16.8 6.5c-.8.9-1.1 2.4-.6 3.6L25.2 31" },
        { kind: "circle", cx: 24, cy: 20.4, r: 1 },
    ],
    comb: [
        { kind: "path", d: "M7 15.5h34a1.5 1.5 0 0 1 1.5 1.5v3H5.5v-3A1.5 1.5 0 0 1 7 15.5z" },
        {
            kind: "path",
            d: "M8.5 20v13M12 20v13M15.5 20v13M19 20v13M22.5 20v13M26 20v9M29.5 20v9M33 20v9M36.5 20v9M40 20v9",
        },
    ],
    dumbbell: [
        { kind: "path", d: "M15 24h18" },
        { kind: "rect", x: 9, y: 13.5, width: 6, height: 21, rx: 1.6 },
        { kind: "rect", x: 33, y: 13.5, width: 6, height: 21, rx: 1.6 },
        { kind: "rect", x: 4.5, y: 18, width: 4.5, height: 12, rx: 1.4 },
        { kind: "rect", x: 39, y: 18, width: 4.5, height: 12, rx: 1.4 },
    ],
    spray: [
        { kind: "path", d: "M17.5 24h12.5l2.5 5.5v11a2 2 0 0 1-2 2H17a2 2 0 0 1-2-2v-11z" },
        { kind: "path", d: "M19.5 24v-6h9v6" },
        { kind: "path", d: "M17.5 18V12.5a2 2 0 0 1 2-2H32l4 3.5h-6.5V18z" },
        { kind: "path", d: "M27 18l-3.5 5" },
        { kind: "path", d: "M40 11.5h.01M42.5 8h.01M42.5 15h.01M45 11.5h.01" },
        { kind: "path", d: "M18.5 32.5h11" },
    ],
    book: [
        {
            kind: "path",
            d: "M24 13C19.5 10 12.5 9.5 6.5 10.5v27c6-1 13-.5 17.5 2.5 4.5-3 11.5-3.5 17.5-2.5v-27C35.5 9.5 28.5 10 24 13z",
        },
        { kind: "path", d: "M24 13v27" },
        {
            kind: "path",
            d: "M10.5 16.5c3-.4 6.5-.2 9.5 1M10.5 22c3-.4 6.5-.2 9.5 1M10.5 27.5c3-.4 6.5-.2 9.5 1M28 17.5c3-1.2 6.5-1.4 9.5-1M28 23c3-1.2 6.5-1.4 9.5-1",
        },
    ],
    stones: [
        { kind: "ellipse", cx: 24, cy: 37, rx: 13, ry: 4.8 },
        { kind: "ellipse", cx: 23, cy: 27.6, rx: 9.5, ry: 4 },
        { kind: "ellipse", cx: 24.5, cy: 19.6, rx: 6.2, ry: 3.2 },
        { kind: "path", d: "M30 13.5c1.2-4.6 5.2-7.2 10-7-0.4 4.6-4.4 7.6-10 7z" },
        { kind: "path", d: "M30 13.5c2.6-2.2 5-3.6 7.5-4.6" },
    ],
    camera: [
        { kind: "rect", x: 5.5, y: 15, width: 37, height: 24, rx: 3 },
        { kind: "path", d: "M16.5 15l2.8-5h9.4l2.8 5" },
        { kind: "circle", cx: 24, cy: 27, r: 7.5 },
        { kind: "circle", cx: 24, cy: 27, r: 3.5 },
        { kind: "path", d: "M36 20h2" },
    ],
    wrench: [
        {
            kind: "path",
            d: "M30.2 6.3a9 9 0 0 0-9.4 11.9L7.6 31.4a3.6 3.6 0 0 0 5.1 5.1l13.2-13.2A9 9 0 0 0 37.8 14l-5.2 5.2-5-1.4-1.4-5z",
        },
    ],
} as const satisfies Record<string, readonly GlyphShape[]>;
