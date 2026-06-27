import { useMemo, useState } from "react";

/** Shared list-search state: a query string + the memoized filtered rows. `filter` must be stable. */
export function useSearch<T>(
    rows: T[],
    filter: (rows: T[], q: string) => T[],
): { q: string; setQ: (q: string) => void; filtered: T[] } {
    const [q, setQ] = useState("");
    const filtered = useMemo(() => filter(rows, q), [rows, filter, q]);
    return { q, setQ, filtered };
}
