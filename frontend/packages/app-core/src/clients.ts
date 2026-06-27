import { useQuery } from "@powersync/react";

import type { ApiLike } from "./api";

// Local-replica row shape (PowerSync stores booleans as 0/1; columns the SELECT guarantees).
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

export interface ClientInput {
    name: string;
    email?: string | null;
    phone?: string | null;
}

export function createClient(api: ApiLike, input: ClientInput): Promise<{ id: string }> {
    return api.post<{ id: string }>("/v1/clients", {
        name: input.name.trim(),
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
    });
}
