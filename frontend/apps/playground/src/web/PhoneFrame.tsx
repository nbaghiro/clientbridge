import { type Ref, useLayoutEffect, useRef, useState } from "react";

const PHONES = {
    iphone: { width: 393, height: 852, radius: 55, bezel: 11, statusHeight: 54, label: "iPhone" },
    android: { width: 412, height: 915, radius: 38, bezel: 9, statusHeight: 32, label: "Android" },
} as const;

// Shrinks a fixed-size device to the space it has, keeping its real CSS pixel width inside.
function useFit(width: number, max: number): [Ref<HTMLElement>, number] {
    const ref = useRef<HTMLElement>(null);
    const [scale, setScale] = useState(max);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        const obs = new ResizeObserver(() => {
            setScale(Math.min(max, el.clientWidth / width));
        });
        obs.observe(el);
        return () => {
            obs.disconnect();
        };
    }, [width, max]);
    return [ref, scale];
}

function StatusBar({ device }: { device: keyof typeof PHONES }) {
    const p = PHONES[device];
    return (
        <div
            style={{ height: p.statusHeight }}
            className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between px-8 text-[15px] font-semibold text-ink"
        >
            <span className={device === "android" ? "text-[13px]" : ""}>9:41</span>
            {device === "iphone" ? (
                <span className="absolute left-1/2 top-[11px] h-[34px] w-[124px] -translate-x-1/2 rounded-full bg-[#000]" />
            ) : (
                <span className="absolute left-1/2 top-[10px] h-[13px] w-[13px] -translate-x-1/2 rounded-full bg-[#000]" />
            )}
            <span className="h-3 w-6 rounded-sm border border-ink/40 p-px">
                <span className="block h-full w-4/5 rounded-[1px] bg-ink" />
            </span>
        </div>
    );
}

export function PhoneFrame({
    src,
    device,
    frameRef,
}: {
    src: string;
    device: keyof typeof PHONES;
    frameRef?: Ref<HTMLIFrameElement>;
}) {
    const p = PHONES[device];
    const outerW = p.width + p.bezel * 2;
    const outerH = p.height + p.bezel * 2;
    const [ref, scale] = useFit(outerW, 0.78);
    return (
        <figure ref={ref} className="w-full min-w-0 max-w-[340px]">
            <div style={{ width: outerW * scale, height: outerH * scale }}>
                <div
                    style={{
                        width: outerW,
                        height: outerH,
                        padding: p.bezel,
                        borderRadius: p.radius + p.bezel,
                        transform: `scale(${String(scale)})`,
                        transformOrigin: "top left",
                    }}
                    className="bg-[#111] shadow-[0_20px_50px_-20px_rgba(0,0,0,0.45)]"
                >
                    <div
                        style={{ borderRadius: p.radius }}
                        className="relative h-full w-full overflow-hidden bg-bg"
                    >
                        <StatusBar device={device} />
                        <iframe
                            ref={frameRef}
                            title={`${p.label} preview`}
                            src={src}
                            style={{ width: p.width, height: p.height }}
                            className="block border-0"
                        />
                    </div>
                </div>
            </div>
            <figcaption className="mt-2 text-center text-xs text-muted">{p.label}</figcaption>
        </figure>
    );
}
