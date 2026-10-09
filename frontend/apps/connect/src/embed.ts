import { useEffect, useRef } from "react";
import { type PublicBrand, strings } from "@clientbridge/app-core/public";

/** Messages the embedded widget posts up to the host page's loader (public/embed.js). */
interface EmbedMessage {
    type: "resize" | "success" | "brand" | "dismiss";
    brand?: {
        name: string;
        primary: string | null;
        mark: string | null;
        title: string;
        footer: string;
    };
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
    // Only public brand metadata, height and completion flags cross the frame boundary.
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
        const dismiss = (event: KeyboardEvent): void => {
            if (
                event.key === "Escape" &&
                !event.defaultPrevented &&
                !document.querySelector('dialog[open], [role="dialog"]')
            )
                postToParent({ type: "dismiss" });
        };
        window.addEventListener("keydown", dismiss);
        const observer = new ResizeObserver(post);
        observer.observe(document.body);
        return () => {
            observer.disconnect();
            window.removeEventListener("keydown", dismiss);
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

export function useEmbedBrand(page: { business_name: string; brand: PublicBrand } | null): void {
    const name = page?.business_name;
    const primary = page?.brand.primary;
    const mark = page?.brand.avatar_url ?? page?.brand.logo_url;
    useEffect(() => {
        if (!isEmbedded() || name === undefined) return;
        const send = (): void => {
            postToParent({
                type: "brand",
                brand: {
                    name,
                    primary: primary ?? null,
                    mark: mark ?? null,
                    title: strings.publicBooking.title,
                    footer: strings.publicLanding.poweredBy,
                },
            });
        };
        send();
        const receive = (event: MessageEvent<unknown>): void => {
            if (
                event.source !== window.parent ||
                typeof event.data !== "object" ||
                event.data === null
            )
                return;
            if (
                "source" in event.data &&
                event.data.source === "clientbridge-host" &&
                "type" in event.data &&
                event.data.type === "ready"
            )
                send();
        };
        window.addEventListener("message", receive);
        return () => {
            window.removeEventListener("message", receive);
        };
    }, [name, primary, mark]);
}
