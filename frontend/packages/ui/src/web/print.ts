import {
    type ReactNode,
    createElement,
    useEffect,
    useId,
    useState,
    useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

// One sheet at a time, kept until the next print: a phone's print() can return before it renders the page.
let printing: string | null = null;
const watchers = new Set<() => void>();

function claim(owner: string | null): void {
    printing = owner;
    for (const watcher of watchers) watcher();
}

function watch(watcher: () => void): () => void {
    watchers.add(watcher);
    return () => {
        watchers.delete(watcher);
    };
}

// Printing a page in place breaks inside drawers and modals, so the printed copy renders alone at the body.
export function usePrintSheet(): {
    print: (title?: string) => void;
    sheet: (content: ReactNode) => ReactNode;
} {
    const id = useId();
    const owns = useSyncExternalStore(watch, () => printing === id);
    const [job, setJob] = useState<{ title: string | undefined } | null>(null);
    useEffect(
        () => () => {
            if (printing === id) claim(null);
        },
        [id],
    );
    useEffect(() => {
        if (job === null) return;
        let cancelled = false;
        const before = document.title;
        const restore = (): void => {
            document.title = before;
        };
        const images = Array.from(document.querySelectorAll<HTMLImageElement>(".print-sheet img"));
        Promise.all(images.map((img) => img.decode().catch(() => undefined)))
            .then(() => {
                if (cancelled) return;
                if (job.title !== undefined) {
                    document.title = job.title;
                    window.addEventListener("afterprint", restore, { once: true });
                }
                window.print();
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
            window.removeEventListener("afterprint", restore);
            if (job.title !== undefined && document.title === job.title) restore();
        };
    }, [job]);
    return {
        print: (title) => {
            claim(id);
            setJob({ title });
        },
        sheet: (content) =>
            job === null || !owns
                ? null
                : createPortal(
                      createElement("div", { className: "print-sheet" }, content),
                      document.body,
                  ),
    };
}
