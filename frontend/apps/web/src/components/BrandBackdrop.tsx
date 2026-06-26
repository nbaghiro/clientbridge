import type { ReactNode } from "react";

const VARIANTS = ["whisper", "aurora", "grid", "pulse"] as const;
export type BackdropVariant = (typeof VARIANTS)[number];

export function resolveVariant(raw: string | null): BackdropVariant {
    return (VARIANTS as readonly string[]).includes(raw ?? "")
        ? (raw as BackdropVariant)
        : "whisper";
}

function Frame({ children }: { children: ReactNode }) {
    return (
        <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 600 820"
            preserveAspectRatio="xMidYMid slice"
            fill="none"
            aria-hidden="true"
        >
            {children}
        </svg>
    );
}

const NODES = [
    { cx: 96, cy: 168, d: "0s" },
    { cx: 520, cy: 196, d: "1.3s" },
    { cx: 132, cy: 470, d: "0.7s" },
    { cx: 470, cy: 372, d: "2.1s" },
    { cx: 250, cy: 612, d: "1.6s" },
    { cx: 486, cy: 588, d: "0.4s" },
];

export function BrandBackdrop({ variant }: { variant: BackdropVariant }) {
    if (variant === "aurora") return <Aurora />;
    if (variant === "grid") return <Grid />;
    if (variant === "pulse") return <Pulse />;
    return <Whisper />;
}

// whisper — the original signal/constellation, dimmed right down
function Whisper() {
    return (
        <Frame>
            <defs>
                <radialGradient id="bd-glow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#cfe0ff" stopOpacity="0.09" />
                    <stop offset="100%" stopColor="#cfe0ff" stopOpacity="0" />
                </radialGradient>
            </defs>
            <circle className="bd-glow" cx="300" cy="300" r="280" fill="url(#bd-glow)" />
            <g stroke="#fff" strokeOpacity="0.045" strokeWidth="1">
                <path d="M300 300 96 168M300 300 520 196M300 300 132 470M300 300 470 372M300 300 250 612M300 300 486 588" />
            </g>
            <g fill="#fff">
                {NODES.map((n) => (
                    <circle
                        key={`${n.cx}-${n.cy}`}
                        className="bd-node"
                        style={{ animationDelay: n.d }}
                        cx={n.cx}
                        cy={n.cy}
                        r="2.6"
                    />
                ))}
            </g>
            <g stroke="#fff" fill="none" strokeWidth="1">
                <circle
                    className="bd-ring"
                    style={{ animationDelay: "0s" }}
                    cx="300"
                    cy="300"
                    r="120"
                />
                <circle
                    className="bd-ring"
                    style={{ animationDelay: "2.6s" }}
                    cx="300"
                    cy="300"
                    r="120"
                />
                <circle
                    className="bd-ring"
                    style={{ animationDelay: "5.2s" }}
                    cx="300"
                    cy="300"
                    r="120"
                />
            </g>
            <circle className="bd-hub" cx="300" cy="300" r="4" fill="#fff" />
        </Frame>
    );
}

// aurora — soft drifting colour blobs, no hard edges
function Aurora() {
    return (
        <Frame>
            <defs>
                <radialGradient id="au1" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#7da0cf" stopOpacity="0.2" />
                    <stop offset="100%" stopColor="#7da0cf" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="au2" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#46618a" stopOpacity="0.24" />
                    <stop offset="100%" stopColor="#46618a" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="au3" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#9fb4d6" stopOpacity="0.14" />
                    <stop offset="100%" stopColor="#9fb4d6" stopOpacity="0" />
                </radialGradient>
            </defs>
            <circle className="bd-blob-a" cx="180" cy="240" r="280" fill="url(#au1)" />
            <circle className="bd-blob-b" cx="440" cy="520" r="320" fill="url(#au2)" />
            <circle className="bd-blob-c" cx="330" cy="150" r="240" fill="url(#au3)" />
        </Frame>
    );
}

// grid — a barely-there dot grid that slowly drifts
function Grid() {
    return (
        <Frame>
            <defs>
                <pattern id="bd-dots" width="34" height="34" patternUnits="userSpaceOnUse">
                    <circle cx="2" cy="2" r="1.3" fill="#fff" fillOpacity="0.05" />
                </pattern>
                <radialGradient id="bd-glow2" cx="50%" cy="40%" r="55%">
                    <stop offset="0%" stopColor="#cfe0ff" stopOpacity="0.08" />
                    <stop offset="100%" stopColor="#cfe0ff" stopOpacity="0" />
                </radialGradient>
            </defs>
            <rect
                className="bd-drift"
                x="-40"
                y="-40"
                width="680"
                height="900"
                fill="url(#bd-dots)"
            />
            <rect width="600" height="820" fill="url(#bd-glow2)" />
        </Frame>
    );
}

// pulse — a few concentric rings that breathe in unison, very faint
function Pulse() {
    return (
        <Frame>
            <defs>
                <radialGradient id="bd-glow3" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#cfe0ff" stopOpacity="0.09" />
                    <stop offset="100%" stopColor="#cfe0ff" stopOpacity="0" />
                </radialGradient>
            </defs>
            <circle className="bd-glow" cx="300" cy="330" r="280" fill="url(#bd-glow3)" />
            <g stroke="#fff" fill="none" strokeWidth="1">
                <circle className="bd-breathe" cx="300" cy="330" r="80" />
                <circle className="bd-breathe" cx="300" cy="330" r="150" />
                <circle className="bd-breathe" cx="300" cy="330" r="220" />
            </g>
        </Frame>
    );
}
