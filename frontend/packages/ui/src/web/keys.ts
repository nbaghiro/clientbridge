import type { KeyboardEvent } from "react";

const NEXT = { horizontal: "ArrowRight", vertical: "ArrowDown" } as const;
const PREV = { horizontal: "ArrowLeft", vertical: "ArrowUp" } as const;

// Arrow keys, Home and End move focus between a group's items (tabs, radios, menu items).
export function moveFocus(
    e: KeyboardEvent<HTMLElement>,
    selector: string,
    axis: "horizontal" | "vertical" | "both",
): void {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>(selector)].filter(
        (el) => !el.hasAttribute("disabled"),
    );
    const at = items.findIndex((el) => el === document.activeElement);
    const next = axis === "both" ? [NEXT.horizontal, NEXT.vertical] : [NEXT[axis]];
    const prev = axis === "both" ? [PREV.horizontal, PREV.vertical] : [PREV[axis]];
    let to: number | null = null;
    if ((next as string[]).includes(e.key)) to = (at + 1) % items.length;
    else if ((prev as string[]).includes(e.key)) to = (at - 1 + items.length) % items.length;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = items.length - 1;
    if (to === null || items.length === 0) return;
    e.preventDefault();
    items[to]?.focus();
}
