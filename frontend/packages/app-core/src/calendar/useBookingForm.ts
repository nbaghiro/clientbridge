import { useState } from "react";

import type { ApiLike } from "../api";
import { type ItemRow, useCatalogItems } from "../catalog";
import { type ClientRow, useClients } from "../clients";
import { type StaffRow, useStaff } from "../staff";
import { createBooking } from "./bookings";

export interface BookingFormState {
    clients: ClientRow[];
    items: ItemRow[];
    staff: StaffRow[];
    clientId: string;
    setClientId: (id: string) => void;
    itemId: string;
    setItemId: (id: string) => void;
    staffId: string;
    setStaffId: (id: string) => void;
    effStaff: string;
    busy: boolean;
    error: string | null;
    submit: (startsAt: Date | null) => Promise<void>;
}

/** Shared new-booking form: client/service/staff selection, validation, and submit. The platform
 *  owns only the date/time entry widget and passes the resulting Date to submit(). */
export function useBookingForm(api: ApiLike, onCreated: () => void): BookingFormState {
    const clients = useClients();
    const items = useCatalogItems();
    const staff = useStaff();
    const [clientId, setClientId] = useState("");
    const [itemId, setItemId] = useState("");
    const [staffId, setStaffId] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const effStaff = staffId.length > 0 ? staffId : (staff.at(0)?.id ?? "");

    const submit = async (startsAt: Date | null): Promise<void> => {
        if (
            clientId.length === 0 ||
            itemId.length === 0 ||
            effStaff.length === 0 ||
            startsAt === null ||
            Number.isNaN(startsAt.getTime())
        ) {
            setError("Pick a client, service, and time.");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await createBooking(api, { clientId, itemId, staffId: effStaff, startsAt });
            setClientId("");
            setItemId("");
            setError(null);
            onCreated();
        } catch {
            setError("Could not book — that time may already be taken.");
        } finally {
            setBusy(false);
        }
    };

    return {
        clients,
        items,
        staff,
        clientId,
        setClientId,
        itemId,
        setItemId,
        staffId,
        setStaffId,
        effStaff,
        busy,
        error,
        submit,
    };
}
