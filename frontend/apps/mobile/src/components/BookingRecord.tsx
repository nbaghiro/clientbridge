import { strings, useBookingRecord } from "@clientbridge/app-core";
import { DetailView, Empty, Modal, Skeleton } from "@clientbridge/ui";
import { useState } from "react";

import { api } from "../lib/api";
import { BookingActionBar, BookingBody, RescheduleSheet } from "./BookingSheet";

const s = strings.bookings;

/** One visit's record over any screen, the same wherever its link sits. */
export function BookingRecord({ id, onClose }: { id: string; onClose: () => void }) {
    const rec = useBookingRecord(api, id);
    const [moving, setMoving] = useState(false);
    const detail = rec.detail;
    return (
        <Modal
            flow
            framed={false}
            size="xl"
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
                subtitle={detail?.event.serviceName}
                onClose={onClose}
                actions={
                    detail === null ? undefined : (
                        <BookingActionBar
                            actions={rec.actions}
                            onReschedule={() => {
                                setMoving(true);
                            }}
                        />
                    )
                }
            >
                {detail !== null ? (
                    <BookingBody detail={detail} />
                ) : rec.state === "missing" ? (
                    <Empty icon="calendar" message={s.recordMissing} />
                ) : (
                    <Skeleton variant="row" count={4} label={s.loading} />
                )}
            </DetailView>
            {moving && detail !== null ? (
                <RescheduleSheet
                    event={detail.event}
                    onClose={() => {
                        setMoving(false);
                    }}
                />
            ) : null}
        </Modal>
    );
}
