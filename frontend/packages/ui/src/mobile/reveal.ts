import { createContext, useCallback, useContext, useRef, type RefObject } from "react";
import type {
    LayoutChangeEvent,
    NativeScrollEvent,
    NativeSyntheticEvent,
    ScrollView,
    View,
} from "react-native";

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
): {
    reveal: Reveal;
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
    onLayout: (event: LayoutChangeEvent) => void;
    onContentSizeChange: (width: number, height: number) => void;
} {
    const offset = useRef(0);
    const viewport = useRef(0);
    const content = useRef(0);
    const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
        offset.current = event.nativeEvent.contentOffset.y;
    }, []);
    const onLayout = useCallback((event: LayoutChangeEvent) => {
        viewport.current = event.nativeEvent.layout.height;
    }, []);
    const onContentSizeChange = useCallback((_width: number, height: number) => {
        content.current = height;
    }, []);
    const reveal = useCallback(
        (target: Measurable) => {
            const host = scroller.current?.getNativeScrollRef() ?? null;
            if (host === null) return;
            host.measureInWindow((_x, top, _w, height) => {
                target.measureInWindow((_tx, y, _tw, h) => {
                    const below = y + h + MARGIN - (top + height);
                    const above = top + MARGIN - y;
                    const shift =
                        below > 0 ? Math.min(below, Math.max(0, -above)) : above > 0 ? -above : 0;
                    if (shift === 0) return;
                    const max = Math.max(0, content.current - viewport.current);
                    const next = Math.min(max, Math.max(0, offset.current + shift));
                    if (next === offset.current) return;
                    scroller.current?.scrollTo({ y: next, animated: true });
                    offset.current = next;
                    onRevealed?.(next);
                });
            });
        },
        [scroller, onRevealed],
    );
    return { reveal, onScroll, onLayout, onContentSizeChange };
}
