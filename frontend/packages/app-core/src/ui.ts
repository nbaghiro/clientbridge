import type { ReactNode } from "react";

// Domain-neutral visual tone. Each platform maps it to its own tokens (Tailwind classes / RN colors).
export type Intent = "accent" | "success" | "warning" | "danger" | "neutral";

// Prop contracts for the per-platform building blocks; web and mobile implement the same shapes.

export interface ListSegments<K extends string> {
    items: readonly { key: K; label: string }[];
    active: K;
    onSelect: (key: K) => void;
}

export interface ListSearch {
    value: string;
    onChange: (q: string) => void;
    placeholder: string;
}

export interface ListAction {
    label: string;
    onPress: () => void;
}

export interface ListPageProps<T, K extends string = string> {
    title?: string | undefined;
    summary?: string | undefined;
    action?: ListAction | undefined;
    accessory?: ReactNode | undefined;
    segments?: ListSegments<K> | undefined;
    search?: ListSearch | undefined;
    banner?: ReactNode | undefined;
    head?: ReactNode | undefined;
    rows: readonly T[];
    rowKey: (row: T) => string;
    renderRow: (row: T) => ReactNode;
    onRowPress?: ((row: T) => void) | undefined;
    empty: string;
    footer?: ReactNode | undefined;
}

export interface DetailStatus {
    status: string;
    intent: Intent;
}

export interface DetailViewProps {
    open: boolean;
    title: string;
    subtitle?: string | undefined;
    status?: DetailStatus | undefined;
    leading?: ReactNode | undefined;
    onClose: () => void;
    actions?: ReactNode | undefined;
    children: ReactNode;
}

export interface DetailSectionProps {
    title?: string | undefined;
    action?: ReactNode | undefined;
    children: ReactNode;
}

export interface MoneyProps {
    cents: number | null;
    tone?: "ink" | "muted" | "success" | "danger" | undefined;
    strong?: boolean | undefined;
}

export interface EmptyProps {
    message: string;
}

export interface ModalProps {
    open?: boolean | undefined;
    onClose: () => void;
    // sm/md/lg set the web width; xl is the large panel (wide on web, a tall sheet on mobile).
    size?: "sm" | "md" | "lg" | "xl" | undefined;
    // false when the children draw their own surface (an editor or a debug panel).
    framed?: boolean | undefined;
    children: ReactNode;
}

export interface PanelProps {
    title: string;
    children: ReactNode;
}
