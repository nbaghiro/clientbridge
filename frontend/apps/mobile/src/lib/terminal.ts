/** A reader the SDK still holds from an earlier sheet counts, though the hook's state hasn't caught up. */
export function readerConnected(started: { reader?: unknown }, known: unknown): boolean {
    return started.reader != null || known != null;
}
