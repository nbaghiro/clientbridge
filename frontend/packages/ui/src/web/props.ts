import type { Ref, RefCallback } from "react";

// Every web component takes a className, appended last, as an escape hatch for spacing and width.
export type WebProps<P> = P & { className?: string | undefined };

export interface WithRef<E> {
    ref?: Ref<E> | undefined;
}

// One element, two refs: the component's own and the caller's.
export function mergeRefs<E>(...refs: (Ref<E> | undefined)[]): RefCallback<E> {
    return (el) => {
        for (const ref of refs) {
            if (typeof ref === "function") ref(el);
            else if (ref) ref.current = el;
        }
    };
}

export function cx(...parts: (string | false | null | undefined)[]): string {
    return parts.filter(Boolean).join(" ");
}
