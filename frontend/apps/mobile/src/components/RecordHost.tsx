import { type RecordType, canManagePayments } from "@clientbridge/app-core";

import { useRole } from "../lib/auth";
import { BookingRecord } from "./BookingRecord";
import { ClientRecord } from "./ClientRecord";
import { EstimatePanel, InvoicePanel } from "./DocRecord";

/** The record a link opened, over whatever screen is showing. */
export function RecordHost({
    type,
    id,
    onClose,
}: {
    type: RecordType;
    id: string;
    onClose: () => void;
}) {
    const manager = canManagePayments(useRole());
    switch (type) {
        case "client":
            return <ClientRecord clientId={id} onClose={onClose} />;
        case "booking":
            return <BookingRecord id={id} onClose={onClose} />;
        case "invoice":
            return manager ? <InvoicePanel id={id} onClose={onClose} /> : null;
        case "estimate":
            return manager ? <EstimatePanel id={id} onClose={onClose} /> : null;
    }
}
