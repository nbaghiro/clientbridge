import { createContext, useCallback, useContext, useRef, type RefObject } from "react";
import type { ScrollView, View } from "react-native";

type Measurable = Pick<View, "measureInWindow">;
type Reveal = (target: Measurable) => void;

const RevealContext = createContext<Reveal | null>(null);
export const RevealProvider = RevealContext.Provider;

export function useReveal(): Reveal | null {
    return useContext(RevealContext);
}

// clears the home indicator and shows the start of the control after the target
const MARGIN = 48;

/** Scrolls a target that appeared outside the visible part of a scroll view, such as an error, into view. */
export function useScrollReveal(
    scroller: RefObject<ScrollView | null>,
    onRevealed?: (y: number) => void,
): { reveal: Reveal; innerViewRef: RefObject<View> } {
    const innerViewRef = useRef<View>(null);
    const reveal = useCallback(
        (target: Measurable) => {
            const host = scroller.current?.getNativeScrollRef() ?? null;
            const content = innerViewRef.current;
            if (host === null || content === null) return;
            // the content is measured with the target, since a size change event can lag behind it
            host.measureInWindow((_x, top, _w, height) => {
                content.measureInWindow((_cx, start, _cw, length) => {
                    target.measureInWindow((_tx, y, _tw, h) => {
                        const offset = top - start;
                        const below = y + h + MARGIN - (top + height);
                        const above = top + MARGIN - y;
                        const shift =
                            below > 0
                                ? Math.min(below, Math.max(0, -above))
                                : above > 0
                                  ? -above
                                  : 0;
                        const max = Math.max(0, length - height);
                        const next = Math.min(max, Math.max(0, offset + shift));
                        if (Math.abs(next - offset) < 1) return;
                        scroller.current?.scrollTo({ y: next, animated: true });
                        onRevealed?.(next);
                    });
                });
            });
        },
        [scroller, onRevealed],
    );
    // ScrollView types its innerViewRef as never null, though it is until the content mounts
    return { reveal, innerViewRef: innerViewRef as RefObject<View> };
}
