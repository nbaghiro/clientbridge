// Marketing icon geometry (24x24, stroke). Kept as data so the component renders plain JSX.

export type IconShape =
    | { kind: "path"; d: string }
    | { kind: "rect"; x: number; y: number; width: number; height: number; rx?: number }
    | { kind: "circle"; cx: number; cy: number; r: number };

export const ICONS = {
    today: [
        {
            kind: "rect",
            x: 3,
            y: 3,
            width: 7,
            height: 7,
            rx: 1.5,
        },
        {
            kind: "rect",
            x: 14,
            y: 3,
            width: 7,
            height: 7,
            rx: 1.5,
        },
        {
            kind: "rect",
            x: 3,
            y: 14,
            width: 7,
            height: 7,
            rx: 1.5,
        },
        {
            kind: "rect",
            x: 14,
            y: 14,
            width: 7,
            height: 7,
            rx: 1.5,
        },
    ],
    calendar: [
        {
            kind: "rect",
            x: 3,
            y: 4.5,
            width: 18,
            height: 16.5,
            rx: 2,
        },
        {
            kind: "path",
            d: "M3 9.5h18M8 2.5v4M16 2.5v4",
        },
    ],
    clients: [
        {
            kind: "circle",
            cx: 9,
            cy: 8,
            r: 3.5,
        },
        {
            kind: "path",
            d: "M2.5 20a6.5 6.5 0 0 1 13 0",
        },
        {
            kind: "path",
            d: "M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8",
        },
    ],
    invoice: [
        {
            kind: "path",
            d: "M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z",
        },
        {
            kind: "path",
            d: "M14 2.5V8h5.5M8.5 13h7M8.5 17h7",
        },
    ],
    inbox: [
        {
            kind: "path",
            d: "M20.5 15a2 2 0 0 1-2 2h-11l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z",
        },
    ],
    settings: [
        {
            kind: "circle",
            cx: 12,
            cy: 12,
            r: 3,
        },
        {
            kind: "path",
            d: "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
        },
    ],
    check: [
        {
            kind: "path",
            d: "M4.5 12.5l5 5 10-11",
        },
    ],
    card: [
        {
            kind: "rect",
            x: 2.5,
            y: 5,
            width: 19,
            height: 14,
            rx: 2,
        },
        {
            kind: "path",
            d: "M2.5 10h19M6.5 15h3",
        },
    ],
    tap: [
        {
            kind: "path",
            d: "M8.5 7.5a5 5 0 0 1 7 0M6 5a8.5 8.5 0 0 1 12 0",
        },
        {
            kind: "rect",
            x: 8,
            y: 11,
            width: 8,
            height: 10.5,
            rx: 1.8,
        },
    ],
    bank: [
        {
            kind: "path",
            d: "M3 9.5L12 4l9 5.5M4.5 10v8M9.5 10v8M14.5 10v8M19.5 10v8M3 20.5h18",
        },
    ],
    gift: [
        {
            kind: "rect",
            x: 3,
            y: 8,
            width: 18,
            height: 4.5,
            rx: 1,
        },
        {
            kind: "path",
            d: "M4.5 12.5V21h15v-8.5M12 8v13M12 8S10.5 3.5 8 3.5a2.2 2.2 0 0 0 0 4.5zM12 8s1.5-4.5 4-4.5a2.2 2.2 0 0 1 0 4.5z",
        },
    ],
    repeat: [
        {
            kind: "path",
            d: "M17 2.5l3 3-3 3",
        },
        {
            kind: "path",
            d: "M4 11.5v-1a5 5 0 0 1 5-5h11M7 21.5l-3-3 3-3",
        },
        {
            kind: "path",
            d: "M20 12.5v1a5 5 0 0 1-5 5H4",
        },
    ],
    star: [
        {
            kind: "path",
            d: "M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z",
        },
    ],
    globe: [
        {
            kind: "circle",
            cx: 12,
            cy: 12,
            r: 9,
        },
        {
            kind: "path",
            d: "M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
        },
    ],
    offline: [
        {
            kind: "path",
            d: "M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0",
        },
        {
            kind: "circle",
            cx: 12,
            cy: 19.5,
            r: 1,
        },
    ],
    percent: [
        {
            kind: "path",
            d: "M19 5L5 19",
        },
        {
            kind: "circle",
            cx: 6.5,
            cy: 6.5,
            r: 2.5,
        },
        {
            kind: "circle",
            cx: 17.5,
            cy: 17.5,
            r: 2.5,
        },
    ],
    team: [
        {
            kind: "circle",
            cx: 12,
            cy: 7.5,
            r: 3.5,
        },
        {
            kind: "path",
            d: "M5 20.5a7 7 0 0 1 14 0",
        },
    ],
    arrow: [
        {
            kind: "path",
            d: "M5 12h14M13 6l6 6-6 6",
        },
    ],
    pkg: [
        {
            kind: "path",
            d: "M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z",
        },
        {
            kind: "path",
            d: "M3.5 7.5L12 12l8.5-4.5M12 12v9",
        },
    ],
    msg: [
        {
            kind: "path",
            d: "M4 5h16v11H8l-4 4z",
        },
        {
            kind: "path",
            d: "M8 9.5h8M8 12.5h5",
        },
    ],
    receipt: [
        {
            kind: "path",
            d: "M5 2.5h14v19l-3-2-2 2-2-2-2 2-2-2-3 2z",
        },
        {
            kind: "path",
            d: "M8.5 8h7M8.5 12h7",
        },
    ],
    search: [
        {
            kind: "circle",
            cx: 11,
            cy: 11,
            r: 6.5,
        },
        {
            kind: "path",
            d: "M16 16l4 4",
        },
    ],
    plus: [
        {
            kind: "path",
            d: "M12 5v14M5 12h14",
        },
    ],
} as const satisfies Record<string, readonly IconShape[]>;
