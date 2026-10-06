import type { ReactNode } from "react";

import type { Kit } from "./kit";

export type ControlValue = string | number | boolean;

export type Control =
    | { type: "select"; options: readonly string[] }
    | { type: "boolean" }
    | { type: "text" }
    | { type: "number"; min?: number; max?: number; step?: number };

interface Example<P> {
    key: string;
    title: string;
    props: (kit: Kit) => P;
    // Modals, sheets and menus render behind an open button so they don't cover the page.
    overlay?: boolean;
}

export interface Story<P> {
    // The export name in @clientbridge/ui.
    component: string;
    summary: string;
    examples: readonly Example<P>[];
    // The main props the live panel edits, on top of the first example.
    controls?: { [K in keyof P]?: Control };
    // For a non-component export (confirm) or a component with per-platform props (Logo).
    render?: (kit: Kit, props: P) => ReactNode;
}

export interface StoryEntry {
    component: string;
    summary: string;
    examples: readonly {
        key: string;
        title: string;
        props: (kit: Kit) => object;
        overlay?: boolean;
    }[];
    controls?: Readonly<Record<string, Control>>;
    render?: (kit: Kit, props: object) => ReactNode;
}

export function story<P extends object>(s: Story<P>): StoryEntry {
    return s as unknown as StoryEntry;
}

export const noop = (): void => undefined;
