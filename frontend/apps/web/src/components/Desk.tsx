import { type DetailViewProps } from "@clientbridge/app-core";
import { DetailView, Modal } from "@clientbridge/ui";
import { type ReactNode } from "react";

/** A Payments tab's one row of controls: which records, how many, and the actions on them. */
export function DeskBar({
    switcher,
    summary,
    action,
}: {
    switcher?: ReactNode;
    summary?: string | undefined;
    action?: ReactNode;
}) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-3">
            {switcher ?? <span />}
            <div className="flex items-center gap-3">
                {summary !== undefined ? <p className="text-sm text-muted">{summary}</p> : null}
                {action}
            </div>
        </div>
    );
}

/** The record a desk row opens, in the panel that slides in from the right. */
export function DeskPanel({
    onClose,
    wide = false,
    ...view
}: Omit<DetailViewProps, "open" | "variant"> & { wide?: boolean }) {
    return (
        <Modal flow framed={false} size={wide ? "xl" : "lg"} onClose={onClose}>
            <DetailView open onClose={onClose} {...view} />
        </Modal>
    );
}
