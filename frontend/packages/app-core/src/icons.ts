// Icon geometry shared by web and mobile; each platform draws it with its own SVG components.

export type IconPrimitive =
    | { kind: "rect"; x: number; y: number; width: number; height: number; rx?: number }
    | { kind: "circle"; cx: number; cy: number; r: number }
    | { kind: "path"; d: string };

const p = (d: string): IconPrimitive => ({ kind: "path", d });
const o = (cx: number, cy: number, r: number): IconPrimitive => ({ kind: "circle", cx, cy, r });
const r = (x: number, y: number, width: number, height: number, rx = 2): IconPrimitive => ({
    kind: "rect",
    x,
    y,
    width,
    height,
    rx,
});

export type IconName =
    | "today"
    | "calendar"
    | "clients"
    | "invoices"
    | "inbox"
    | "plus"
    | "search"
    | "pos"
    | "logout"
    | "settings"
    | "chevron"
    | "bell"
    | "check"
    | "checkCircle"
    | "x"
    | "chevronDown"
    | "chevronLeft"
    | "lock"
    | "mail"
    | "percent"
    | "bank"
    | "user"
    | "arrowRight"
    | "clock"
    | "alert"
    | "eye"
    | "copy"
    | "upload"
    | "image"
    | "more"
    | "receipt"
    | "link"
    | "paw"
    | "box"
    | "star"
    | "refresh"
    | "cloudOff"
    | "shield"
    | "phone"
    | "external"
    | "trash"
    | "edit"
    | "send"
    | "tag"
    | "building"
    | "dollar"
    | "phoneDevice"
    | "history"
    | "globe"
    | "repeat"
    | "bag"
    | "note"
    | "users"
    | "grip"
    | "moon"
    | "pin"
    | "message"
    | "card"
    | "chevronRight"
    | "chevronUp"
    | "move"
    | "contactless"
    | "printer"
    | "pushpin";

export const ICON_SPECS: Record<IconName, IconPrimitive[]> = {
    today: [
        { kind: "rect", x: 3, y: 3, width: 7, height: 7, rx: 1.5 },
        { kind: "rect", x: 14, y: 3, width: 7, height: 7, rx: 1.5 },
        { kind: "rect", x: 14, y: 14, width: 7, height: 7, rx: 1.5 },
        { kind: "rect", x: 3, y: 14, width: 7, height: 7, rx: 1.5 },
    ],
    calendar: [
        { kind: "rect", x: 3, y: 4, width: 18, height: 18, rx: 2 },
        { kind: "path", d: "M16 2v4M8 2v4M3 10h18" },
    ],
    clients: [
        { kind: "path", d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" },
        { kind: "circle", cx: 9, cy: 7, r: 4 },
        { kind: "path", d: "M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" },
    ],
    invoices: [
        { kind: "path", d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" },
        { kind: "path", d: "M14 2v6h6M16 13H8M16 17H8M10 9H8" },
    ],
    inbox: [{ kind: "path", d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" }],
    plus: [{ kind: "path", d: "M12 5v14M5 12h14" }],
    search: [
        { kind: "circle", cx: 11, cy: 11, r: 8 },
        { kind: "path", d: "m21 21-4.3-4.3" },
    ],
    pos: [
        { kind: "rect", x: 2, y: 5, width: 20, height: 14, rx: 2 },
        { kind: "path", d: "M2 10h20M6 15h4" },
    ],
    logout: [{ kind: "path", d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" }],
    settings: [
        { kind: "circle", cx: 12, cy: 12, r: 3 },
        {
            kind: "path",
            d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
        },
    ],
    chevron: [{ kind: "path", d: "m9 18 6-6-6-6" }],
    bell: [p("M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"), p("M10.3 21a1.94 1.94 0 0 0 3.4 0")],
    check: [p("M20 6 9 17l-5-5")],
    checkCircle: [o(12, 12, 10), p("m9 12 2 2 4-4")],
    x: [p("M18 6 6 18M6 6l12 12")],
    chevronDown: [p("m6 9 6 6 6-6")],
    chevronLeft: [p("m15 18-6-6 6-6")],
    lock: [r(3, 11, 18, 11), p("M7 11V7a5 5 0 0 1 10 0v4")],
    mail: [r(2, 4, 20, 16), p("m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7")],
    percent: [p("M19 5 5 19"), o(6.5, 6.5, 2.5), o(17.5, 17.5, 2.5)],
    bank: [p("M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7"), p("M12 2l8 5H4z")],
    user: [o(12, 8, 4), p("M20 21a8 8 0 0 0-16 0")],
    arrowRight: [p("M5 12h14M12 5l7 7-7 7")],
    clock: [o(12, 12, 10), p("M12 6v6l4 2")],
    alert: [
        p("m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"),
        p("M12 9v4M12 17h.01"),
    ],
    eye: [p("M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"), o(12, 12, 3)],
    copy: [r(8, 8, 14, 14), p("M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2")],
    upload: [p("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12")],
    image: [r(3, 3, 18, 18), o(9, 9, 2), p("m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21")],
    more: [o(5, 12, 1), o(12, 12, 1), o(19, 12, 1)],
    receipt: [
        p("M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"),
        p("M16 8h-6M16 12H8M13 16H8"),
    ],
    link: [
        p("M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"),
        p("M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"),
    ],
    paw: [
        o(11, 4, 2),
        o(18, 8, 2),
        o(20, 16, 2),
        p(
            "M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z",
        ),
    ],
    box: [
        p(
            "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z",
        ),
        p("M3.3 7 12 12l8.7-5M12 22V12"),
    ],
    star: [
        p(
            "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
        ),
    ],
    refresh: [p("M21 12a9 9 0 1 1-3-6.7L21 8"), p("M21 3v5h-5")],
    cloudOff: [
        p("m2 2 20 20"),
        p("M5.78 5.78A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.31-.2"),
        p("M21.53 16.8A4.5 4.5 0 0 0 17.5 10h-1.79A7 7 0 0 0 10.2 5.2"),
    ],
    shield: [
        p(
            "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
        ),
    ],
    phone: [
        p(
            "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",
        ),
    ],
    external: [p("M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6")],
    trash: [
        p("M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"),
    ],
    edit: [p("M12 20h9"), p("M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z")],
    send: [p("m22 2-7 20-4-9-9-4Z"), p("M22 2 11 13")],
    tag: [p("M12 2H2v10l9.29 9.29a1 1 0 0 0 1.41 0l8.59-8.59a1 1 0 0 0 0-1.41z"), o(7, 7, 1.5)],
    building: [
        r(4, 2, 16, 20),
        p(
            "M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01",
        ),
    ],
    dollar: [p("M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6")],
    phoneDevice: [r(5, 2, 14, 20), p("M12 18h.01")],
    history: [p("M3 12a9 9 0 1 0 3-6.7L3 8"), p("M3 3v5h5"), p("M12 7v5l4 2")],
    globe: [
        o(12, 12, 9),
        p("M3 12h18"),
        p("M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"),
    ],
    repeat: [
        p("m17 2 4 4-4 4"),
        p("M3 11V9a3 3 0 0 1 3-3h15"),
        p("m7 22-4-4 4-4"),
        p("M21 13v2a3 3 0 0 1-3 3H3"),
    ],
    bag: [
        p("M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"),
        p("M3 6h18"),
        p("M16 10a4 4 0 0 1-8 0"),
    ],
    note: [p("M5 4h10l4 4v12H5z"), p("M9 12h6M9 16h4")],
    users: [
        o(9, 8, 3.5),
        p("M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"),
        p("M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.6.8 2.7 2.6 3 5.2"),
    ],
    grip: [o(9, 6, 1), o(15, 6, 1), o(9, 12, 1), o(15, 12, 1), o(9, 18, 1), o(15, 18, 1)],
    moon: [p("M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5z")],
    pin: [p("M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"), o(12, 10, 2.5)],
    message: [p("M4 5h16v11H8l-4 4z")],
    card: [r(3, 5, 18, 14), p("M3 10h18M7 15h3")],
    chevronRight: [p("m9 18 6-6-6-6")],
    chevronUp: [p("m6 15 6-6 6 6")],
    move: [p("M12 3v18M3 12h18"), p("m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3")],
    contactless: [
        p("M8.5 8.5a5 5 0 0 1 0 7"),
        p("M12 6a8.5 8.5 0 0 1 0 12"),
        p("M15.5 3.5a12 12 0 0 1 0 17"),
        p("M5 11a1.5 1.5 0 0 1 0 2"),
    ],
    printer: [p("M6 9V2h12v7"), r(2, 9, 20, 9), p("M6 14h12v8H6z")],
    pushpin: [
        p("M12 17v5"),
        p(
            "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",
        ),
    ],
};

// The C monogram, sized to sit 6px from the wordmark at about 1.45x its cap height.
export const LOGO = {
    viewBox: "0 0 24.763 28.8",
    aspect: 24.763 / 28.8,
    strokeWidth: 4.4,
    paths: [
        "M22.563 23.466A12.2 12.2 0 1 1 22.563 5.334",
        "M18.013 18.413A5.4 5.4 0 1 1 18.013 10.387",
    ],
    heightPerFontSize: 1.02,
    gap: 6,
} as const;
