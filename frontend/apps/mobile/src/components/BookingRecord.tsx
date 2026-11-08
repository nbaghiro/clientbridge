import { strings, useBookingRecord } from "@clientbridge/app-core";
import { DetailView, Empty, Modal, Skeleton } from "@clientbridge/ui";
import { useState } from "react";

import { api } from "../lib/api";
import {
    BookingActionBar,
    BookingBody,
    BookingNoteSheet,
    type BookingPage,
    MessageSheet,
    RescheduleSheet,
} from "./BookingSheet";
import { CheckInSheet } from "./CheckInSheet";

const s = strings.bookings;

// A flow draws a nested Modal inline, so each of the visit's sheets is a page beside its record.
type Page = "record" | "move" | BookingPage;

/** One visit's record over any screen, the same wherever its link sits. */
export function BookingRecord({ id, onClose }: { id: string; onClose: () => void }) {
    const rec = useBookingRecord(api, id);
    const [wanted, setPage] = useState<Page>("record");
    const [checkedIn, setCheckedIn] = useState<string | null>(null);
    const detail = rec.detail;
    const bookingId = detail?.event.bookingId ?? null;
    const client = detail?.client ?? null;
    const available: Record<Page, boolean> = {
        record: true,
        move: detail !== null,
        note: bookingId !== null,
        checkIn: bookingId !== null,
        message: client !== null,
    };
    const page = available[wanted] ? wanted : "record";
    const back = (): void => {
        setPage("record");
    };
    return (
        <Modal
            flow
            framed={false}
            size="xl"
            onClose={() => {
                if (page === "record") onClose();
                else back();
            }}
        >
            <DetailView
                open={page === "record"}
                title={
                    detail?.event.headline ??
                    (rec.state === "missing"
                        ? (rec.actions.outcome ?? s.recordMissingTitle)
                        : s.loading)
                }
                subtitle={detail?.event.serviceName}
                onClose={onClose}
                actions={
                    detail === null ? undefined : (
                        <BookingActionBar
                            actions={rec.actions}
                            onReschedule={() => {
                                setPage("move");
                            }}
                        />
                    )
                }
            >
                {detail !== null ? (
                    <BookingBody
                        detail={detail}
                        checkedIn={checkedIn}
                        onUndoneCheckIn={() => {
                            setCheckedIn(null);
                        }}
                        onOpen={setPage}
                    />
                ) : rec.state === "missing" ? (
                    rec.actions.outcome !== null ? (
                        <Empty icon="check" message={s.outcomeBody} />
                    ) : (
                        <Empty icon="calendar" message={s.recordMissing} />
                    )
                ) : (
                    <Skeleton variant="row" count={4} label={s.loading} />
                )}
            </DetailView>
            {page === "move" && detail !== null ? (
                <RescheduleSheet event={detail.event} onClose={back} />
            ) : null}
            {page === "note" && bookingId !== null ? (
                <BookingNoteSheet bookingId={bookingId} onClose={back} />
            ) : null}
            {page === "checkIn" && bookingId !== null ? (
                <CheckInSheet
                    bookingId={bookingId}
                    onClose={back}
                    onDone={(message) => {
                        setCheckedIn(message);
                        back();
                    }}
                />
            ) : null}
            {page === "message" && client !== null ? (
                <MessageSheet clientId={client.id} name={client.name} onClose={back} />
            ) : null}
        </Modal>
    );
}
