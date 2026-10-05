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

export type ButtonVariant = "primary" | "outline" | "quiet" | "danger" | "link";
export type ControlSize = "sm" | "md" | "lg";

export interface ButtonProps {
    children: ReactNode;
    onPress?: (() => void) | undefined;
    variant?: ButtonVariant | undefined;
    size?: ControlSize | undefined;
    // Web only: submits the surrounding form instead of calling onPress.
    submit?: boolean | undefined;
    disabled?: boolean | undefined;
    busy?: boolean | undefined;
    full?: boolean | undefined;
    grow?: boolean | undefined;
    icon?: ReactNode | undefined;
    label?: string | undefined;
}

export interface FieldProps {
    label: string;
    hint?: string | undefined;
    error?: string | null | undefined;
    optional?: boolean | undefined;
    required?: boolean | undefined;
    children: ReactNode;
}

export type TextFieldType =
    "text" | "email" | "password" | "number" | "tel" | "url" | "date" | "time" | "datetime-local";

export interface TextFieldProps {
    // Without a label the placeholder (or `name`) names the input for screen readers.
    label?: string | undefined;
    name?: string | undefined;
    hint?: string | undefined;
    error?: string | null | undefined;
    optional?: boolean | undefined;
    value: string;
    onChange: (value: string) => void;
    onSubmit?: (() => void) | undefined;
    placeholder?: string | undefined;
    // Fixed text shown inside the box before the value (a URL prefix, a currency sign).
    prefix?: string | undefined;
    type?: TextFieldType | undefined;
    multiline?: boolean | undefined;
    rows?: number | undefined;
    size?: "sm" | "md" | "lg" | undefined;
    surface?: "bg" | "surface" | undefined;
    width?: "full" | "narrow" | "auto" | undefined;
    disabled?: boolean | undefined;
    autoFocus?: boolean | undefined;
    autoComplete?: string | undefined;
    required?: boolean | undefined;
    min?: string | undefined;
    max?: string | undefined;
    step?: string | undefined;
    maxLength?: number | undefined;
}

export interface SelectOption<K extends string> {
    key: K;
    label: string;
}

export interface SelectProps<K extends string> {
    label?: string | undefined;
    name?: string | undefined;
    hint?: string | undefined;
    error?: string | null | undefined;
    value: K;
    options: readonly SelectOption<K>[];
    onChange: (key: K) => void;
    size?: "sm" | "md" | "lg" | undefined;
    disabled?: boolean | undefined;
}

export interface ToggleProps {
    label: string;
    hint?: string | undefined;
    value: boolean;
    onChange: (value: boolean) => void;
    disabled?: boolean | undefined;
}

export interface SearchFieldProps {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    autoFocus?: boolean | undefined;
}

export type NoticeTone = "danger" | "success" | "info";

export interface NoticeProps {
    tone: NoticeTone;
    // false: a line of text under a field or form; true: a filled box.
    banner?: boolean | undefined;
    children: ReactNode;
}

export interface ChoiceOption<K extends string> {
    key: K;
    label: string;
    hint?: string | undefined;
    disabled?: boolean | undefined;
}

export interface ChoiceProps<K extends string> {
    options: readonly ChoiceOption<K>[];
    // An array marks several as chosen; onChange gets the pressed key either way.
    value: K | readonly K[] | null;
    onChange: (key: K) => void;
    layout?: "chips" | "segmented" | "cards" | undefined;
    label?: string | undefined;
}

export interface PanelProps {
    title?: string | undefined;
    subtitle?: string | undefined;
    actions?: ReactNode | undefined;
    // true drops the padding so a list or table runs edge to edge.
    flush?: boolean | undefined;
    children: ReactNode;
}

export interface LoadingProps {
    label?: string | undefined;
    inline?: boolean | undefined;
}

export interface BadgeProps {
    label: string | number;
    intent?: Intent | undefined;
    kind?: "pill" | "count" | undefined;
}

export interface StatProps {
    label: string;
    cents?: number | null | undefined;
    value?: string | undefined;
    tone?: "ink" | "muted" | "success" | "danger" | undefined;
    hint?: string | undefined;
    // lg is a headline figure (Today); md sits several to a card (Reports).
    size?: "md" | "lg" | undefined;
}

export interface StarsProps {
    value: number;
    onSelect?: ((value: number) => void) | undefined;
    size?: "sm" | "md" | "lg" | undefined;
}

export interface StepperProps {
    value: number;
    onChange: (value: number) => void;
    min?: number | undefined;
    max?: number | undefined;
    label: string;
}

export interface ConfirmOptions {
    title: string;
    message?: string | undefined;
    confirmLabel: string;
    destructive?: boolean | undefined;
}

export interface PageHeaderProps {
    title: string;
    subtitle?: string | undefined;
    actions?: ReactNode | undefined;
    // A tab row or filters under the title.
    children?: ReactNode | undefined;
}
