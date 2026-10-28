import { formatParts, strings, useBookingRecord } from "@clientbridge/app-core";
import { DetailView, Empty, IconButton, Modal, Skeleton } from "@clientbridge/ui";
import { useState } from "react";

import { api } from "../lib/api";
import { RescheduleDialog } from "./BookingComposer";
import { BookingActionBar, BookingBody, BookingHeading } from "./BookingPanel";

const s = strings.bookings;

/** One visit's record: a drawer over any page, or "inline" in Schedule's side rail. */
export function BookingRecord({
    id,
    variant = "panel",
    onClose,
}: {
    id: string;
    variant?: "panel" | "inline";
    onClose: () => void;
}) {
    const rec = useBookingRecord(api, id);
    const [moving, setMoving] = useState(false);
    const detail = rec.detail;
    const actions =
        detail === null ? undefined : (
            <BookingActionBar
                actions={rec.actions}
                onReschedule={() => {
                    setMoving(true);
                }}
            />
        );
    const reschedule =
        moving && detail !== null ? (
            <RescheduleDialog
                event={detail.event}
                onClose={() => {
                    setMoving(false);
                }}
            />
        ) : null;
    const pending =
        rec.state === "missing" ? (
            <Empty icon="calendar" message={s.recordMissing} />
        ) : (
            <Skeleton variant="row" count={4} label={s.loading} />
        );

    if (variant === "inline")
        return (
            <div className="flex h-full min-h-0 flex-col">
                <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
                    {detail !== null ? <BookingHeading detail={detail} /> : <span />}
                    <IconButton size="sm" icon="x" label={s.close} onPress={onClose} />
                </div>
                <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
                    {detail !== null ? <BookingBody detail={detail} narrow /> : pending}
                </div>
                {actions !== undefined ? (
                    <div className="border-t border-line px-5 py-3">{actions}</div>
                ) : null}
                {reschedule}
            </div>
        );

    return (
        <Modal
            flow
            framed={false}
            size="lg"
            onClose={() => {
                if (moving) setMoving(false);
                else onClose();
            }}
        >
            <DetailView
                open={!moving}
                title={
                    detail?.event.headline ??
                    (rec.state === "missing" ? s.recordMissingTitle : s.loading)
                }
                subtitle={
                    detail === null
                        ? undefined
                        : formatParts([detail.event.serviceName, detail.event.timeLabel])
                }
                onClose={onClose}
                actions={actions}
            >
                {detail !== null ? <BookingBody detail={detail} withStatus /> : pending}
            </DetailView>
            {reschedule}
        </Modal>
    );
}
