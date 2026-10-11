import { Button, Icon } from "@clientbridge/ui";
import { type ReactNode, useEffect, useRef } from "react";

export interface StepAction {
    label: string;
    onPress: () => void;
    disabled?: boolean | undefined;
    busy?: boolean | undefined;
}

/** Steps on the left, a sticky summary on the right, and a bottom bar below the lg breakpoint. */
export function StepLayout({
    summary,
    bar,
    children,
}: {
    summary: ReactNode;
    bar?: ReactNode;
    children: ReactNode;
}) {
    return (
        <>
            <div className="grid gap-6 pb-28 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8 lg:pb-0">
                <section className="min-w-0">{children}</section>
                <aside className="hidden lg:block">{summary}</aside>
            </div>
            {bar}
        </>
    );
}

export function StepCard({
    n,
    title,
    summary,
    state,
    onEdit,
    editLabel,
    children,
}: {
    n: number;
    title: string;
    summary?: string | null | undefined;
    state: "open" | "done" | "todo";
    onEdit?: (() => void) | undefined;
    editLabel: string;
    children: ReactNode;
}) {
    const heading = useRef<HTMLHeadingElement>(null);
    const previous = useRef(state);
    useEffect(() => {
        if (state === "open" && previous.current !== "open") heading.current?.focus();
        previous.current = state;
    }, [state]);
    return (
        <section
            className={`rounded-2xl border bg-surface ${state === "open" ? "border-line shadow-card" : "border-line-soft"}`}
        >
            <div className="flex items-center gap-3 px-5 py-3.5">
                <span
                    aria-hidden
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${state === "done" ? "bg-accent text-accent-ink" : state === "open" ? "border-2 border-accent text-accent" : "border border-line text-muted"}`}
                >
                    {state === "done" ? <Icon name="check" size={14} /> : n}
                </span>
                <div className="min-w-0 flex-1">
                    <h2
                        ref={heading}
                        tabIndex={-1}
                        className={`font-display font-bold outline-none ${state === "todo" ? "text-[15px] text-muted" : "text-[17px] text-ink"}`}
                    >
                        {title}
                    </h2>
                    {state === "done" && summary ? (
                        <p className="truncate text-sm text-ink-soft">{summary}</p>
                    ) : null}
                </div>
                {state === "done" && onEdit ? (
                    <Button size="sm" variant="quiet" onPress={onEdit}>
                        {editLabel}
                    </Button>
                ) : null}
            </div>
            {state === "open" ? <div className="px-5 pb-5">{children}</div> : null}
        </section>
    );
}

export function SummaryPanel({
    title,
    titleId,
    next,
    back,
    children,
}: {
    title: string;
    titleId?: string | undefined;
    next?: StepAction | undefined;
    back?: StepAction | undefined;
    children: ReactNode;
}) {
    return (
        <div className="sticky top-24 rounded-2xl border border-line bg-surface p-5 shadow-card">
            <h2
                id={titleId}
                tabIndex={titleId === undefined ? undefined : -1}
                className="text-xs font-semibold uppercase tracking-wide text-muted outline-none"
            >
                {title}
            </h2>
            {children}
            {next !== undefined ? (
                <div className="mt-5 space-y-2">
                    <Button
                        className="w-full"
                        size="lg"
                        onPress={next.onPress}
                        disabled={next.disabled}
                        busy={next.busy}
                    >
                        {next.label}
                    </Button>
                    {back !== undefined ? (
                        <Button
                            className="w-full"
                            variant="quiet"
                            icon="chevronLeft"
                            onPress={back.onPress}
                        >
                            {back.label}
                        </Button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

/** The summary below the lg breakpoint: a line and the next step, with an optional panel to open. */
export function SummaryBar({
    label,
    amount,
    next,
    panel,
    open = false,
    onToggle,
}: {
    label: string;
    amount?: ReactNode;
    next: StepAction;
    panel?: ReactNode;
    open?: boolean;
    onToggle?: (open: boolean) => void;
}) {
    const line = (
        <>
            <span className="truncate text-ink-soft">{label}</span>
            {amount}
        </>
    );
    return (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
            <div className="mx-auto max-w-xl space-y-2">
                {panel !== undefined ? (
                    <details
                        open={open}
                        onToggle={(event) => {
                            onToggle?.(event.currentTarget.open);
                        }}
                        className="group"
                    >
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md text-sm [&::-webkit-details-marker]:hidden">
                            <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
                                {line}
                            </span>
                            <span className="shrink-0 text-muted transition group-open:rotate-180">
                                <Icon name="chevronUp" size={16} />
                            </span>
                        </summary>
                        <div className="mt-3 max-h-[55vh] overflow-y-auto border-t border-line pt-3">
                            {panel}
                        </div>
                    </details>
                ) : (
                    <div className="flex items-baseline justify-between gap-3 text-sm">{line}</div>
                )}
                <Button
                    className="w-full"
                    size="lg"
                    onPress={next.onPress}
                    disabled={next.disabled}
                    busy={next.busy}
                >
                    {next.label}
                </Button>
            </div>
        </div>
    );
}
