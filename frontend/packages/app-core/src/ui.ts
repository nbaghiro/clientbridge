import type { ReactElement, ReactNode } from "react";

import type { AddPaymentMethod, Checkout, CheckoutMethod } from "./domain/checkout";
import type { FormAnswer } from "./domain/publicForm";
import type { IconName } from "./icons";

// Domain-neutral visual tone. Each platform maps it to its own tokens (Tailwind classes / RN colors).
export type Intent = "accent" | "success" | "warning" | "danger" | "neutral";

// Prop contracts for the per-platform building blocks; web and mobile implement the same shapes.

// A short status label on a row or tile: a discount, "Low stock", "Opted out".
export interface Tag {
    label: string;
    intent: Intent;
}

export interface UiAction {
    label: string;
    onPress: () => void;
}

interface ListSegments<K extends string> {
    items: readonly { key: K; label: string }[];
    active: K;
    onSelect: (key: K) => void;
}

interface ListSearch {
    value: string;
    onChange: (q: string) => void;
    placeholder: string;
}

export interface ListPageProps<T, K extends string = string> {
    title?: string | undefined;
    summary?: string | undefined;
    action?: UiAction | undefined;
    accessory?: ReactNode | undefined;
    segments?: ListSegments<K> | undefined;
    search?: ListSearch | undefined;
    banner?: ReactNode | undefined;
    head?: ReactNode | undefined;
    rows: readonly T[];
    rowKey: (row: T) => string;
    renderRow: (row: T) => ReactNode;
    onRowPress?: ((row: T) => void) | undefined;
    // A string is the plain empty line; EmptyProps adds an icon, body and next-step actions.
    empty: string | EmptyProps;
    // "loading" draws placeholder rows, "error" a failed load with onRetry; rows are ignored for both.
    state?: "loading" | "error" | undefined;
    onRetry?: (() => void) | undefined;
    footer?: ReactNode | undefined;
}

interface DetailStatus {
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
    body?: string | undefined;
    icon?: IconName | undefined;
    // Buttons for the next step; the first is usually primary.
    actions?: ReactNode | undefined;
    // "danger" for a failed load with a retry; "neutral" for nothing-here-yet.
    intent?: "neutral" | "danger" | undefined;
    // "inline" sits inside a panel; "card" is its own bordered block.
    variant?: "inline" | "card" | undefined;
}

// The one failed-load state: a danger Empty with a cloudOff glyph and an outline Try again.
export interface LoadFailedProps {
    message?: string | undefined;
    body?: string | undefined;
    // Without it the state shows no button (nothing on the screen can retry).
    onRetry?: (() => void) | undefined;
    retrying?: boolean | undefined;
    retryLabel?: string | undefined;
    variant?: "inline" | "card" | undefined;
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
// "inverse" draws a control for a dark, photo or brand-coloured background.
export type ControlTone = "default" | "inverse";

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
    // A glyph name, or an element for anything else (a brand mark, a spinner).
    icon?: IconName | ReactElement | undefined;
    label?: string | undefined;
    tone?: ControlTone | undefined;
}

export interface FieldProps {
    label: string;
    hint?: string | undefined;
    error?: string | null | undefined;
    optional?: boolean | undefined;
    required?: boolean | undefined;
    children: ReactNode;
}

// Dates and times have their own fields (DateField, TimeField, DateTimeField).
export type TextFieldType = "text" | "email" | "password" | "number" | "tel" | "url";

export interface TextFieldProps {
    // Without a label the placeholder (or `name`) names the input for screen readers.
    label?: string | undefined;
    name?: string | undefined;
    hint?: string | undefined;
    error?: string | null | undefined;
    optional?: boolean | undefined;
    value?: string | undefined;
    defaultValue?: string | undefined;
    onChange?: ((value: string) => void) | undefined;
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
    // Secondary text at the end of the row in the open list: "45 min · $45.00".
    detail?: string | undefined;
    // Options sharing a group sit under one heading, in the order the groups first appear.
    group?: string | undefined;
    disabled?: boolean | undefined;
}

export interface SelectProps<K extends string> {
    label?: string | undefined;
    name?: string | undefined;
    hint?: string | undefined;
    error?: string | null | undefined;
    value?: K | undefined;
    // Without value or defaultValue the first option starts chosen, unless there is a placeholder.
    defaultValue?: K | undefined;
    options: readonly SelectOption<K>[];
    onChange?: ((key: K) => void) | undefined;
    // Shown while the value matches no option.
    placeholder?: string | undefined;
    // A search box over the list; on by default for long lists.
    searchable?: boolean | undefined;
    size?: "sm" | "md" | "lg" | undefined;
    width?: "full" | "auto" | undefined;
    disabled?: boolean | undefined;
}

interface PickerFieldProps {
    label?: string | undefined;
    // Names the field for screen readers when there is no label.
    name?: string | undefined;
    hint?: string | undefined;
    error?: string | null | undefined;
    optional?: boolean | undefined;
    required?: boolean | undefined;
    placeholder?: string | undefined;
    size?: "sm" | "md" | "lg" | undefined;
    width?: "full" | "auto" | undefined;
    disabled?: boolean | undefined;
}

export interface DateFieldProps extends PickerFieldProps {
    // A "YYYY-MM-DD" day, or "" for none.
    value?: string | undefined;
    defaultValue?: string | undefined;
    onChange?: ((value: string) => void) | undefined;
    // The first and last days that can be picked, as "YYYY-MM-DD".
    min?: string | undefined;
    max?: string | undefined;
}

export interface TimeFieldProps extends PickerFieldProps {
    // A 24-hour "HH:MM", or "" for none.
    value?: string | undefined;
    defaultValue?: string | undefined;
    onChange?: ((value: string) => void) | undefined;
    // Minutes between the listed times (15 by default), and the first and last as "HH:MM".
    step?: number | undefined;
    min?: string | undefined;
    max?: string | undefined;
}

export interface DateTimeFieldProps extends Omit<PickerFieldProps, "placeholder"> {
    // A local "YYYY-MM-DDTHH:MM", or "" for none.
    value?: string | undefined;
    defaultValue?: string | undefined;
    onChange?: ((value: string) => void) | undefined;
    // The first day that can be picked, as "YYYY-MM-DD".
    min?: string | undefined;
    step?: number | undefined;
}

export interface ToggleProps {
    label: string;
    hint?: string | undefined;
    value?: boolean | undefined;
    defaultValue?: boolean | undefined;
    onChange?: ((value: boolean) => void) | undefined;
    disabled?: boolean | undefined;
}

export type SearchFieldKey = "up" | "down" | "enter" | "escape";

export interface SearchFieldProps {
    value?: string | undefined;
    defaultValue?: string | undefined;
    onChange?: ((value: string) => void) | undefined;
    placeholder: string;
    autoFocus?: boolean | undefined;
    // Arrow keys, Enter and Escape, for moving through results.
    onKey?: ((key: SearchFieldKey) => void) | undefined;
    // Shown at the end of the box: a shortcut hint or a Cancel action.
    trailing?: ReactNode | undefined;
    size?: "md" | "lg" | undefined;
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
    // A second line under the hint, smaller; tiles only.
    detail?: string | undefined;
    disabled?: boolean | undefined;
}

export interface ChoiceProps<K extends string> {
    options: readonly ChoiceOption<K>[];
    // An array marks several as chosen; onChange gets the pressed key either way.
    value?: K | readonly K[] | null | undefined;
    defaultValue?: K | readonly K[] | null | undefined;
    onChange?: ((key: K) => void) | undefined;
    layout?: "chips" | "segmented" | "cards" | "tiles" | undefined;
    label?: string | undefined;
    // Tiles only: how many to a row, and lg for client-facing screens (tips, a turned screen).
    columns?: 2 | 3 | 4 | 5 | undefined;
    size?: "md" | "lg" | undefined;
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
    variant?: "pill" | "count" | undefined;
}

export interface StatProps {
    label: string;
    cents?: number | null | undefined;
    value?: string | undefined;
    tone?: "ink" | "muted" | "success" | "warning" | "danger" | undefined;
    hint?: string | undefined;
    // lg is a headline figure (Today); md sits several to a card (Reports).
    size?: "md" | "lg" | undefined;
    // Appends the currency code, only for a figure in a currency other than the business's.
    currency?: string | undefined;
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
    cancelLabel?: string | undefined;
    destructive?: boolean | undefined;
}

export interface TabsProps<K extends string> {
    items: readonly { key: K; label: string }[];
    active: K;
    onSelect: (key: K) => void;
    // Names the tab list for screen readers.
    label?: string | undefined;
    // "underline" is the page tab bar; "pill" is a row of filled segments (a view switch).
    variant?: "underline" | "pill" | undefined;
    // Mobile only: false drops the side padding when the parent already has it.
    inset?: boolean | undefined;
}

export type PaymentAccountComponent = "onboarding" | "account" | "payments" | "payouts";

export interface PaymentAccountProps {
    component: PaymentAccountComponent;
    scope: string;
    fetchClientSecret: () => Promise<string>;
    onClose: () => void;
    preview?: boolean;
}

export interface CardFormProps {
    returnUrl?: string | undefined;
    clientSecret: string;
    // The connected account; on mobile the StripeProvider already targets it.
    stripeAccount: string;
    // "payment" confirms a charge; "setup" saves the method for later.
    mode?: "payment" | "setup" | undefined;
    submitLabel: string;
    busyLabel: string;
    onDone: () => void;
    // With onCancel the form sits in a frame with a cancel action; without, it is the bare public form.
    onCancel?: (() => void) | undefined;
}

export interface ChargeSheetProps {
    checkout: Checkout;
    methods: readonly CheckoutMethod[];
    amountLabel: string;
    // Defaults to the account the app set with setStripeAccount.
    stripeAccount?: string | undefined;
    submitLabel: string;
    busyLabel: string;
    onSubmit: () => void;
    onCancel: () => void;
    title?: string | undefined;
    // The sale's own fields (what is being bought), shown above the payment choice.
    children?: ReactNode | undefined;
}

// Raw status values are capitalized; asWritten keeps an already-worded label as it is.
export interface StatusPillProps {
    status: string;
    intent: Intent;
    asWritten?: boolean | undefined;
}

// Bank (PAD) mandates are web only, so mobile ignores allowBank.
export interface PaymentMethodFormProps {
    flow: AddPaymentMethod;
    allowBank: boolean;
}

export interface ItemImageProps {
    src: string | null;
    name: string;
    color?: string | null | undefined;
    size?: number | undefined;
}

export interface PageHeaderProps {
    title: string;
    subtitle?: string | undefined;
    actions?: ReactNode | undefined;
    // A tab row or filters under the title.
    children?: ReactNode | undefined;
}

export interface AvatarProps {
    src?: string | null | undefined;
    name: string;
    size?: "sm" | "md" | "lg" | "xl" | undefined;
    // A staff or pet colour; defaults to the accent tint.
    color?: string | null | undefined;
}

export interface KeyValueRow {
    label: string;
    value: ReactNode;
    intent?: Intent | undefined;
}

export interface KeyValueListProps {
    rows: readonly KeyValueRow[];
    // "stack" puts the label above the value (narrow panels); "inline" sets them on one line.
    layout?: "inline" | "stack" | undefined;
    // Stack layout only: facts per row.
    columns?: 2 | 3 | 4 | undefined;
}

export interface Fact {
    key: string;
    icon: IconName;
    title: string;
    detail?: string | undefined;
}

// Icon-led facts about one visit or order: when, who, what, where.
export interface FactListProps {
    facts: readonly Fact[];
    label?: string | undefined;
}

export interface IconProps {
    name: IconName;
    size?: number | undefined;
    // Web defaults to currentColor so the surrounding text colour applies.
    color?: string | undefined;
    // Set only when the icon carries meaning on its own; otherwise it is hidden from screen readers.
    label?: string | undefined;
}

export interface DocTotalLine {
    key: string;
    label: string;
    cents: number;
    // credit lowers what the client owes (green); deduction is taken off the business's side (neutral).
    kind: "subtotal" | "tax" | "total" | "credit" | "deduction" | "balance";
    hint?: string | undefined;
}

export interface DocTotalsProps {
    lines: readonly DocTotalLine[];
    // "compact" tightens spacing for side panels and receipts.
    density?: "regular" | "compact" | undefined;
}

export interface TimelineEntry {
    key: string;
    label: string;
    detail?: string | undefined;
    at: string;
    intent?: Intent | undefined;
    icon?: IconName | undefined;
    // A quoted body under the entry: a note or a message.
    quote?: string | undefined;
    // A right-hand figure such as an amount; moves the time under the label.
    aside?: string | undefined;
}

export interface ActivityTimelineProps {
    entries: readonly TimelineEntry[];
}

// Strokes of points in a 0..1 box, so a signature draws the same at any size and prints as vectors.
export type SignatureStrokes = readonly (readonly (readonly [number, number])[])[];

export interface SignaturePadProps {
    strokes?: SignatureStrokes | undefined;
    defaultStrokes?: SignatureStrokes | undefined;
    onChange?: ((strokes: SignatureStrokes) => void) | undefined;
    // Defaults to true when onChange is set; false only shows the signature (a signed document).
    editable?: boolean | undefined;
    label: string;
    placeholder?: string | undefined;
    clearLabel?: string | undefined;
    height?: number | undefined;
}

export interface FormQuestionField {
    input: string;
    name: string;
    label: string;
    help: string | null;
    required: boolean;
    options: readonly unknown[];
}

export interface FormQuestionProps {
    field: FormQuestionField;
    value: FormAnswer | undefined;
    // Without onChange the question is a preview: it looks real but takes no input.
    onChange?: ((value: FormAnswer) => void) | undefined;
    // Web passes the picked file; the mobile preview never uploads.
    onUpload?: ((file: Blob, name: string) => void) | undefined;
    fileName?: string | null | undefined;
    chooseFileLabel: string;
    selectPlaceholder: string;
    invalid?: boolean | undefined;
}

export interface ContractSignature {
    heading: string;
    name: string;
    strokes: SignatureStrokes | null;
    facts: readonly { label: string; value: string }[];
}

export interface ContractDocumentProps {
    issuer: string;
    title: string;
    meta: string;
    clauses: readonly { heading: string; text: string }[];
    signature?: ContractSignature | null | undefined;
    // "compact" sets smaller type for a thumbnail-sized preview beside other content.
    density?: "regular" | "compact" | undefined;
}

// "event" is a centred system line (an opt-out, a routing note), not a message.
export interface MessageBubbleProps {
    body: string;
    direction: "in" | "out";
    meta?: string | undefined;
    variant?: "message" | "event" | undefined;
    failed?: boolean | undefined;
    // "full" lets the bubble use the whole width, for previews in a narrow panel.
    width?: "auto" | "full" | undefined;
}

export interface ConversationRowProps {
    name: string;
    preview: string;
    at: string;
    unread: number;
    channel: "sms" | "email" | "chat";
    channelLabel: string;
    selected?: boolean | undefined;
    // Something to act on: opted out, a new number.
    tag?: Tag | undefined;
    onPress?: (() => void) | undefined;
}

export interface RatingDistributionProps {
    rows: readonly { stars: number; count: number }[];
    label: (stars: number, count: number) => string;
}

export type CalendarEventFlag =
    "online" | "recurring" | "deposit_due" | "addons" | "note" | "walk_in" | "class";

export interface CalendarEventCardProps {
    headline: string;
    detail?: string | undefined;
    time: string;
    // The visit's status; the fill and edge come from it.
    intent: Intent;
    // The service colour, shown as a small swatch.
    color?: string | null | undefined;
    // compact: one line for short visits; regular: headline over time and detail; full: three lines.
    density?: "compact" | "regular" | "full" | undefined;
    flags?: readonly CalendarEventFlag[] | undefined;
    // dragging lifts the card, refused marks a drop the server would reject, faded is done or filtered.
    state?: "idle" | "selected" | "dragging" | "refused" | "faded" | undefined;
    label: string;
    onPress?: (() => void) | undefined;
}

export interface DateStripDay {
    key: string;
    weekday: string;
    day: string;
    // 0 to 3 dots under the date.
    busy?: number | undefined;
    closed?: boolean | undefined;
    isToday?: boolean | undefined;
    disabled?: boolean | undefined;
}

export interface DateStripProps {
    days: readonly DateStripDay[];
    value?: string | null | undefined;
    defaultValue?: string | null | undefined;
    onChange?: ((key: string) => void) | undefined;
    label: string;
    onPrev?: (() => void) | undefined;
    onNext?: (() => void) | undefined;
    prevLabel?: string | undefined;
    nextLabel?: string | undefined;
}

export interface TimeSlot {
    key: string;
    label: string;
    hint?: string | undefined;
    disabled?: boolean | undefined;
}

export interface TimeSlotPickerProps {
    groups: readonly { label: string; slots: readonly TimeSlot[] }[];
    value?: string | null | undefined;
    defaultValue?: string | null | undefined;
    onChange?: ((key: string) => void) | undefined;
    label: string;
    columns?: 3 | 4 | 5 | undefined;
}

export interface IconButtonProps {
    icon: IconName;
    // Always required: the button has no visible text.
    label: string;
    onPress?: (() => void) | undefined;
    // A number shows a count, true a dot.
    badge?: number | boolean | undefined;
    variant?: "quiet" | "outline" | undefined;
    size?: "sm" | "md" | undefined;
    // A toggle's state (a filter on, a panel open); omit for a plain action.
    pressed?: boolean | undefined;
    disabled?: boolean | undefined;
    tone?: ControlTone | undefined;
}

export interface ListRowProps {
    title: ReactNode;
    detail?: ReactNode | undefined;
    // Right-aligned text inside the press target: a time, an amount, a status.
    meta?: ReactNode | undefined;
    icon?: IconName | undefined;
    // Tints the icon tile.
    intent?: Intent | undefined;
    // Replaces the icon tile: an avatar or a colour bar.
    leading?: ReactNode | undefined;
    // Actions beside the row, outside its press target.
    trailing?: ReactNode | undefined;
    unread?: boolean | undefined;
    // Keyboard-highlighted or currently open.
    selected?: boolean | undefined;
    onPress?: (() => void) | undefined;
    // Accessible name when the title is not plain text.
    label?: string | undefined;
    density?: "regular" | "compact" | undefined;
}

export interface ActionMenuItem {
    key: string;
    label: string;
    hint?: string | undefined;
    icon: IconName;
    // Web only: the single key that picks the item while the menu is open.
    shortcut?: string | undefined;
}

export interface ActionMenuProps {
    open: boolean;
    onClose: () => void;
    title?: string | undefined;
    items: readonly ActionMenuItem[];
    onSelect: (key: string) => void;
    // "grid" draws large tiles (two across on web, three on mobile).
    layout?: "list" | "grid" | undefined;
    // Extra content under the items, e.g. recent clients to book again.
    footer?: ReactNode | undefined;
    // Web only: the preferred side, flipped when it would leave the window; mobile is a sheet.
    placement?: "below-start" | "below-end" | "above-start" | "above-end" | undefined;
}

export interface ChecklistItem {
    key: string;
    label: string;
    hint?: string | undefined;
    done: boolean;
    // Not done and blocking something (a Stripe requirement, an overdue task).
    attention?: boolean | undefined;
    action?: UiAction | undefined;
}

export interface ChecklistProps {
    items: readonly ChecklistItem[];
    label: string;
}

export type ProgressStepState = "done" | "current" | "todo" | "blocked";

export interface ProgressStep {
    key: string;
    label: string;
    hint?: string | undefined;
    state: ProgressStepState;
}

export interface ProgressStepsProps {
    steps: readonly ProgressStep[];
    // "row" is a compact wizard header; "column" is a timeline with hints.
    layout?: "row" | "column" | undefined;
    label: string;
}

export interface CheckboxProps {
    label: string;
    value?: boolean | undefined;
    defaultValue?: boolean | undefined;
    onChange?: ((value: boolean) => void) | undefined;
    // Keeps the label for screen readers only (a table row's select box).
    hideLabel?: boolean | undefined;
    // Some but not all of a group are checked.
    mixed?: boolean | undefined;
    disabled?: boolean | undefined;
}

// The business's existing tags are offered first so the same tag isn't spelled three ways.
export interface TagInputProps {
    label: string;
    tags?: readonly string[] | undefined;
    defaultTags?: readonly string[] | undefined;
    onAdd?: ((tag: string) => void) | undefined;
    onRemove?: ((tag: string) => void) | undefined;
    // Existing tags with how many clients have each; the ones already chosen are skipped.
    suggestions?: readonly { tag: string; count: number }[] | undefined;
    placeholder: string;
    removeLabel?: ((tag: string) => string) | undefined;
    createLabel?: ((text: string) => string) | undefined;
}

export interface BrandMarkProps {
    // "card" | "bank_eft" | "interac", as on a saved payment method.
    method: string;
    brand: string | null;
    size?: "sm" | "md" | undefined;
}

export interface BarChartBar {
    key: string;
    label: string;
    value: number;
    valueLabel: string;
    // A period still in progress draws lighter.
    partial?: boolean | undefined;
    // Outside the period being looked at: drawn as context, not as the answer.
    dim?: boolean | undefined;
}

export interface BarChartProps {
    bars: readonly BarChartBar[];
    // Names the chart for screen readers.
    label: string;
    height?: number | undefined;
}

// `originalCents` prints struck through beside `cents` when a discount applies.
export interface LineItemProps {
    title: string;
    meta?: string | undefined;
    leading?: ReactNode | undefined;
    quantity?:
        | {
              value: number;
              onChange: (n: number) => void;
              label: string;
              // Defaults to 0; max is the stock left, so + stops there.
              min?: number | undefined;
              max?: number | undefined;
          }
        | undefined;
    // Read-only quantity ("2 ×") when there is no stepper.
    count?: number | undefined;
    cents: number;
    originalCents?: number | null | undefined;
    tag?: Tag | null | undefined;
    onPress?: (() => void) | undefined;
    pressLabel?: string | undefined;
    onRemove?: (() => void) | undefined;
    removeLabel?: string | undefined;
    selected?: boolean | undefined;
}

export interface DurationSegment {
    key: string;
    minutes: number;
    label: string;
    kind: "buffer" | "main";
}

export interface DurationBarProps {
    segments: readonly DurationSegment[];
    // The item colour for the main segment.
    color?: string | null | undefined;
    caption?: string | undefined;
}

export interface ImagePickerProps {
    src: string | null;
    name: string;
    color?: string | null | undefined;
    label: string;
    hint?: string | undefined;
    onPick: () => void;
    // Mobile only: a second source (the library when onPick takes a photo).
    onPickAlt?: (() => void) | undefined;
    altLabel?: string | undefined;
    onRemove?: (() => void) | undefined;
    removeLabel?: string | undefined;
    busy?: boolean | undefined;
    size?: "md" | "lg" | undefined;
}

export interface ItemTileProps {
    name: string;
    imageSrc: string | null;
    color: string | null;
    cents: number | null;
    meta?: string | undefined;
    tag?: Tag | null | undefined;
    // How many are already on the ticket; draws a count badge.
    count?: number | undefined;
    onPress?: (() => void) | undefined;
    disabled?: boolean | undefined;
    // card puts a square photo on top (product grids); tile is the compact register key.
    variant?: "tile" | "card" | undefined;
}

export interface SwatchPickerProps {
    label: string;
    colours: readonly string[];
    value?: string | undefined;
    defaultValue?: string | undefined;
    onChange?: ((colour: string) => void) | undefined;
}

export interface WeeklyHoursDay {
    weekday: number;
    label: string;
    short: string;
    open: boolean;
    start: string;
    end: string;
    hours: number;
    error: string | null;
}

export interface WeeklyHoursEditorProps {
    days: readonly WeeklyHoursDay[];
    timeOptions: readonly { key: string; label: string }[];
    onOpen: (weekday: number, open: boolean) => void;
    onTime: (weekday: number, which: "start" | "end", value: string) => void;
    // Shown on the first open day; copies its hours to the other weekdays.
    onCopy?: ((weekday: number) => void) | undefined;
    copyLabel: string;
    closedLabel: string;
    toLabel: string;
    hoursLabel: (hours: number) => string;
}

export interface PrintedDocLine {
    id: string;
    description: string;
    subject: string | null;
    quantity: number;
    unitCents: number;
    amountCents: number;
    taxCodes: readonly string[];
}

export interface PrintedDocTax {
    code: string;
    label: string;
    baseCents: number;
    cents: number;
}

export interface PrintedDocLabels {
    from: string;
    item: string;
    qty: string;
    price: string;
    tax: string;
    amount: string;
    taxSummary: string;
    taxBase: string;
    howToPay: string;
    scanToPay: string;
    paymentMethod: string;
    page: string;
    forPet: (pet: string) => string;
}

// One model for the PDF, the in-app preview and the Connect pages, so what staff see is what clients get.
export interface PrintedDoc {
    kind: "invoice" | "estimate" | "receipt";
    title: string;
    number: string;
    business: {
        name: string;
        initials: string;
        avatarUrl?: string | null;
        tagline: string;
        brandColor: string;
        address: readonly string[];
        phone: string;
        email: string;
        website: string;
        registration: string;
    };
    partyLabel: string;
    partyName: string;
    partyLines: readonly string[];
    meta: readonly { label: string; value: string }[];
    lines: readonly PrintedDocLine[];
    taxes: readonly PrintedDocTax[];
    totals: readonly DocTotalLine[];
    // The figure the document leads with: balance due, estimate total or amount paid.
    headline: { label: string; cents: number };
    payment: { method: string; reference: string; at: string; amountCents: number } | null;
    stamp: string | null;
    payUrl: string | null;
    instructions: readonly string[];
    message: string | null;
    footer: string;
    labels: PrintedDocLabels;
}

export interface PrintedDocumentProps {
    doc: PrintedDoc;
    // "classic" is a letterhead with the lines first; "statement" leads with the amount and how to pay.
    template?: "classic" | "statement" | undefined;
}

// A scannable code for a pay or accept link, drawn from the URL.
export interface PayCodeProps {
    value: string;
    size?: number | undefined;
    label: string;
}

export interface CopyFieldProps {
    label: string;
    value: string;
    hint?: string | undefined;
    // line: a link on one line; snippet: code wrapped in a mono box; code: a reference typed elsewhere, large.
    variant?: "line" | "snippet" | "code" | undefined;
    // Omit to show "Copied" for a moment after each copy; web copies the value, mobile leaves it to onCopy.
    copied?: boolean | undefined;
    onCopy?: (() => void) | undefined;
    copyLabel?: string | undefined;
    copiedLabel?: string | undefined;
}

export interface OccurrenceRow {
    key: string;
    index: number;
    date: string;
    time: string;
    intent: Intent;
    state: string;
    note?: string | null | undefined;
    // A second small marker, e.g. a clock change.
    flag?: string | null | undefined;
    past?: boolean | undefined;
    // Shown under a clash: pick one; the selected one is the current choice.
    actions?: readonly { key: string; label: string; selected?: boolean | undefined }[] | undefined;
}

export interface OccurrenceListProps {
    rows: readonly OccurrenceRow[];
    label: string;
    onAction?: ((rowKey: string, actionKey: string) => void) | undefined;
}

export interface SkeletonProps {
    // "row": avatar and two lines; "stat": a label and a figure; "line": one bar.
    variant: "row" | "stat" | "line";
    count?: number | undefined;
    // Lays the placeholders out side by side, e.g. a row of stats.
    columns?: 2 | 3 | 4 | undefined;
    // Announced to screen readers while content loads.
    label: string;
}

export interface SyncBannerProps {
    state: "offline" | "syncing" | "error";
    title: string;
    detail?: string | undefined;
    action?: UiAction | undefined;
    // "strip" is one slim line at the top of a page; "card" explains what still works.
    variant?: "strip" | "card" | undefined;
    children?: ReactNode | undefined;
}

// How much of something: a balance used, seats booked, stock against its low line.
export interface MeterProps {
    // Filled amount, in the same unit as max.
    value: number;
    max: number;
    label: string;
    // Beside the label when it sits above the bar.
    detail?: string | undefined;
    intent?: Intent | undefined;
    // One block per unit (seats, sessions) instead of a continuous bar.
    units?: boolean | undefined;
    // Units past max, drawn dashed after the blocks (a waitlist).
    overflow?: number | undefined;
    // A thin line at this value (a low-stock threshold).
    marker?: number | null | undefined;
    labelPosition?: "above" | "below" | "beside" | "hidden" | undefined;
    size?: "sm" | "md" | undefined;
}

export interface ActionTileProps {
    icon: IconName;
    label: string;
    hint?: string | undefined;
    onPress?: (() => void) | undefined;
    disabled?: boolean | undefined;
    layout?: "tile" | "row" | undefined;
    variant?: "plain" | "inverse" | undefined;
}

interface DayRailDay {
    key: string;
    weekday: string;
    day: string;
    hint?: string | undefined;
    disabled?: boolean | undefined;
}

export interface DayRailProps {
    days: readonly DayRailDay[];
    defaultValue?: string | null | undefined;
    value?: string | null | undefined;
    onChange?: ((key: string) => void) | undefined;
    label: string;
    onPrev?: (() => void) | undefined;
    onNext?: (() => void) | undefined;
    prevLabel?: string | undefined;
    nextLabel?: string | undefined;
}

export interface OptionCardProps {
    title: string;
    subtitle?: string | undefined;
    detail?: string | undefined;
    leading?: ReactNode | undefined;
    trailing?: ReactNode | undefined;
    footer?: ReactNode | undefined;
    selected?: boolean | undefined;
    onPress?: (() => void) | undefined;
    disabled?: boolean | undefined;
    layout?: "row" | "stack" | undefined;
    size?: "sm" | "md" | "lg" | undefined;
    label?: string | undefined;
}

export interface SlotChipsProps {
    groups: readonly { label: string; slots: readonly TimeSlot[] }[];
    defaultValue?: string | null | undefined;
    value?: string | null | undefined;
    onChange?: ((key: string) => void) | undefined;
    label: string;
    layout?: "grid" | "rail" | "stack" | undefined;
    columns?: 2 | 3 | 4 | undefined;
    size?: "md" | "lg" | undefined;
}
