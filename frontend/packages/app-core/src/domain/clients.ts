import { useQuery } from "@powersync/react";
import { useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import type { ApiLike } from "../util/api";
import { blankToNull } from "../util/format";
import type { Intent } from "../util/intent";

// Local-replica row shape: the columns the SELECT guarantees.
export interface ClientRow {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    status: string;
    lifetime_value_cents: number | null;
}

const CLIENTS_SQL =
    "SELECT id, name, email, phone, status, lifetime_value_cents FROM clients ORDER BY name COLLATE NOCASE";

export function useClients(): ClientRow[] {
    return useQuery<ClientRow>(CLIENTS_SQL).data;
}

export function filterClients(rows: ClientRow[], q: string): ClientRow[] {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter(
        (c) =>
            c.name.toLowerCase().includes(t) ||
            (c.email ?? "").toLowerCase().includes(t) ||
            (c.phone ?? "").includes(t),
    );
}

export function clientStatusIntent(status: string): Intent {
    return status === "active" ? "success" : "warning";
}

export interface ClientInput {
    name: string;
    email?: string | null;
    phone?: string | null;
}

export function createClient(api: ApiLike, input: ClientInput): Promise<{ id: string }> {
    return api.post<{ id: string }>("/v1/clients", {
        name: input.name.trim(),
        email: blankToNull(input.email),
        phone: blankToNull(input.phone),
    });
}

export interface ClientForm {
    name: string;
    setName: (v: string) => void;
    email: string;
    setEmail: (v: string) => void;
    phone: string;
    setPhone: (v: string) => void;
    busy: boolean;
    error: string | null;
    submit: () => void;
}

/** Shared add-client form: field state + validation + submit; the platform owns only the inputs. */
export function useClientForm(api: ApiLike, onCreated: () => void): ClientForm {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const { busy, error, setError, run } = useAsyncAction();

    const submit = (): void => {
        if (name.trim().length === 0) {
            setError("Name is required");
            return;
        }
        void run(() => createClient(api, { name, email, phone }), {
            onSuccess: () => {
                setName("");
                setEmail("");
                setPhone("");
                onCreated();
            },
            errorMessage: "Could not add client",
        });
    };

    return { name, setName, email, setEmail, phone, setPhone, busy, error, submit };
}
