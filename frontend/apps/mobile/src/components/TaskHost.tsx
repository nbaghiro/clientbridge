import { closeTask, useTask } from "@clientbridge/app-core";

import { BookingRecordTask, BookingTask } from "./BookingSheet";
import { ClientEditorTask, ClientRecordTask } from "./ClientRecord";
import { DocEditor } from "./DocEditor";
import { RefundTask } from "./RefundComposer";
import { CheckoutTask } from "./SaleTicket";

/** Mounted once inside navigation: shows the task a button started, over whatever screen is open. */
export function TaskHost() {
    const task = useTask();
    if (task === null) return null;
    switch (task.kind) {
        case "checkout":
            return (
                <CheckoutTask
                    key={task.bookingId ?? "sale"}
                    bookingId={task.bookingId}
                    onClose={closeTask}
                />
            );
        case "booking":
            return (
                <BookingTask
                    clientId={task.clientId}
                    estimateId={task.estimateId}
                    rebookId={task.rebookId}
                    onClose={closeTask}
                />
            );
        case "bookingRecord":
            return (
                <BookingRecordTask
                    key={task.bookingId}
                    bookingId={task.bookingId}
                    onClose={closeTask}
                />
            );
        case "doc":
            return <DocEditor kind={task.doc} clientId={task.clientId} onClose={closeTask} />;
        case "refund":
            return (
                <RefundTask key={task.paymentId} paymentId={task.paymentId} onClose={closeTask} />
            );
        case "clientEditor":
            return <ClientEditorTask onClose={closeTask} />;
        case "clientRecord":
            return (
                <ClientRecordTask
                    key={task.clientId}
                    clientId={task.clientId}
                    onClose={closeTask}
                />
            );
    }
}
