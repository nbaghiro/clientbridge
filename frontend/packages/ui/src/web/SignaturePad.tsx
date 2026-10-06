import {
    type SignaturePadProps,
    type SignatureStrokes,
    strings,
    useControllable,
} from "@clientbridge/app-core/public";
import { type PointerEvent, useRef, useState } from "react";

import { type WebProps, cx } from "./props";

const path = (stroke: readonly (readonly [number, number])[]): string =>
    stroke.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(4)} ${y.toFixed(4)}`).join(" ");

export function SignaturePad({
    strokes: strokesProp,
    defaultStrokes = [],
    onChange,
    editable = onChange !== undefined,
    label,
    placeholder,
    clearLabel = strings.ui.clear,
    height = 140,
    className,
}: WebProps<SignaturePadProps>) {
    const box = useRef<SVGSVGElement>(null);
    const [strokes, setStrokes] = useControllable(strokesProp, defaultStrokes, onChange);
    const [live, setLive] = useState<[number, number][] | null>(null);

    const point = (e: PointerEvent): [number, number] => {
        const r = box.current?.getBoundingClientRect();
        if (!r) return [0, 0];
        return [
            Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
            Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
        ];
    };

    const finish = (): void => {
        if (live !== null && live.length > 1) setStrokes([...strokes, live] as SignatureStrokes);
        setLive(null);
    };

    const shown = live === null ? strokes : [...strokes, live];

    return (
        <div
            className={cx(
                editable ? "relative rounded-md border border-line bg-bg" : "relative",
                className,
            )}
        >
            <svg
                ref={box}
                role="img"
                aria-label={label}
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
                style={{ height, touchAction: editable ? "none" : undefined }}
                className={`block w-full ${editable ? "cursor-crosshair select-none" : ""}`}
                onPointerDown={
                    editable
                        ? (e) => {
                              e.preventDefault();
                              e.currentTarget.setPointerCapture(e.pointerId);
                              setLive([point(e)]);
                          }
                        : undefined
                }
                onPointerMove={
                    editable && live !== null
                        ? (e) => {
                              setLive([...live, point(e)]);
                          }
                        : undefined
                }
                onPointerUp={editable ? finish : undefined}
                onPointerLeave={editable ? finish : undefined}
            >
                {shown.map((s, i) => (
                    <path
                        key={i}
                        d={path(s)}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                        className="text-ink"
                    />
                ))}
            </svg>
            {editable ? (
                <>
                    <span
                        aria-hidden
                        className="pointer-events-none absolute inset-x-5 bottom-7 border-b border-dashed border-line"
                    />
                    {shown.length === 0 && placeholder !== undefined ? (
                        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted">
                            {placeholder}
                        </span>
                    ) : null}
                    {strokes.length > 0 ? (
                        <button
                            type="button"
                            onClick={() => {
                                setStrokes([]);
                            }}
                            className="absolute right-2 top-2 rounded px-2 py-1 text-xs font-medium text-accent hover:bg-surface"
                        >
                            {clearLabel}
                        </button>
                    ) : null}
                </>
            ) : null}
        </div>
    );
}
