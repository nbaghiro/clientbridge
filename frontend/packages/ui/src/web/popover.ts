import {
    type CSSProperties,
    type RefObject,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from "react";

export type Place = "below-start" | "below-end" | "above-start" | "above-end";

const GAP = 6;
const HIDDEN: CSSProperties = { position: "fixed", visibility: "hidden" };
const MARGIN = 8;

// The preferred placement, flipped to the other side wherever the box would leave the window.
export function fitted(preferred: Place, box: DOMRect): Place {
    let [side, edge] = preferred.split("-") as ["below" | "above", "start" | "end"];
    if (side === "below" && box.bottom > window.innerHeight && box.top - box.height > 0)
        side = "above";
    else if (side === "above" && box.top < 0) side = "below";
    if (edge === "start" && box.right > window.innerWidth) edge = "end";
    else if (edge === "end" && box.left < 0) edge = "start";
    return `${side}-${edge}`;
}

function place(anchor: DOMRect, panel: HTMLElement, minWidth: number | "anchor"): CSSProperties {
    const width = minWidth === "anchor" ? Math.max(anchor.width, 200) : minWidth;
    const below = window.innerHeight - anchor.bottom - GAP - MARGIN;
    const above = anchor.top - GAP - MARGIN;
    const wanted = Math.min(panel.scrollHeight, 360);
    const down = below >= wanted || below >= above;
    const preferred: Place = down ? "below-start" : "above-start";
    const box = new DOMRect(anchor.left, 0, width, 0);
    const edge = fitted(preferred, box).endsWith("end") ? "end" : "start";
    const left =
        edge === "start"
            ? Math.max(MARGIN, anchor.left)
            : Math.max(MARGIN, Math.min(anchor.right, window.innerWidth - MARGIN) - width);
    return {
        position: "fixed",
        left,
        ...(minWidth === "anchor" ? { width } : {}),
        maxWidth: window.innerWidth - MARGIN * 2,
        maxHeight: Math.min(400, Math.max(160, down ? below : above)),
        ...(down
            ? { top: anchor.bottom + GAP }
            : { bottom: window.innerHeight - anchor.top + GAP }),
    };
}

// A portalled panel pinned below its anchor (above when only that fits), closed by a press outside.
export function usePopover(
    open: boolean,
    anchor: RefObject<HTMLElement | null>,
    onClose: () => void,
    minWidth: number | "anchor" = "anchor",
): {
    panel: RefObject<HTMLDivElement | null>;
    style: CSSProperties;
    host: HTMLElement | null;
    // True once the panel sits in place and can take focus.
    placed: boolean;
} {
    const panel = useRef<HTMLDivElement>(null);
    const [host, setHost] = useState<HTMLElement | null>(null);
    const [style, setStyle] = useState<CSSProperties>(HIDDEN);
    const close = useRef(onClose);
    useEffect(() => {
        close.current = onClose;
    });
    useLayoutEffect(() => {
        setHost(
            open && anchor.current !== null
                ? (anchor.current.closest<HTMLElement>('[role="dialog"]') ?? document.body)
                : null,
        );
        if (!open) setStyle(HIDDEN);
    }, [open, anchor]);
    useLayoutEffect(() => {
        if (host === null) return undefined;
        const update = (): void => {
            if (anchor.current === null || panel.current === null) return;
            setStyle(place(anchor.current.getBoundingClientRect(), panel.current, minWidth));
        };
        update();
        const onDown = (e: MouseEvent): void => {
            const t = e.target as Node;
            if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
            close.current();
        };
        window.addEventListener("resize", update);
        window.addEventListener("scroll", update, true);
        window.addEventListener("mousedown", onDown);
        return () => {
            window.removeEventListener("resize", update);
            window.removeEventListener("scroll", update, true);
            window.removeEventListener("mousedown", onDown);
        };
    }, [host, anchor, minWidth]);
    return {
        panel,
        style,
        host: open ? host : null,
        placed: open && style.visibility !== "hidden",
    };
}
