import { useQuery } from "@powersync/react";
import { useMemo, useState } from "react";

/** The current business id from the synced `businesses` row (one per replica). `null` until it
 *  syncs — sync-write inserts need it to set tenancy. */
export function useBusinessId(): string | null {
    return useQuery<{ id: string }>("SELECT id FROM businesses LIMIT 1").data[0]?.id ?? null;
}

/** Shared list-search state: a query string + the memoized filtered rows. `filter` must be stable. */
export function useSearch<T>(
    rows: T[],
    filter: (rows: T[], q: string) => T[],
): { q: string; setQ: (q: string) => void; filtered: T[] } {
    const [q, setQ] = useState("");
    const filtered = useMemo(() => filter(rows, q), [rows, filter, q]);
    return { q, setQ, filtered };
}
