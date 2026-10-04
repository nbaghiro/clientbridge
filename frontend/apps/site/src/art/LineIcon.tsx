import type { ReactNode } from "react";

// Feature drawings in the same family as the trade glyphs: 48x48, 1.3 stroke, round caps, no tile.
const DRAWINGS = {
    booking: (
        <>
            <rect x="4" y="6" width="33" height="30" rx="3" />
            <path d="M4 13h33M8.5 9.5h.01M12 9.5h.01" />
            <path d="M9.5 19h17M9.5 23.5h11" />
            <rect x="9.5" y="27.5" width="13" height="5" rx="2.5" />
            <path d="M32 30l10.5 4.4-4.6 1.9-1.9 4.6z" />
        </>
    ),
    payout: (
        <>
            <rect x="3" y="29" width="18" height="12.5" rx="2" />
            <path d="M3 33.2h18M6.5 37.6h5" />
            <path d="M11 25.5c0-3 .5-5.4 1.5-7.4M18.6 12.3c2.6-1.6 5.6-2.3 8.9-2" />
            <circle cx="15.3" cy="15" r="3.8" />
            <path d="M15.3 13.2v3.6" />
            <path d="M24.8 7.4l3 2.9-3 3" />
            <path d="M27.5 22.5l8.25-5.5 8.25 5.5" />
            <path d="M28.5 24.5h15M30.5 26.5v9.5M36 26.5v9.5M41.5 26.5v9.5M28 38h16M27 41h18" />
        </>
    ),
    tax: (
        <>
            <path d="M10.5 5.5h18.5l7.5 7.5v29.5l-3-2-3 2-3-2-3 2-3-2-3 2-3-2-3 2z" />
            <path d="M29 5.5V13h7.5" />
            <path d="M15 13h9M15 18h12" />
            <circle cx="25.5" cy="30" r="6.5" />
            <path d="M22.8 32.7l5.4-5.4" />
            <circle cx="23.3" cy="27.8" r="0.9" />
            <circle cx="27.7" cy="32.2" r="0.9" />
        </>
    ),
    gift: (
        <>
            <rect x="5" y="13" width="38" height="24" rx="3" />
            <path d="M17 13v24M5 22h38" />
            <path d="M17 22c-2.2-4.3-7.4-5.3-7.4-1.6 0 2.6 4.3 2.6 7.4 1.6zM17 22c2.2-4.3 7.4-5.3 7.4-1.6 0 2.6-4.3 2.6-7.4 1.6z" />
            <path d="M17 22l-3 5.2M17 22l3 5.2" />
            <path d="M27 30h11M31 26h7" />
        </>
    ),
    package: (
        <>
            <rect x="5" y="11" width="38" height="26" rx="3" />
            <path d="M10 18h15" />
            <circle cx="12" cy="28" r="2.8" />
            <circle cx="18.5" cy="28" r="2.8" />
            <circle cx="25" cy="28" r="2.8" />
            <circle cx="31.5" cy="28" r="2.8" />
            <circle cx="38" cy="28" r="2.8" />
            <path d="M10.7 28l1 1 1.9-2M17.2 28l1 1 1.9-2" />
        </>
    ),
    subscription: (
        <>
            <rect x="5" y="9" width="26" height="23" rx="3" />
            <path d="M5 15h26M11 6v5M25 6v5M10.5 20.5h.01M15.5 20.5h.01M20.5 20.5h.01M10.5 25.5h.01" />
            <path d="M41.6 31a7.6 7.6 0 0 0-13.4-3.4" />
            <path d="M27.6 23.6l.5 4 3.9-.8" />
            <path d="M27.4 35.4a7.6 7.6 0 0 0 13.4 3.4" />
            <path d="M41.4 42.8l-.5-4-3.9.8" />
        </>
    ),
    staff: (
        <>
            <circle cx="15" cy="14" r="5" />
            <path d="M5 34a10 10 0 0 1 18.5-5.3" />
            <rect x="25" y="20" width="17" height="22" rx="2" />
            <path d="M29 26h9M29 30h6M29 36h9" />
            <path d="M35 24v.01" />
        </>
    ),
    messaging: (
        <>
            <path d="M7 8h21a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H16l-6 5v-5H7a3 3 0 0 1-3-3V11a3 3 0 0 1 3-3z" />
            <path d="M10 14h14M10 18.5h9" />
            <path d="M34.5 17H41a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-2v4.5L33.5 32H23a3 3 0 0 1-3-3v-1.5" />
        </>
    ),
    reviews: (
        <>
            <path d="M8 7h32a3 3 0 0 1 3 3v19a3 3 0 0 1-3 3H22l-8 7v-7H8a3 3 0 0 1-3-3V10a3 3 0 0 1 3-3z" />
            <path d="M24 13.9l1.6 4.3 4.7.3-3.6 2.9 1.2 4.4-3.9-2.5-3.9 2.5 1.2-4.4-3.6-2.9 4.7-.3z" />
        </>
    ),
    offline: (
        <>
            <path d="M14.5 35h19.8a7.7 7.7 0 0 0 1.3-15.3 11.5 11.5 0 0 0-21.6-1.9A8.6 8.6 0 0 0 14.5 35z" />
            <path d="M18.5 26.5l4 4 7.5-8" />
        </>
    ),
    reports: (
        <>
            <path d="M11 5.5h18l7.5 7.5v29.5H11z" />
            <path d="M29 5.5V13h7.5" />
            <path d="M16 36v-7M21.5 36V24M27 36v-5M32.5 36v-9" />
            <path d="M15 17h8" />
        </>
    ),
    deposit: (
        <>
            <rect x="4" y="8" width="27" height="24" rx="3" />
            <path d="M4 14h27M10 5v5M25 5v5M9.5 19.5h.01M14.5 19.5h.01M19.5 19.5h.01M9.5 24.5h.01" />
            <circle cx="34" cy="33" r="8.5" />
            <path d="M36.6 30.1c-.6-.8-1.6-1.3-2.8-1.3-1.6 0-2.8.8-2.8 2 0 2.8 5.7 1.4 5.7 4.2 0 1.2-1.2 2.1-3 2.1-1.2 0-2.3-.5-2.9-1.3M33.9 27.2v1.6M33.9 37.6v1.6" />
        </>
    ),
    reminder: (
        <>
            <rect x="8" y="5" width="20" height="38" rx="3.5" />
            <path d="M15 9h6M16 38.5h4" />
            <path d="M24 14h16a2.5 2.5 0 0 1 2.5 2.5v8A2.5 2.5 0 0 1 40 27h-5l-4.5 4v-4H24" />
            <path d="M29 19h9M29 22.5h5" />
        </>
    ),
    interac: (
        <>
            <path d="M9.5 19a15.5 15.5 0 0 1 26.4-6.2" />
            <path d="M37.2 7.2l-.8 5.9-5.8-1.1" />
            <path d="M38.5 29a15.5 15.5 0 0 1-26.4 6.2" />
            <path d="M10.8 40.8l.8-5.9 5.8 1.1" />
            <path d="M27.6 20c-.8-1.1-2-1.7-3.6-1.7-2.1 0-3.6 1.1-3.6 2.6 0 3.6 7.3 1.8 7.3 5.4 0 1.6-1.6 2.7-3.8 2.7-1.6 0-3-.6-3.7-1.7M24 16v2.2M24 29.6v2.2" />
        </>
    ),
    tapToPay: (
        <>
            <rect x="13" y="15" width="18" height="28" rx="3" />
            <path d="M19.5 18.5h5M20 39h4" />
            <path d="M16 10a9 9 0 0 1 12 0M12.5 6.5a14 14 0 0 1 19 0" />
            <rect x="31" y="26" width="12" height="8" rx="1.5" transform="rotate(-12 37 30)" />
        </>
    ),
    invoice: (
        <>
            <path d="M11 5.5h18l7.5 7.5v29.5H11z" />
            <path d="M29 5.5V13h7.5M16 15h8M16 21h15M16 25.5h15M16 30h9" />
            <path d="M24.5 37.5l2.5 2.5 5.5-6" />
        </>
    ),
    form: (
        <>
            <rect x="9" y="8" width="27" height="35" rx="3" />
            <rect x="16" y="4.5" width="13" height="7" rx="2" />
            <path d="M14.5 18h16M14.5 23h16M14.5 28h9" />
            <path d="M14.5 37.5c1.8-3.4 3.6-4 4.3-2 .6 1.8 1.7 2.4 3.2.4 1.2-1.6 2.2-1.6 3 .2.6 1.2 1.6 1.4 2.9.6" />
            <path d="M33.5 30.5l7.8-7.8a1.9 1.9 0 0 1 2.7 2.7l-7.8 7.8-3.6.9z" />
        </>
    ),
    retail: (
        <>
            <path d="M12 16h8v4.5l2.5 3.2v16.3a2.5 2.5 0 0 1-2.5 2.5h-8A2.5 2.5 0 0 1 9.5 40V23.7l2.5-3.2z" />
            <rect x="13" y="9" width="6" height="7" rx="1.2" />
            <path d="M9.5 28.5h13M9.5 35h13" />
            <path d="M27.5 24.5l11-11h5.5v5.5l-11 11z" />
            <circle cx="40.2" cy="17.3" r="1.2" />
            <path d="M30 32.5c-1.5 2.5-1 5.5 1.5 6.5" />
        </>
    ),
} satisfies Record<string, ReactNode>;

export type LineIconName = keyof typeof DRAWINGS;

export function LineIcon({
    name,
    className = "line-icon",
}: {
    name: LineIconName;
    className?: string;
}) {
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
            {DRAWINGS[name]}
        </svg>
    );
}
