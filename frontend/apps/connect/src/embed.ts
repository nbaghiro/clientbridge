import { useEffect, useRef } from "react";

/** Messages the embedded widget posts up to the host page's loader (public/embed.js). */
interface EmbedMessage {
    type: "resize" | "success";
    height?: number;
    widget?: string;
}

const SOURCE = "clientbridge-connect";

/** Embedded when the loader added `?embed=1` or the page is framed (a framed cross-origin read throws). */
export function isEmbedded(): boolean {
    if (typeof window === "undefined") return false;
    if (new URLSearchParams(window.location.search).get("embed") === "1") return true;
    try {
        return window.self !== window.top;
    } catch {
        return true;
    }
}

function postToParent(message: EmbedMessage): void {
    if (typeof window === "undefined" || window.parent === window) return;
    // "*" is safe: the payload is only a height and a success flag, and the loader checks `source`.
    window.parent.postMessage({ source: SOURCE, ...message }, "*");
}

/** Reports the body's height so the host sizes the iframe; documentElement.scrollHeight never shrinks. */
export function useEmbedResize(): void {
    useEffect(() => {
        if (!isEmbedded()) return undefined;
        const post = (): void => {
            postToParent({
                type: "resize",
                height: Math.ceil(document.body.getBoundingClientRect().height),
            });
        };
        post();
        const observer = new ResizeObserver(post);
        observer.observe(document.body);
        return () => {
            observer.disconnect();
        };
    }, []);
}

/** Tells the host a flow finished this session, but not when a customer reopens a finished link. */
export function useEmbedSuccess(active: boolean, widget: string): void {
    const sent = useRef(false);
    const seenInactive = useRef(false);
    useEffect(() => {
        if (!active) {
            seenInactive.current = true;
            return;
        }
        if (seenInactive.current && !sent.current) {
            sent.current = true;
            postToParent({ type: "success", widget });
        }
    }, [active, widget]);
}
