/** A client-minted row id for a sync-write insert (`prefix_<uuid>`). On `/sync/upload` the client id
 *  is authoritative and unchecked for shape, so this only has to be unique. `crypto.randomUUID` is
 *  available on web and RN (Hermes). */
export function newRowId(prefix: string): string {
    return `${prefix}_${crypto.randomUUID()}`;
}
