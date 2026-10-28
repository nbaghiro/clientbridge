import { closeTask, useTask } from "@clientbridge/app-core";

import { NewBooking } from "./BookingSheet";
import { NewClient } from "./ClientRecord";
import { DocEditor } from "./DocEditor";
import { RecordHost } from "./RecordHost";
import { Refund } from "./RefundComposer";
import { Checkout } from "./SaleTicket";

/** Mounted once inside navigation: shows the task a button started, over whatever screen is open. */
export function TaskHost() {
    const task = useTask();
    if (task === null) return null;
    switch (task.kind) {
        case "checkout":
            return (
                <Checkout
                    key={task.bookingId ?? "sale"}
                    bookingId={task.bookingId}
                    onClose={closeTask}
                />
            );
        case "booking":
            return (
                <NewBooking
                    clientId={task.clientId}
                    estimateId={task.estimateId}
                    rebookId={task.rebookId}
                    onClose={closeTask}
                />
            );
        case "doc":
            return (
                <DocEditor
                    key={task.id ?? task.doc}
                    kind={task.doc}
                    id={task.id}
                    clientId={task.clientId}
                    onClose={closeTask}
                />
            );
        case "refund":
            return <Refund key={task.paymentId} paymentId={task.paymentId} onClose={closeTask} />;
        case "clientEditor":
            return <NewClient onClose={closeTask} />;
        case "record":
            return (
                <RecordHost
                    key={`${task.type}:${task.id}`}
                    type={task.type}
                    id={task.id}
                    onClose={closeTask}
                />
            );
    }
}
