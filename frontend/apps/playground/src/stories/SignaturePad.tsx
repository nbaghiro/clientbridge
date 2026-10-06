import type { SignaturePadProps, SignatureStrokes } from "@clientbridge/app-core";

import { noop, story } from "../story";

const wave = (x0: number, x1: number, y: number, amp: number): [number, number][] =>
    Array.from({ length: 24 }, (_, i) => {
        const t = i / 23;
        return [x0 + (x1 - x0) * t, y + Math.sin(t * Math.PI * 3) * amp];
    });

const SIGNED: SignatureStrokes = [
    wave(0.1, 0.45, 0.55, 0.15),
    wave(0.5, 0.88, 0.5, 0.12),
    [
        [0.12, 0.75],
        [0.85, 0.72],
    ],
];

export default story<SignaturePadProps>({
    component: "SignaturePad",
    summary: "A hand-drawn signature as strokes in a 0..1 box, to draw or to show.",
    controls: {
        label: { type: "text" },
        placeholder: { type: "text" },
        editable: { type: "boolean" },
        height: { type: "number", min: 60, max: 240, step: 10 },
    },
    examples: [
        {
            key: "empty",
            title: "Empty, ready to sign",
            props: () => ({
                editable: true,
                label: "Signature",
                placeholder: "Sign here",
                onChange: noop,
            }),
        },
        {
            key: "signed",
            title: "Signed, editable",
            props: () => ({
                defaultStrokes: SIGNED,
                editable: true,
                label: "Signature",
                placeholder: "Sign here",
            }),
        },
        {
            key: "read-only",
            title: "Read only, on a signed contract",
            props: () => ({ strokes: SIGNED, label: "Amélie Tremblay's signature", height: 72 }),
        },
    ],
});
