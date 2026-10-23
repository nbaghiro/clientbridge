import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";

// iOS shows one native modal at a time, so a sheet asked for while one is open draws inside the top one.
let stack: number[] = [];
let overlay: ReactNode = null;
let nextId = 0;
const listeners = new Set<() => void>();

const emit = (): void => {
    for (const listener of listeners) listener();
};
const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

export function useModalLayer(active: boolean): boolean {
    const [id] = useState(() => ++nextId);
    useEffect(() => {
        if (!active) return;
        stack = [...stack, id];
        emit();
        return () => {
            stack = stack.filter((x) => x !== id);
            emit();
        };
    }, [active, id]);
    return useSyncExternalStore(subscribe, () => stack.at(-1) === id);
}

export function useAnyModalOpen(): boolean {
    return useSyncExternalStore(subscribe, () => stack.length > 0);
}

export function showOverlay(node: ReactNode): void {
    overlay = node;
    emit();
}

export function useOverlay(): ReactNode {
    return useSyncExternalStore(subscribe, () => overlay);
}
