import { type ReactNode, createElement, useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Printing a page in place breaks inside drawers, so the printed copy renders alone at the body.
export function usePrintSheet(): {
    print: (title?: string) => void;
    sheet: (content: ReactNode) => ReactNode;
} {
    const [job, setJob] = useState<{ title: string | undefined } | null>(null);
    useEffect(() => {
        if (job === null) return;
        const images = Array.from(document.querySelectorAll<HTMLImageElement>(".print-sheet img"));
        Promise.all(images.map((img) => img.decode().catch(() => undefined)))
            .then(() => {
                const before = document.title;
                if (job.title !== undefined) document.title = job.title;
                window.print();
                document.title = before;
                setJob(null);
            })
            .catch(() => undefined);
    }, [job]);
    return {
        print: (title) => {
            setJob({ title });
        },
        sheet: (content) =>
            job === null
                ? null
                : createPortal(
                      createElement("div", { className: "print-sheet" }, content),
                      document.body,
                  ),
    };
}
