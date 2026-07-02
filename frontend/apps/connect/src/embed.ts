import { useEffect, useRef } from "react";

/** Messages the embedded widget posts up to the host page's loader (public/embed.js). */
interface EmbedMessage {
    type: "resize" | "success";
    height?: number;
    widget?: string;
}

const SOURCE = "clientbridge-connect";

/** True when running inside an embed: the loader appends `?embed=1`, and a bare `<iframe>` embed is
 *  detected by being framed (cross-origin `window.top` access throws, which also means framed). */
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
    // targetOrigin "*" is safe here: the payload is only a height + a success flag, and the loader
    // filters by `source` + the iframe it owns.
    window.parent.postMessage({ source: SOURCE, ...message }, "*");
}

/** Continuously report the content height so the host can size the iframe to fit (no inner scrollbar). */
export function useEmbedResize(): void {
    useEffect(() => {
        if (!isEmbedded()) return undefined;
        const post = (): void => {
            postToParent({
                type: "resize",
                height: Math.ceil(document.documentElement.scrollHeight),
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

/** Fire a one-shot `success` up to the host when a flow completes (booking booked, invoice paid, …),
 *  so the embedder can show its own confirmation / fire a conversion pixel / redirect. */
export function useEmbedSuccess(active: boolean, widget: string): void {
    const sent = useRef(false);
    useEffect(() => {
        if (active && !sent.current) {
            sent.current = true;
            postToParent({ type: "success", widget });
        }
    }, [active, widget]);
}
