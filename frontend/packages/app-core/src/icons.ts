// Mono-stroke icon geometry (24x24 viewBox), shared so web (<svg>) and mobile (react-native-svg)
// draw identical icons from one source. Each platform maps these primitives to its own SVG
// components; colour/size/stroke stay in the per-platform wrapper. Multi-colour marks (the Logo,
// the Google mark) live per-app since they carry brand fills.

export type IconPrimitive =
    | { kind: "rect"; x: number; y: number; width: number; height: number; rx?: number }
    | { kind: "circle"; cx: number; cy: number; r: number }
    | { kind: "path"; d: string };

export type IconName =
    | "today"
    | "calendar"
    | "clients"
    | "invoices"
    | "inbox"
    | "catalog"
    | "plus"
    | "search"
    | "pos"
    | "reports"
    | "payouts"
    | "reviews"
    | "gift"
    | "logout"
    | "settings"
    | "chevron";

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
    catalog: [
        { kind: "path", d: "M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10z" },
        { kind: "circle", cx: 7, cy: 7, r: 1.4 },
    ],
    plus: [{ kind: "path", d: "M12 5v14M5 12h14" }],
    search: [
        { kind: "circle", cx: 11, cy: 11, r: 8 },
        { kind: "path", d: "m21 21-4.3-4.3" },
    ],
    pos: [
        { kind: "rect", x: 2, y: 5, width: 20, height: 14, rx: 2 },
        { kind: "path", d: "M2 10h20M6 15h4" },
    ],
    reports: [
        { kind: "path", d: "M3 3v18h18" },
        { kind: "path", d: "M7 14v3M12 9v8M17 5v12" },
    ],
    payouts: [
        { kind: "rect", x: 2, y: 6, width: 20, height: 12, rx: 2 },
        { kind: "circle", cx: 12, cy: 12, r: 2.5 },
        { kind: "path", d: "M6 12h.01M18 12h.01" },
    ],
    reviews: [
        {
            kind: "path",
            d: "M12 17.3 6.16 20.5l1.12-6.53L2.5 9.34l6.56-.95L12 2.5l2.94 5.89 6.56.95-4.78 4.63 1.12 6.53z",
        },
    ],
    gift: [
        { kind: "rect", x: 3, y: 8, width: 18, height: 4, rx: 1 },
        { kind: "path", d: "M12 8v13M5 12v9h14v-9" },
        { kind: "path", d: "M12 8C12 8 11 3 8 3a2 2 0 0 0 0 5zM12 8c0 0 1-5 4-5a2 2 0 0 1 0 5z" },
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
};
