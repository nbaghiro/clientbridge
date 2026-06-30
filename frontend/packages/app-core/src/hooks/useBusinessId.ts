import { useQuery } from "@powersync/react";

/** The current business id from the synced `businesses` row (one per replica). `null` until it
 *  syncs — sync-write inserts need it to set tenancy. */
export function useBusinessId(): string | null {
    return useQuery<{ id: string }>("SELECT id FROM businesses LIMIT 1").data[0]?.id ?? null;
}
